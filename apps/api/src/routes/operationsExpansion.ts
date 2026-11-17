import { uuid } from "@erp/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  getActor,
  requireAnyPermission,
  requirePermission,
  requestMeta,
} from "../auth/guards";
import { visibleSectionIds } from "@erp/core";
import { assertGuardianLinked } from "../lib/portal";
import { recordAudit } from "../lib/audit";
import { getPool, withTransaction } from "../db";
import { badRequest, forbidden, notFound, parseInput } from "../lib/errors";
import crypto from "node:crypto";

const schoolParams = z.object({ schoolId: uuid });

const createFacilitySchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(150),
  category: z.enum([
    "classroom",
    "laboratory",
    "sports_ground",
    "auditorium",
    "library",
    "cafeteria",
    "washroom",
    "admin_office",
    "medical_room",
    "other",
  ]),
  blockLocation: z.string().trim().max(100).optional(),
  floorNumber: z.string().trim().max(30).optional(),
  capacity: z.number().int().min(0).default(40),
  status: z
    .enum(["operational", "under_maintenance", "out_of_service", "renovating"])
    .default("operational"),
  notes: z.string().trim().optional(),
});

const createMaintenanceTicketSchema = z.object({
  facilityId: uuid,
  category: z.enum([
    "electrical",
    "plumbing",
    "furniture",
    "hvac",
    "safety",
    "civil",
    "cleaning",
    "it_hardware",
    "general",
  ]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  description: z.string().trim().min(5),
  assignedTo: uuid.optional(),
  estimatedCost: z.number().min(0).default(0),
});

const updateMaintenanceTicketSchema = z.object({
  status: z
    .enum([
      "reported",
      "assigned",
      "in_progress",
      "resolved",
      "closed",
      "cancelled",
    ])
    .optional(),
  assignedTo: uuid.optional(),
  actualCost: z.number().min(0).optional(),
  resolutionNotes: z.string().trim().optional(),
});

const createPtmSlotSchema = z.object({
  academicYearId: uuid,
  teacherId: uuid,
  title: z.string().trim().max(150).default("Parent-Teacher Meeting"),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  roomLocation: z.string().trim().max(100).optional(),
  maxParents: z.number().int().min(1).default(1),
});

const bookPtmSlotSchema = z.object({
  slotId: uuid,
  studentId: uuid,
  guardianId: uuid,
  bookingNotes: z.string().trim().optional(),
});

const updatePtmBookingSchema = z.object({
  status: z.enum(["confirmed", "attended", "no_show", "cancelled"]).optional(),
  teacherFeedback: z.string().trim().optional(),
});

const generateCertificateSchema = z.object({
  studentId: uuid,
  academicYearId: uuid,
  certificateType: z.enum([
    "transfer_certificate",
    "bonafide",
    "character_certificate",
    "marksheet_duplicate",
    "sports_merit",
    "fee_clearance",
  ]),
  issuedReason: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const approveCertificateSchema = z.object({
  status: z.enum(["approved", "issued", "revoked"]).default("issued"),
  revocationReason: z.string().trim().optional(),
});

const createClubSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(150),
  category: z
    .enum([
      "sports",
      "arts",
      "stem",
      "literary",
      "music",
      "dance",
      "robotics",
      "environment",
      "drama",
    ])
    .default("sports"),
  leadTeacherId: uuid.optional(),
  description: z.string().trim().optional(),
  maxMembers: z.number().int().min(1).default(40),
  meetingSchedule: z.string().trim().max(150).optional(),
  venue: z.string().trim().max(100).optional(),
});

const joinClubSchema = z.object({
  clubId: uuid.optional(),
  studentId: uuid,
  academicYearId: uuid,
  role: z
    .enum([
      "member",
      "captain",
      "vice_captain",
      "secretary",
      "treasurer",
      "mentor",
    ])
    .default("member"),
  achievements: z.string().trim().optional(),
});

const createAlumniSchema = z.object({
  studentId: uuid,
  passingYear: z.number().int().min(2000).max(2100),
  classGraduated: z.string().trim().default("Class 12"),
  stream: z.string().trim().default("Science"),
  currentEngagement: z.enum([
    "higher_education",
    "employed",
    "entrepreneur",
    "research",
    "public_service",
    "other",
  ]),
  institutionOrCompany: z.string().trim().optional(),
  designationOrCourse: z.string().trim().optional(),
  contactEmail: z.string().email().optional(),
  city: z.string().trim().optional(),
  consentForDirectory: z.boolean().default(true),
  notes: z.string().trim().optional(),
});

export async function registerOperationsExpansionRoutes(
  app: FastifyInstance,
): Promise<void> {
  const pool = getPool();

  /* ---------------------- 1. Facilities & Maintenance ---------------------- */
  app.get(
    "/api/schools/:schoolId/facilities",
    { preHandler: requirePermission("school.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await pool.query(
        `SELECT id, school_id, campus_id, code, name, category, block_location, floor_number,
                capacity, status, last_inspected_at, notes, created_at
         FROM school_facilities
         WHERE school_id = $1
         ORDER BY category, code`,
        [schoolId],
      );
      return { items: rows };
    },
  );

  const createFacilityHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const body = parseInput(createFacilitySchema, request.body);

    const { rows } = await pool.query(
      `INSERT INTO school_facilities (school_id, code, name, category, block_location, floor_number, capacity, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        schoolId,
        body.code,
        body.name,
        body.category,
        body.blockLocation || null,
        body.floorNumber || null,
        body.capacity,
        body.status,
        body.notes || null,
      ],
    );
    return reply.code(201).send(rows[0]);
  };

  app.post(
    "/api/schools/:schoolId/facilities",
    { preHandler: requirePermission("school.manage") },
    createFacilityHandler,
  );

  app.get(
    "/api/schools/:schoolId/facilities/maintenance",
    { preHandler: requirePermission("school.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await pool.query(
        `SELECT m.id, m.school_id, m.facility_id, m.ticket_number, m.category, m.priority,
                m.description, m.status, m.estimated_cost, m.actual_cost, m.resolution_notes,
                m.reported_at, m.resolved_at, f.name AS facility_name, f.code AS facility_code,
                u.display_name AS reported_by_name,
                s.first_name || ' ' || s.last_name AS assigned_to_name
         FROM facility_maintenance_tickets m
         JOIN school_facilities f ON f.id = m.facility_id
         JOIN users u ON u.id = m.reported_by
         LEFT JOIN staff s ON s.id = m.assigned_to
         WHERE m.school_id = $1
         ORDER BY m.reported_at DESC`,
        [schoolId],
      );
      return { items: rows };
    },
  );

  const createMaintenanceHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const body = parseInput(createMaintenanceTicketSchema, request.body);
    const actor = getActor(request);

    const seqRes = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM facility_maintenance_tickets WHERE school_id = $1",
      [schoolId],
    );
    const count = Number(seqRes.rows[0]?.count ?? 0) + 1;
    const ticketNumber = `TKT-${new Date().getFullYear()}-${String(count).padStart(4, "0")}`;

    const { rows } = await pool.query(
      `INSERT INTO facility_maintenance_tickets
         (school_id, facility_id, ticket_number, category, priority, description, reported_by, assigned_to, estimated_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        schoolId,
        body.facilityId,
        ticketNumber,
        body.category,
        body.priority,
        body.description,
        actor.userId,
        body.assignedTo || null,
        body.estimatedCost,
      ],
    );
    return reply.code(201).send(rows[0]);
  };

  app.post(
    "/api/schools/:schoolId/facilities/maintenance",
    { preHandler: requirePermission("school.manage") },
    createMaintenanceHandler,
  );
  app.post(
    "/api/schools/:schoolId/maintenance-tickets",
    { preHandler: requirePermission("school.manage") },
    createMaintenanceHandler,
  );

  const updateMaintenanceHandler = async (request: FastifyRequest) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const { ticketId } = parseInput(
      z.object({ ticketId: uuid }),
      request.params,
    );
    const body = parseInput(updateMaintenanceTicketSchema, request.body);

    const updates: string[] = [];
    const values: unknown[] = [schoolId, ticketId];
    let pIdx = 3;

    if (body.status !== undefined) {
      updates.push(`status = $${pIdx++}`);
      values.push(body.status);
      if (body.status === "resolved" || body.status === "closed") {
        updates.push(`resolved_at = now()`);
      }
    }
    if (body.assignedTo !== undefined) {
      updates.push(`assigned_to = $${pIdx++}`);
      values.push(body.assignedTo);
    }
    if (body.actualCost !== undefined) {
      updates.push(`actual_cost = $${pIdx++}`);
      values.push(body.actualCost);
    }
    if (body.resolutionNotes !== undefined) {
      updates.push(`resolution_notes = $${pIdx++}`);
      values.push(body.resolutionNotes);
    }

    if (updates.length === 0) {
      return { updated: false };
    }

    const { rows } = await pool.query(
      `UPDATE facility_maintenance_tickets
       SET ${updates.join(", ")}
       WHERE school_id = $1 AND id = $2
       RETURNING *`,
      values,
    );

    if (rows.length === 0) throw notFound("Maintenance ticket not found");
    return rows[0];
  };

  app.patch(
    "/api/schools/:schoolId/facilities/maintenance/:ticketId",
    { preHandler: requirePermission("school.manage") },
    updateMaintenanceHandler,
  );
  app.patch(
    "/api/schools/:schoolId/maintenance-tickets/:ticketId",
    { preHandler: requirePermission("school.manage") },
    updateMaintenanceHandler,
  );

  /* ------------------------- 2. PTM Slots & Bookings ----------------------- */
  app.get(
    "/api/schools/:schoolId/ptm/slots",
    { preHandler: requirePermission("guardian.student.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await pool.query(
        `SELECT p.id, p.title, p.event_date, p.start_time, p.end_time, p.room_location, p.status,
                s.first_name || ' ' || s.last_name AS teacher_name, s.designation,
                (SELECT count(*) FROM ptm_bookings b WHERE b.slot_id = p.id AND b.status = 'confirmed')::int AS booked_count
         FROM ptm_slots p
         JOIN staff s ON s.id = p.teacher_id
         WHERE p.school_id = $1 AND p.event_date >= CURRENT_DATE - INTERVAL '1 day'
         ORDER BY p.event_date, p.start_time`,
        [schoolId],
      );
      return { items: rows };
    },
  );

  const createPtmSlotHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const body = parseInput(createPtmSlotSchema, request.body);
    const actor = getActor(request);
    if (body.endTime <= body.startTime)
      throw badRequest("PTM end time must follow start time");
    const row = await withTransaction(async (client) => {
      const teacher = (
        await client.query<{ user_id: string | null }>(
          `SELECT user_id FROM staff WHERE school_id=$1 AND id=$2 AND status='active' FOR UPDATE`,
          [schoolId, body.teacherId],
        )
      ).rows[0];
      if (!teacher) throw notFound("Teacher not found");
      const manages =
        actor.permissions.has("school.manage") ||
        actor.permissions.has("academic.timetable.manage");
      if (!manages && teacher.user_id !== actor.userId)
        throw forbidden("Teachers can create only their own PTM slots");
      const year = await client.query(
        "SELECT 1 FROM academic_years WHERE school_id=$1 AND id=$2 AND $3::date BETWEEN starts_on AND ends_on",
        [schoolId, body.academicYearId, body.eventDate],
      );
      if (!year.rowCount)
        throw badRequest("PTM date must fall within its academic year");
      const clash = await client.query(
        `SELECT 1 FROM ptm_slots WHERE school_id=$1 AND teacher_id=$2 AND event_date=$3 AND status IN('available','booked') AND start_time::time<$5::time AND end_time::time>$4::time`,
        [
          schoolId,
          body.teacherId,
          body.eventDate,
          body.startTime,
          body.endTime,
        ],
      );
      if (clash.rowCount)
        throw forbidden("The teacher already has an overlapping PTM slot");
      const item = (
        await client.query(
          `INSERT INTO ptm_slots(school_id,academic_year_id,teacher_id,title,event_date,start_time,end_time,room_location,max_parents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            schoolId,
            body.academicYearId,
            body.teacherId,
            body.title,
            body.eventDate,
            body.startTime,
            body.endTime,
            body.roomLocation ?? null,
            body.maxParents,
          ],
        )
      ).rows[0];
      await recordAudit(client, {
        schoolId,
        actorUserId: actor.userId,
        action: "ptm.slot_created",
        entityType: "ptm_slot",
        entityId: item.id,
        outcome: "success",
        after: {
          teacherId: body.teacherId,
          eventDate: body.eventDate,
          startTime: body.startTime,
          endTime: body.endTime,
        },
        ...requestMeta(request),
      });
      return item;
    });
    return reply.code(201).send(row);
  };

  app.post(
    "/api/schools/:schoolId/ptm/slots",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "academic.timetable.manage",
        "learning.manage",
      ),
    },
    createPtmSlotHandler,
  );
  app.post(
    "/api/schools/:schoolId/ptm-slots",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "academic.timetable.manage",
        "learning.manage",
      ),
    },
    createPtmSlotHandler,
  );

  const bookPtmSlotHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const body = parseInput(bookPtmSlotSchema, request.body);

    const actor = getActor(request);
    const booking = await withTransaction(async (client) => {
      await assertGuardianLinked(
        client,
        schoolId,
        actor.userId,
        body.studentId,
      );
      const guardian = await client.query(
        `SELECT 1 FROM guardians g JOIN student_guardians sg ON sg.guardian_id=g.id AND sg.school_id=g.school_id WHERE g.school_id=$1 AND g.id=$2 AND g.user_id=$3 AND sg.student_id=$4 AND sg.portal_access_status='verified' AND sg.valid_to IS NULL`,
        [schoolId, body.guardianId, actor.userId, body.studentId],
      );
      if (!guardian.rowCount)
        throw notFound("Verified guardian link not found");
      const slot = (
        await client.query<{ max_parents: number; status: string }>(
          `SELECT max_parents,status FROM ptm_slots WHERE school_id=$1 AND id=$2 FOR UPDATE`,
          [schoolId, body.slotId],
        )
      ).rows[0];
      if (!slot) throw notFound("PTM slot not found");
      if (!["available", "booked"].includes(slot.status))
        throw forbidden("PTM slot is not open for booking");
      const existing = (
        await client.query<{ id: string; status: string }>(
          `SELECT id,status FROM ptm_bookings WHERE school_id=$1 AND slot_id=$2 AND student_id=$3`,
          [schoolId, body.slotId, body.studentId],
        )
      ).rows[0];
      const count = (
        await client.query<{ count: string }>(
          `SELECT count(*)::text FROM ptm_bookings WHERE school_id=$1 AND slot_id=$2 AND status='confirmed'`,
          [schoolId, body.slotId],
        )
      ).rows[0]!;
      if (
        existing?.status !== "confirmed" &&
        Number(count.count) >= slot.max_parents
      )
        throw forbidden("This PTM slot has reached maximum capacity");
      const row = (
        await client.query(
          `INSERT INTO ptm_bookings(school_id,slot_id,student_id,guardian_id,booking_notes,status) VALUES($1,$2,$3,$4,$5,'confirmed') ON CONFLICT(slot_id,student_id) DO UPDATE SET guardian_id=excluded.guardian_id,booking_notes=excluded.booking_notes,status='confirmed' RETURNING *`,
          [
            schoolId,
            body.slotId,
            body.studentId,
            body.guardianId,
            body.bookingNotes ?? null,
          ],
        )
      ).rows[0];
      await recordAudit(client, {
        schoolId,
        actorUserId: actor.userId,
        action: "ptm.booking_confirmed",
        entityType: "ptm_booking",
        entityId: row.id,
        outcome: "success",
        after: { slotId: body.slotId, studentId: body.studentId },
        ...requestMeta(request),
      });
      return row;
    });
    return reply.code(201).send(booking);
  };

  app.post(
    "/api/schools/:schoolId/ptm/bookings",
    { preHandler: requirePermission("guardian.student.view") },
    bookPtmSlotHandler,
  );
  app.post(
    "/api/schools/:schoolId/ptm-bookings",
    { preHandler: requirePermission("guardian.student.view") },
    bookPtmSlotHandler,
  );

  const updatePtmBookingHandler = async (request: FastifyRequest) => {
    const { schoolId, id } = parseInput(
      z.object({ schoolId: uuid, id: uuid }),
      request.params,
    );
    const body = parseInput(updatePtmBookingSchema, request.body);

    const actor = getActor(request);
    const manages =
      actor.permissions.has("school.manage") ||
      actor.permissions.has("academic.timetable.manage");
    const owned = await pool.query(
      `SELECT 1 FROM ptm_bookings b JOIN ptm_slots p ON p.school_id=b.school_id AND p.id=b.slot_id JOIN staff st ON st.school_id=p.school_id AND st.id=p.teacher_id WHERE b.school_id=$1 AND b.id=$2 AND ($3 OR st.user_id=$4)`,
      [schoolId, id, manages, actor.userId],
    );
    if (!owned.rowCount)
      throw notFound("PTM booking not found in your assigned scope");
    const updates: string[] = [];
    const values: unknown[] = [schoolId, id];
    let pIdx = 3;

    if (body.status !== undefined) {
      updates.push(`status = $${pIdx++}`);
      values.push(body.status);
    }
    if (body.teacherFeedback !== undefined) {
      updates.push(`teacher_feedback = $${pIdx++}`);
      values.push(body.teacherFeedback);
    }

    if (updates.length === 0) return { updated: false };

    const { rows } = await pool.query(
      `UPDATE ptm_bookings
       SET ${updates.join(", ")}
       WHERE school_id = $1 AND id = $2
       RETURNING *`,
      values,
    );
    if (rows.length === 0) throw notFound("PTM booking not found");
    await recordAudit(pool, {
      schoolId,
      actorUserId: actor.userId,
      action: "ptm.booking_updated",
      entityType: "ptm_booking",
      entityId: id,
      outcome: "success",
      after: {
        status: body.status,
        feedbackChanged: body.teacherFeedback !== undefined,
      },
      ...requestMeta(request),
    });
    return rows[0];
  };

  app.patch(
    "/api/schools/:schoolId/ptm/bookings/:id",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "academic.timetable.manage",
        "learning.grade",
      ),
    },
    updatePtmBookingHandler,
  );
  app.patch(
    "/api/schools/:schoolId/ptm-bookings/:id",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "academic.timetable.manage",
        "learning.grade",
      ),
    },
    updatePtmBookingHandler,
  );

  /* ------------------- 3. Documents & Official Certificates ----------------- */
  app.get(
    "/api/schools/:schoolId/certificates",
    { preHandler: requirePermission("students.profile.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const scope = visibleSectionIds(getActor(request));
      const { rows } = await pool.query(
        `SELECT c.id, c.certificate_type, c.certificate_number, c.issued_on, c.valid_until,
                c.issued_reason, c.status, c.verification_hash, c.metadata, c.created_at,
                s.first_name || ' ' || s.last_name AS student_name, s.admission_number,
                u.display_name AS approved_by_name
         FROM school_certificates c
         JOIN students s ON s.id = c.student_id
         LEFT JOIN users u ON u.id = c.approved_by
         WHERE c.school_id = $1 AND ($2::uuid[] IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=c.school_id AND e.student_id=c.student_id AND e.enrollment_status='active' AND e.section_id=ANY($2::uuid[])))
         ORDER BY c.issued_on DESC`,
        [schoolId, scope],
      );
      return { items: rows };
    },
  );

  const generateCertificateHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const body = parseInput(generateCertificateSchema, request.body);
    const actor = getActor(request);

    const scope = visibleSectionIds(actor);
    const student = await pool.query(
      `SELECT 1 FROM students s JOIN enrollments e ON e.school_id=s.school_id AND e.student_id=s.id WHERE s.school_id=$1 AND s.id=$2 AND e.academic_year_id=$3 AND ($4::uuid[] IS NULL OR e.section_id=ANY($4::uuid[]))`,
      [schoolId, body.studentId, body.academicYearId, scope],
    );
    if (!student.rowCount)
      throw notFound("Student enrollment not found in your assigned scope");
    const prefixMap: Record<string, string> = {
      transfer_certificate: "TC",
      bonafide: "BON",
      character_certificate: "CHR",
      marksheet_duplicate: "MARK",
      sports_merit: "MERIT",
      fee_clearance: "FEE",
    };
    const prefix = prefixMap[body.certificateType] ?? "CERT";
    const year = new Date().getFullYear();

    const countRes = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM school_certificates WHERE school_id = $1 AND certificate_type = $2",
      [schoolId, body.certificateType],
    );
    const certNum = `${prefix}/${year}/${String(Number(countRes.rows[0]?.count ?? 0) + 1).padStart(5, "0")}`;
    const hash = crypto
      .createHash("sha256")
      .update(`${schoolId}:${certNum}:${body.studentId}:${Date.now()}`)
      .digest("hex");

    const { rows } = await pool.query(
      `INSERT INTO school_certificates
         (school_id, certificate_type, certificate_number, student_id, academic_year_id, issued_on, issued_reason, approved_by, approved_at, verification_hash, metadata, status)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, now(), $8, $9, 'approved')
       RETURNING *`,
      [
        schoolId,
        body.certificateType,
        certNum,
        body.studentId,
        body.academicYearId,
        body.issuedReason || "Standard official issuance",
        actor.userId,
        hash,
        JSON.stringify(body.metadata || {}),
      ],
    );
    await recordAudit(pool, {
      schoolId,
      actorUserId: actor.userId,
      action: "certificate.created",
      entityType: "school_certificate",
      entityId: rows[0].id,
      outcome: "success",
      after: {
        certificateType: body.certificateType,
        studentId: body.studentId,
        certificateNumber: certNum,
      },
      ...requestMeta(request),
    });
    return reply.code(201).send(rows[0]);
  };

  app.post(
    "/api/schools/:schoolId/certificates/generate",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "students.admission.create",
      ),
    },
    generateCertificateHandler,
  );
  app.post(
    "/api/schools/:schoolId/certificates",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "students.admission.create",
      ),
    },
    generateCertificateHandler,
  );

  const approveCertificateHandler = async (request: FastifyRequest) => {
    const { schoolId, id } = parseInput(
      z.object({ schoolId: uuid, id: uuid }),
      request.params,
    );
    const body = parseInput(approveCertificateSchema, request.body);
    const actor = getActor(request);

    const scope = visibleSectionIds(actor);
    const visible = await pool.query(
      `SELECT 1 FROM school_certificates cert WHERE cert.school_id=$1 AND cert.id=$2 AND ($3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=cert.school_id AND e.student_id=cert.student_id AND e.enrollment_status='active' AND e.section_id=ANY($3::uuid[])))`,
      [schoolId, id, scope],
    );
    if (!visible.rowCount)
      throw notFound("Certificate not found in your assigned scope");
    const { rows } = await pool.query(
      `UPDATE school_certificates
       SET status = $1, approved_by = $2, approved_at = now(), revocation_reason = $3
       WHERE school_id = $4 AND id = $5
       RETURNING *`,
      [body.status, actor.userId, body.revocationReason || null, schoolId, id],
    );
    if (rows.length === 0) throw notFound("Certificate not found");
    await recordAudit(pool, {
      schoolId,
      actorUserId: actor.userId,
      action: "certificate.status_updated",
      entityType: "school_certificate",
      entityId: id,
      outcome: "success",
      after: { status: body.status },
      ...requestMeta(request),
    });
    return rows[0];
  };

  app.patch(
    "/api/schools/:schoolId/certificates/:id/approve",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "students.admission.create",
      ),
    },
    approveCertificateHandler,
  );

  const verifyCertificateHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { hash } = parseInput(
      z.object({ hash: z.string().min(8) }),
      request.params,
    );
    const { rows } = await pool.query(
      `SELECT c.certificate_number, c.certificate_type, c.issued_on, c.status,
              sch.name AS school_name,
              s.first_name || ' ' || s.last_name AS student_name, s.admission_number,
              y.name AS academic_year_name
       FROM school_certificates c
       JOIN schools sch ON sch.id = c.school_id
       JOIN students s ON s.id = c.student_id
       JOIN academic_years y ON y.id = c.academic_year_id
       WHERE c.verification_hash = $1`,
      [hash],
    );
    if (rows.length === 0) {
      return reply.code(404).send({
        verified: false,
        error: "Certificate not found or verification hash invalid.",
      });
    }
    return { verified: true, certificate: rows[0] };
  };

  app.get("/api/certificates/verify/:hash", verifyCertificateHandler);
  app.get(
    "/api/schools/:schoolId/certificates/verify/:hash",
    verifyCertificateHandler,
  );

  /* ------------------- 4. Sports, Arts, Clubs & Alumni -------------------- */
  app.get(
    "/api/schools/:schoolId/clubs",
    { preHandler: requirePermission("academic.structure.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await pool.query(
        `SELECT c.id, c.code, c.name, c.category, c.description, c.max_members, c.meeting_schedule,
                c.venue, c.status, s.first_name || ' ' || s.last_name AS lead_teacher_name,
                (SELECT count(*) FROM club_memberships m WHERE m.club_id = c.id AND m.status = 'active')::int AS member_count
         FROM school_clubs c
         LEFT JOIN staff s ON s.id = c.lead_teacher_id
         WHERE c.school_id = $1
         ORDER BY c.category, c.name`,
        [schoolId],
      );
      return { items: rows };
    },
  );

  const createClubHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const body = parseInput(createClubSchema, request.body);

    const { rows } = await pool.query(
      `INSERT INTO school_clubs (school_id, code, name, category, lead_teacher_id, description, max_members, meeting_schedule, venue)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        schoolId,
        body.code,
        body.name,
        body.category,
        body.leadTeacherId || null,
        body.description || null,
        body.maxMembers,
        body.meetingSchedule || null,
        body.venue || null,
      ],
    );
    return reply.code(201).send(rows[0]);
  };

  app.post(
    "/api/schools/:schoolId/clubs",
    { preHandler: requirePermission("school.manage") },
    createClubHandler,
  );

  const joinClubHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const { clubId } = parseInput(z.object({ clubId: uuid }), request.params);
    const body = parseInput(joinClubSchema, request.body);

    const { rows } = await pool.query(
      `INSERT INTO club_memberships (school_id, club_id, student_id, academic_year_id, role, achievements, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (club_id, student_id, academic_year_id) DO UPDATE SET role = EXCLUDED.role, achievements = EXCLUDED.achievements, status = 'active'
       RETURNING *`,
      [
        schoolId,
        clubId,
        body.studentId,
        body.academicYearId,
        body.role,
        body.achievements || null,
      ],
    );
    return reply.code(201).send(rows[0]);
  };

  app.post(
    "/api/schools/:schoolId/clubs/:clubId/join",
    { preHandler: requirePermission("students.profile.edit") },
    joinClubHandler,
  );
  app.post(
    "/api/schools/:schoolId/clubs/:clubId/members",
    { preHandler: requirePermission("students.profile.edit") },
    joinClubHandler,
  );

  app.get(
    "/api/schools/:schoolId/alumni",
    { preHandler: requirePermission("school.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await pool.query(
        `SELECT a.id, a.passing_year, a.class_graduated, a.stream, a.current_engagement,
                a.institution_or_company, a.designation_or_course, a.contact_email, a.city,
                s.first_name || ' ' || s.last_name AS student_name, s.admission_number
         FROM alumni_records a
         JOIN students s ON s.id = a.student_id
         WHERE a.school_id = $1 AND a.consent_for_directory = true
         ORDER BY a.passing_year DESC, student_name ASC`,
        [schoolId],
      );
      return { items: rows };
    },
  );

  const createAlumniHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const { schoolId } = parseInput(schoolParams, request.params);
    const body = parseInput(createAlumniSchema, request.body);

    const { rows } = await pool.query(
      `INSERT INTO alumni_records
         (school_id, student_id, passing_year, class_graduated, stream, current_engagement,
          institution_or_company, designation_or_course, contact_email, city, consent_for_directory, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (school_id, student_id) DO UPDATE
         SET passing_year = EXCLUDED.passing_year,
             current_engagement = EXCLUDED.current_engagement,
             institution_or_company = EXCLUDED.institution_or_company,
             designation_or_course = EXCLUDED.designation_or_course,
             contact_email = EXCLUDED.contact_email,
             city = EXCLUDED.city
       RETURNING *`,
      [
        schoolId,
        body.studentId,
        body.passingYear,
        body.classGraduated,
        body.stream,
        body.currentEngagement,
        body.institutionOrCompany || null,
        body.designationOrCourse || null,
        body.contactEmail || null,
        body.city || null,
        body.consentForDirectory,
        body.notes || null,
      ],
    );
    return reply.code(201).send(rows[0]);
  };

  app.post(
    "/api/schools/:schoolId/alumni",
    { preHandler: requirePermission("school.manage") },
    createAlumniHandler,
  );
}
