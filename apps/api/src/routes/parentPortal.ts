import { loadLedger } from "./fees";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../db";
import { requireAuth, getActor } from "../auth/guards";
import { forbidden, notFound } from "../lib/errors";
import { assertGuardianLinked } from "../lib/portal";
import { recordAudit } from "../lib/audit";
import { todayInTimeZone } from "../lib/format";
import type { ParentChildDashboardSummary } from "@erp/shared";

const childParams = z.object({
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
});

const leaveRequestBody = z.object({
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonCategory: z.enum([
    "medical",
    "personal",
    "family_function",
    "emergency",
    "travel",
    "other",
  ]),
  reasonText: z.string().min(5).max(500),
});

const pickupAuthBody = z.object({
  authorisedPersonName: z.string().min(2).max(120),
  relationship: z.string().min(2).max(60),
  phone: z.string().min(8).max(40),
  idProofType: z
    .enum([
      "Aadhaar",
      "PAN",
      "Voter_ID",
      "Driving_License",
      "Passport",
      "Other",
    ])
    .default("Aadhaar"),
  idProofNumber: z.string().max(80).optional(),
  emergencyOnly: z.boolean().default(false),
});

const transportAlertsBody = z.object({
  busApproaching: z.boolean().optional(),
  boarding: z.boolean().optional(),
  dropOff: z.boolean().optional(),
  delays: z.boolean().optional(),
});

export async function parentPortalRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Complete Parent Portal Child Dashboard endpoint matching the reference screenshot.
   */
  app.get(
    "/api/schools/:schoolId/portal/children/:studentId/dashboard",
    { preHandler: requireAuth },
    async (request) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const actor = getActor(request);
      const pool = getPool();

      // Enforce strict multi-child parent linkage security
      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      // Fetch child basic information
      const childRes = await pool.query<{
        id: string;
        first_name: string;
        last_name: string | null;
        admission_number: string;
        roll_number: string | null;
        class_name: string;
        section_name: string;
        section_id: string;
        academic_year_name: string;
        academic_year_id: string;
        relationship_type: string;
      }>(
        `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.roll_number,
                c.name AS class_name, sec.name AS section_name, sec.id AS section_id,
                ay.name AS academic_year_name, ay.id AS academic_year_id, sg.relationship_type
         FROM students s
         JOIN student_guardians sg ON sg.student_id = s.id AND sg.school_id = s.school_id
         JOIN guardians g ON g.id = sg.guardian_id AND g.school_id = s.school_id
         JOIN enrollments e ON e.student_id = s.id AND e.school_id = s.school_id AND e.enrollment_status = 'active'
         JOIN sections sec ON sec.id = e.section_id AND sec.school_id = s.school_id
         JOIN classes c ON c.id = sec.class_id AND c.school_id = s.school_id
         JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.school_id = s.school_id
         WHERE s.school_id = $1 AND s.id = $2 AND g.user_id = $3
         ORDER BY (ay.status='active') DESC,e.starts_on DESC
         LIMIT 1`,
        [schoolId, studentId, actor.userId],
      );

      if (!childRes.rows[0]) throw notFound("Child record not found");
      const c = childRes.rows[0];

      // 1. Attendance Today & Cumulative
      const attRes = await pool.query<{
        total_days: string;
        present_days: string;
        today_status: string | null;
        today_time: string | null;
      }>(
        `SELECT
           COUNT(*)::text AS total_days,
           COUNT(*) FILTER (WHERE status IN ('present', 'late', 'half_day'))::text AS present_days,
           (SELECT status FROM student_attendance WHERE school_id = $1 AND student_id = $2 AND attendance_date = $3::date LIMIT 1) AS today_status,
           (SELECT TO_CHAR(created_at AT TIME ZONE $4, 'HH12:MI AM') FROM student_attendance WHERE school_id = $1 AND student_id = $2 AND attendance_date = $3::date LIMIT 1) AS today_time
         FROM student_attendance
         WHERE school_id = $1 AND student_id = $2`,
        [
          schoolId,
          studentId,
          todayInTimeZone(actor.school.timezone),
          actor.school.timezone,
        ],
      );

      const aTotal = parseInt(attRes.rows[0]?.total_days || "0", 10);
      const aPresent = parseInt(attRes.rows[0]?.present_days || "0", 10);
      const overallPercentage =
        aTotal > 0 ? Math.round((aPresent / aTotal) * 100) : 100;
      const statusToday = attRes.rows[0]?.today_status || "not_marked";
      const markedAt = attRes.rows[0]?.today_time || null;

      // 2. Pending Homework
      const hwRes = await pool.query<{
        id: string;
        title: string;
        due_at: string;
        subject_name: string;
      }>(
        `SELECT ha.id, ha.title, ha.due_at, sub.name AS subject_name
         FROM homework_assignments ha
         JOIN subjects sub ON sub.id = ha.subject_id
         LEFT JOIN homework_submissions hs
           ON hs.assignment_id = ha.id AND hs.student_id = $2
         WHERE ha.school_id = $1 AND ha.section_id = $3
           AND hs.id IS NULL
         ORDER BY ha.due_at ASC
         LIMIT 5`,
        [schoolId, studentId, c.section_id],
      );

      // 3. Fees Due & Recent Payments
      const ledger = await loadLedger(
        pool,
        schoolId,
        studentId,
        c.academic_year_id,
      );
      const totalDue = Math.max(0, ledger.balance);
      const headCodes = new Map(
        (
          await pool.query<{ id: string; code: string }>(
            "SELECT id,code FROM fee_heads WHERE school_id=$1",
            [schoolId],
          )
        ).rows.map((head) => [head.id, head.code.toUpperCase()]),
      );
      let tuitionDue = 0,
        transportDue = 0;
      for (const charge of ledger.charges) {
        const code = headCodes.get(charge.feeHeadId) ?? "";
        if (code.includes("TUITION")) tuitionDue += Math.max(0, charge.balance);
        else if (code.includes("TRANSPORT") || code === "BUS")
          transportDue += Math.max(0, charge.balance);
      }
      const dueDate =
        ledger.charges
          .filter((charge) => charge.balance > 0)
          .map((charge) => charge.dueOn)
          .sort()[0] ?? null;
      // Check pending offline payments
      const offlinePending = await pool.query<{
        payment_date: string;
        amount: string;
        payment_method: string;
        status: string;
      }>(
        `SELECT payment_date::text, amount::text, payment_method, status
         FROM fee_offline_payment_acknowledgements
         WHERE school_id = $1 AND student_id = $2 AND status IN ('pending','under_review','unmatched','more_info_needed')
         ORDER BY created_at DESC
         LIMIT 2`,
        [schoolId, studentId],
      );

      const recentPayments = [
        ...offlinePending.rows.map((row) => ({
          date: row.payment_date,
          description: `Bank deposit (${row.payment_method.toUpperCase()})`,
          amount: parseFloat(row.amount),
          status:
            row.status === "verified"
              ? "Verified"
              : "Pending school verification",
          receiptNumber: null,
        })),
        ...ledger.payments
          .filter((payment) => payment.status === "recorded")
          .slice(0, 3)
          .map((payment) => ({
            date: payment.paidOn,
            description: "Verified payment",
            amount: payment.amount,
            status: "Verified",
            receiptNumber: payment.receiptNumber,
          })),
      ]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3);

      // 4. Transport & School Bus Info
      const transportRes = await pool.query<{
        vehicle_number: string;
        route_name: string;
        stop_name: string;
        scheduled_pickup: string;
        scheduled_drop: string;
        route_id: string;
      }>(
        `SELECT tv.registration_number AS vehicle_number,
                tr.name AS route_name,
                ts.name AS stop_name,
                ts.scheduled_pickup::text,
                ts.scheduled_drop::text,
                tr.id AS route_id
         FROM student_transport_allocations sta
         JOIN transport_routes tr ON tr.id = sta.route_id
         JOIN transport_stops ts ON ts.id = sta.stop_id
         LEFT JOIN transport_vehicles tv ON tv.id = tr.vehicle_id
         WHERE sta.school_id = $1 AND sta.student_id = $2 AND sta.status = 'active'
         LIMIT 1`,
        [schoolId, studentId],
      );

      const tr = transportRes.rows[0];
      const routeId = tr?.route_id;

      let routeTimeline: ParentChildDashboardSummary["transport"]["routeTimeline"] =
        [];

      if (routeId) {
        const stopsRes = await pool.query<{
          name: string;
          scheduled_pickup: string;
        }>(
          `SELECT name, scheduled_pickup::text
           FROM transport_stops
           WHERE route_id = $1 AND retired_at IS NULL
           ORDER BY sequence_no ASC`,
          [routeId],
        );
        if (stopsRes.rows.length > 0) {
          routeTimeline = stopsRes.rows.map((st) => ({
            name:
              st.name === tr?.stop_name
                ? `${st.name} (${c.first_name})`
                : st.name,
            time: st.scheduled_pickup
              ? st.scheduled_pickup.slice(0, 5)
              : "Not recorded",
            isChildStop: st.name === tr?.stop_name,
          }));
        }
      }

      // Fetch Transport alert preferences
      const alertPrefRes = await pool.query<{
        bus_approaching: boolean;
        boarding: boolean;
        drop_off: boolean;
        delays: boolean;
      }>(
        `SELECT bus_approaching, boarding, drop_off, delays
         FROM student_transport_alert_preferences
         WHERE school_id = $1 AND student_id = $2
         LIMIT 1`,
        [schoolId, studentId],
      );

      const alertPrefs = alertPrefRes.rows[0] || {
        bus_approaching: true,
        boarding: true,
        drop_off: true,
        delays: true,
      };

      // 5. Next Class / Today's Schedule
      const nextClassRes = await pool.query<{
        subject_name: string;
        starts_at: string;
        ends_at: string;
        room_name: string | null;
      }>(
        `SELECT sub.name AS subject_name,
                TO_CHAR(tp.starts_at, 'HH12:MI AM') AS starts_at,
                TO_CHAR(tp.ends_at, 'HH12:MI AM') AS ends_at,
                rm.name AS room_name
         FROM timetable_slots ts
         JOIN timetable_periods tp ON tp.id = ts.period_id
         JOIN subjects sub ON sub.id = ts.subject_id
         LEFT JOIN rooms rm ON rm.id = ts.room_id
         WHERE ts.school_id = $1 AND ts.section_id = $2
           AND ts.day_of_week=extract(isodow FROM $3::date)
           AND ts.academic_year_id=$5 AND tp.ends_at>(now() AT TIME ZONE $4)::time
         ORDER BY tp.starts_at ASC
         LIMIT 1`,
        [
          schoolId,
          c.section_id,
          todayInTimeZone(actor.school.timezone),
          actor.school.timezone,
          c.academic_year_id,
        ],
      );

      const nc = nextClassRes.rows[0];

      // 6. Direct Teacher Messages & Notices
      const messagesRes = await pool.query<{
        id: string;
        sender_name: string;
        sender_role: string;
        title: string;
        content: string;
        created_at: string;
        is_read: boolean;
        category: string;
      }>(
        `SELECT id, sender_name, sender_role, title, content, created_at::text, is_read, category
         FROM parent_student_messages
         WHERE school_id = $1 AND student_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [schoolId, studentId],
      );

      const messages = messagesRes.rows.map((m) => ({
        id: m.id,
        senderName: m.sender_name,
        senderRole: m.sender_role,
        title: m.title,
        content: m.content,
        createdAt: m.created_at,
        isRead: m.is_read,
        category: m.category,
      }));

      // 7. Documents and Consents
      const docRes = await pool.query<{
        id: string;
        document_type: string;
        title: string;
        status: string;
      }>(
        `SELECT id, document_type, title, status
         FROM student_document_consents
         WHERE school_id = $1 AND student_id = $2
         ORDER BY created_at DESC`,
        [schoolId, studentId],
      );

      const documents = docRes.rows.map((d) => ({
        id: d.id,
        type: d.document_type,
        title: d.title,
        status: (d.status as any) || "pending",
      }));

      // Published notices are not an event calendar. Do not invent upcoming events.
      const upcomingEvents: ParentChildDashboardSummary["upcomingEvents"] = [];

      const dashboardSummary: ParentChildDashboardSummary = {
        child: {
          studentId: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(" "),
          fullName: [c.first_name, c.last_name].filter(Boolean).join(" "),
          admissionNumber: c.admission_number,
          rollNumber: c.roll_number,
          className: c.class_name,
          sectionName: c.section_name,
          academicYearName: c.academic_year_name,
          relationshipType: c.relationship_type,
          isPrimary: true,
          portalAccessStatus: "verified",
        },
        attendance: {
          overallPercentage,
          statusToday,
          markedAt,
        },
        homework: {
          pendingCount: hwRes.rows.length,
          items: hwRes.rows.map((h) => ({
            id: h.id,
            subjectName: h.subject_name,
            title: h.title,
            dueAt: h.due_at,
          })),
        },
        fees: {
          totalDue,
          dueDate,
          breakdown: {
            tuition: Math.round(tuitionDue * 100) / 100,
            transport: Math.round(transportDue * 100) / 100,
            other:
              Math.round((totalDue - tuitionDue - transportDue) * 100) / 100,
          },
          recentPayments,
        },
        transport: {
          vehicleNumber: tr?.vehicle_number ?? null,
          assignedVehicle: tr?.vehicle_number ?? null,
          routeName: tr?.route_name ?? null,
          routeNumber: tr?.route_name
            ? tr.route_name.split(/[:·]/)[0]?.trim() || null
            : null,
          stopName: tr?.stop_name ?? null,
          pickupTime: tr?.scheduled_pickup
            ? tr.scheduled_pickup.slice(0, 5)
            : null,
          dropTime: tr?.scheduled_drop ? tr.scheduled_drop.slice(0, 5) : null,
          illustrativeEta: null,
          alerts: {
            busApproaching: alertPrefs.bus_approaching,
            boarding: alertPrefs.boarding,
            dropOff: alertPrefs.drop_off,
            delays: alertPrefs.delays,
          },
          isLiveGps: false,
          gpsStatusLabel: "DEMO GPS - NOT LIVE",
          timeline: routeTimeline,
          routeTimeline,
        },
        nextClass: nc
          ? {
              subjectName: nc.subject_name,
              timing: `${nc.starts_at} - ${nc.ends_at}`,
              room: nc.room_name || "Not recorded",
            }
          : null,
        academicProgress: {
          termName: "Published results available in the examination record",
          subjects: [],
        },
        messages,
        documents,
        upcomingEvents,
      };

      return dashboardSummary;
    },
  );

  /**
   * Leave requests for a child.
   */
  app.get(
    "/api/schools/:schoolId/portal/children/:studentId/leave-requests",
    { preHandler: requireAuth },
    async (request) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const actor = getActor(request);
      const pool = getPool();

      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      const { rows } = await pool.query(
        `SELECT id, student_id, starts_on::text, ends_on::text, reason_category,
                reason_text, status, review_notes, created_at::text
         FROM student_leave_requests
         WHERE school_id = $1 AND student_id = $2
         ORDER BY created_at DESC`,
        [schoolId, studentId],
      );

      return { items: rows };
    },
  );

  app.post(
    "/api/schools/:schoolId/portal/children/:studentId/leave-requests",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const body = leaveRequestBody.parse(request.body);
      const actor = getActor(request);
      const pool = getPool();

      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      // Find guardian id
      const gRes = await pool.query<{ id: string }>(
        "SELECT id FROM guardians WHERE school_id = $1 AND user_id = $2 LIMIT 1",
        [schoolId, actor.userId],
      );
      if (!gRes.rows[0]) throw forbidden("Guardian record not found");

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO student_leave_requests
           (school_id, student_id, guardian_id, starts_on, ends_on, reason_category, reason_text, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id`,
        [
          schoolId,
          studentId,
          gRes.rows[0].id,
          body.startsOn,
          body.endsOn,
          body.reasonCategory,
          body.reasonText,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: actor.userId,
        action: "portal.leave_request_submitted",
        entityType: "student",
        entityId: studentId,
        outcome: "success",
        after: {
          leaveRequestId: rows[0]?.id,
          startsOn: body.startsOn,
          endsOn: body.endsOn,
          category: body.reasonCategory,
        },
      });

      return reply.status(201).send({
        success: true,
        id: rows[0]?.id,
        message:
          "Leave request submitted successfully. The class teacher will review your request.",
      });
    },
  );

  /**
   * Authorised pickup persons management.
   */
  app.get(
    "/api/schools/:schoolId/portal/children/:studentId/pickup-authorisations",
    { preHandler: requireAuth },
    async (request) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const actor = getActor(request);
      const pool = getPool();

      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      const { rows } = await pool.query(
        `SELECT id, student_id, authorised_person_name, relationship, phone,
                id_proof_type, id_proof_number, valid_from::text, valid_to::text,
                emergency_only, status, created_at::text
         FROM student_pickup_authorisations
         WHERE school_id = $1 AND student_id = $2 AND status != 'revoked'
         ORDER BY created_at DESC`,
        [schoolId, studentId],
      );

      return { items: rows };
    },
  );

  app.post(
    "/api/schools/:schoolId/portal/children/:studentId/pickup-authorisations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const body = pickupAuthBody.parse(request.body);
      const actor = getActor(request);
      const pool = getPool();

      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      const gRes = await pool.query<{ id: string }>(
        "SELECT id FROM guardians WHERE school_id = $1 AND user_id = $2 LIMIT 1",
        [schoolId, actor.userId],
      );
      if (!gRes.rows[0]) throw forbidden("Guardian record not found");

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO student_pickup_authorisations
           (school_id, student_id, guardian_id, authorised_person_name, relationship,
            phone, id_proof_type, id_proof_number, emergency_only, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')
         RETURNING id`,
        [
          schoolId,
          studentId,
          gRes.rows[0].id,
          body.authorisedPersonName,
          body.relationship,
          body.phone,
          body.idProofType,
          body.idProofNumber || null,
          body.emergencyOnly,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: actor.userId,
        action: "portal.pickup_authorised",
        entityType: "student",
        entityId: studentId,
        outcome: "success",
        after: {
          personName: body.authorisedPersonName,
          relationship: body.relationship,
        },
      });

      return reply.status(201).send({
        success: true,
        id: rows[0]?.id,
        message: "Authorised pickup person registered successfully.",
      });
    },
  );

  app.delete(
    "/api/schools/:schoolId/portal/children/:studentId/pickup-authorisations/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const actor = getActor(request);
      const pool = getPool();

      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      await pool.query(
        `UPDATE student_pickup_authorisations
         SET status = 'revoked', updated_at = now()
         WHERE school_id = $1 AND student_id = $2 AND id = $3`,
        [schoolId, studentId, id],
      );

      return reply
        .status(200)
        .send({ success: true, message: "Authorisation revoked." });
    },
  );

  /**
   * Transport alert preferences toggle.
   */
  app.put(
    "/api/schools/:schoolId/portal/children/:studentId/transport/alerts",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const body = transportAlertsBody.parse(request.body);
      const actor = getActor(request);
      const pool = getPool();

      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      const gRes = await pool.query<{ id: string }>(
        "SELECT id FROM guardians WHERE school_id = $1 AND user_id = $2 LIMIT 1",
        [schoolId, actor.userId],
      );
      if (!gRes.rows[0]) throw forbidden("Guardian record not found");

      await pool.query(
        `INSERT INTO student_transport_alert_preferences
           (school_id, student_id, guardian_id, bus_approaching, boarding, drop_off, delays)
         VALUES ($1, $2, $3,
           COALESCE($4, true),
           COALESCE($5, true),
           COALESCE($6, true),
           COALESCE($7, true)
         )
         ON CONFLICT (school_id, student_id, guardian_id)
         DO UPDATE SET
           bus_approaching = COALESCE($4, student_transport_alert_preferences.bus_approaching),
           boarding = COALESCE($5, student_transport_alert_preferences.boarding),
           drop_off = COALESCE($6, student_transport_alert_preferences.drop_off),
           delays = COALESCE($7, student_transport_alert_preferences.delays),
           updated_at = now()`,
        [
          schoolId,
          studentId,
          gRes.rows[0].id,
          body.busApproaching,
          body.boarding,
          body.dropOff,
          body.delays,
        ],
      );

      const { rows: updatedPrefRows } = await pool.query<{
        bus_approaching: boolean;
        boarding: boolean;
        drop_off: boolean;
        delays: boolean;
      }>(
        `SELECT bus_approaching, boarding, drop_off, delays
         FROM student_transport_alert_preferences
         WHERE school_id = $1 AND student_id = $2
         LIMIT 1`,
        [schoolId, studentId],
      );

      const up = updatedPrefRows[0];
      return reply.status(200).send({
        success: true,
        message: "Alert preferences updated.",
        alerts: {
          busApproaching: up
            ? up.bus_approaching
            : (body.busApproaching ?? true),
          boarding: up ? up.boarding : (body.boarding ?? true),
          dropOff: up ? up.drop_off : (body.dropOff ?? true),
          delays: up ? up.delays : (body.delays ?? true),
        },
      });
    },
  );

  /**
   * Documents & Consents acknowledge / submit.
   */
  app.post(
    "/api/schools/:schoolId/portal/children/:studentId/documents/:id/submit",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { schoolId, studentId } = childParams.parse(request.params);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const actor = getActor(request);
      const pool = getPool();

      await assertGuardianLinked(pool, schoolId, actor.userId, studentId);

      await pool.query(
        `UPDATE student_document_consents
         SET status = 'submitted', submitted_at = now(), updated_at = now()
         WHERE school_id = $1 AND student_id = $2 AND id = $3`,
        [schoolId, studentId, id],
      );

      return reply
        .status(200)
        .send({ success: true, message: "Document consent submitted." });
    },
  );

  /**
   * Mark parent message as read.
   */
  app.post(
    "/api/schools/:schoolId/portal/messages/:id/read",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { schoolId } = z
        .object({ schoolId: z.string().uuid() })
        .parse(request.params);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const pool = getPool();

      await pool.query(
        `UPDATE parent_student_messages
         SET is_read = true, read_at = now(), updated_at = now()
         WHERE school_id = $1 AND id = $2`,
        [schoolId, id],
      );

      return reply.status(200).send({ success: true });
    },
  );
}
