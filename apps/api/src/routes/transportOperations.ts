import {
  previewTransportBulk,
  commitTransportBulk,
} from "../lib/transportBulk";
import { assertGuardianLinked } from "../lib/portal";
import { getTransportSubscription } from "../lib/transportSubscriptions";
import { todayInTimeZone } from "../lib/format";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { requirePermission, getActor, requestMeta } from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { badRequest, conflict, notFound, parseInput } from "../lib/errors";
import { recordAudit } from "../lib/audit";
export const tariffInput = z.object({
  routeId: z.string().uuid(),
  feeHeadId: z.string().uuid(),
  period: z.enum(["monthly", "term", "annual", "one_time"]),
  amount: z.number().min(0).max(99999999),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable().optional(),
  authorityReference: z.string().trim().max(200).optional(),
});
export async function addRouteTariff(
  db: pg.PoolClient,
  schoolId: string,
  userId: string,
  input: z.infer<typeof tariffInput>,
) {
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
    throw badRequest("Tariff end date must follow its start");
  if (
    !(
      await db.query(
        "SELECT id FROM transport_routes WHERE school_id=$1 AND id=$2 FOR UPDATE",
        [schoolId, input.routeId],
      )
    ).rowCount
  )
    throw notFound("Route not found");
  if (
    !(
      await db.query(
        `SELECT 1 FROM fee_heads WHERE school_id=$1 AND id=$2 AND status='active' AND (code ILIKE '%transport%' OR name ILIKE '%transport%')`,
        [schoolId, input.feeHeadId],
      )
    ).rowCount
  )
    throw badRequest("Select an active transport fee head");
  if (
    (
      await db.query(
        `SELECT 1 FROM transport_tariffs WHERE school_id=$1 AND route_id=$2 AND active AND effective_from<=coalesce($4::date,'infinity'::date) AND coalesce(effective_to,'infinity'::date)>=$3::date`,
        [
          schoolId,
          input.routeId,
          input.effectiveFrom,
          input.effectiveTo ?? null,
        ],
      )
    ).rowCount
  )
    throw conflict(
      "A tariff already covers these dates. Close it before adding a replacement tariff.",
    );
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO transport_tariffs(school_id,route_id,fee_head_id,period,amount,effective_from,effective_to,authority_reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        schoolId,
        input.routeId,
        input.feeHeadId,
        input.period,
        input.amount,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.authorityReference ?? null,
        userId,
      ],
    )
  ).rows[0]!.id;
  await recordAudit(db, {
    schoolId,
    actorUserId: userId,
    action: "transport.tariff_created",
    entityType: "transport_tariff",
    entityId: id,
    outcome: "success",
    after: input,
  });
  return id;
}
export async function registerTransportOperationsRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/transport/tariffs",
    { preHandler: requirePermission("transport.view") },
    async (req) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        req.params,
      );
      return {
        items: (
          await getPool().query(
            `SELECT t.id,t.route_id AS "routeId",r.name AS "routeName",t.fee_head_id AS "feeHeadId",f.name AS "feeHeadName",t.period,t.amount,t.effective_from::text AS "effectiveFrom",t.effective_to::text AS "effectiveTo",t.active,t.authority_reference AS "authorityReference" FROM transport_tariffs t JOIN transport_routes r ON r.school_id=t.school_id AND r.id=t.route_id JOIN fee_heads f ON f.school_id=t.school_id AND f.id=t.fee_head_id WHERE t.school_id=$1 ORDER BY t.effective_from DESC`,
            [schoolId],
          )
        ).rows,
      };
    },
  );
  app.post(
    "/api/schools/:schoolId/transport/tariffs",
    { preHandler: requirePermission("transport.manage") },
    async (req, reply) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        req.params,
      );
      const input = parseInput(tariffInput, req.body);
      const id = await withTransaction((db) =>
        addRouteTariff(db, schoolId, getActor(req).userId, input),
      );
      return reply.status(201).send({ id });
    },
  );
  app.patch(
    "/api/schools/:schoolId/transport/tariffs/:id",
    { preHandler: requirePermission("transport.manage") },
    async (req) => {
      const { schoolId, id } = parseInput(
        z.object({ schoolId: z.string().uuid(), id: z.string().uuid() }),
        req.params,
      );
      const input = parseInput(
        z.object({ effectiveTo: z.string().date() }),
        req.body,
      );
      return withTransaction(async (db) => {
        const old = (
          await db.query<{
            effective_from: string;
            effective_to: string | null;
          }>(
            "SELECT effective_from::text,effective_to::text FROM transport_tariffs WHERE school_id=$1 AND id=$2 FOR UPDATE",
            [schoolId, id],
          )
        ).rows[0];
        if (!old) throw notFound("Tariff not found");
        if (input.effectiveTo < old.effective_from)
          throw badRequest("End date precedes tariff start");
        if (old.effective_to && input.effectiveTo > old.effective_to)
          throw badRequest(
            "Use a new tariff instead of extending a closed tariff",
          );
        await db.query(
          "UPDATE transport_tariffs SET effective_to=$3 WHERE school_id=$1 AND id=$2",
          [schoolId, id, input.effectiveTo],
        );
        await recordAudit(db, {
          schoolId,
          actorUserId: getActor(req).userId,
          action: "transport.tariff_closed",
          entityType: "transport_tariff",
          entityId: id,
          outcome: "success",
          before: old,
          after: input,
          ...requestMeta(req),
        });
        return { id };
      });
    },
  );
  app.get(
    "/api/schools/:schoolId/transport/renewals",
    { preHandler: requirePermission("transport.view") },
    async (req) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        req.params,
      );
      return {
        items: (
          await getPool().query(
            `SELECT q.id,q.allocation_id AS "allocationId",q.requested_until::text AS "requestedUntil",q.reason,q.status,q.review_note AS "reviewNote",s.admission_number AS "admissionNumber",concat_ws(' ',s.first_name,s.last_name) AS "studentName",r.name AS "routeName",a.valid_until::text AS "validUntil" FROM transport_renewal_requests q JOIN student_transport_allocations a ON a.school_id=q.school_id AND a.id=q.allocation_id JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id JOIN transport_routes r ON r.school_id=a.school_id AND r.id=a.route_id WHERE q.school_id=$1 ORDER BY (q.status='pending') DESC,q.created_at DESC LIMIT 300`,
            [schoolId],
          )
        ).rows,
      };
    },
  );
  app.post(
    "/api/schools/:schoolId/transport/renewals/:id/review",
    { preHandler: requirePermission("transport.allocate") },
    async (req) => {
      const { schoolId, id } = parseInput(
        z.object({ schoolId: z.string().uuid(), id: z.string().uuid() }),
        req.params,
      );
      const input = parseInput(
        z.object({
          decision: z.enum(["approve", "reject"]),
          note: z.string().trim().min(3).max(500),
        }),
        req.body,
      );
      const actor = getActor(req);
      return withTransaction(async (db) => {
        const row = (
          await db.query<{
            allocation_id: string;
            requested_until: string;
            requested_by: string;
            status: string;
          }>(
            `SELECT allocation_id,requested_until::text,requested_by,status FROM transport_renewal_requests WHERE school_id=$1 AND id=$2 FOR UPDATE`,
            [schoolId, id],
          )
        ).rows[0];
        if (!row) throw notFound("Renewal request not found");
        if (row.status !== "pending")
          throw conflict("Renewal was already reviewed");
        if (row.requested_by === actor.userId)
          throw badRequest(
            "Another authorised person must review this request",
          );
        if (input.decision === "approve") {
          const a = (
            await db.query<{
              effective_from: string;
              valid_until: string | null;
            }>(
              `SELECT effective_from::text,valid_until::text FROM student_transport_allocations WHERE school_id=$1 AND id=$2 AND status='active' FOR UPDATE`,
              [schoolId, row.allocation_id],
            )
          ).rows[0];
          if (!a) throw badRequest("The allocation is no longer active");
          if (row.requested_until < (a.valid_until ?? a.effective_from))
            throw badRequest(
              "Requested expiry does not extend current validity",
            );
          await db.query(
            "UPDATE student_transport_allocations SET valid_until=$3 WHERE school_id=$1 AND id=$2",
            [schoolId, row.allocation_id, row.requested_until],
          );
        }
        await db.query(
          `UPDATE transport_renewal_requests SET status=$3,reviewed_by=$4,reviewed_at=now(),review_note=$5 WHERE school_id=$1 AND id=$2`,
          [
            schoolId,
            id,
            input.decision === "approve" ? "approved" : "rejected",
            actor.userId,
            input.note,
          ],
        );
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "transport.renewal_reviewed",
          entityType: "transport_renewal_request",
          entityId: id,
          outcome: "success",
          after: input,
          ...requestMeta(req),
        });
        return { id };
      });
    },
  );
  app.get(
    "/api/schools/:schoolId/transport/renewal-due",
    { preHandler: requirePermission("transport.view") },
    async (req) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        req.params,
      );
      const actor = getActor(req);
      const today = todayInTimeZone(actor.school.timezone);
      const allocations = (
        await getPool().query(
          `SELECT a.id,s.admission_number AS "admissionNumber",concat_ws(' ',s.first_name,s.last_name) AS "studentName",r.name AS "routeName",a.valid_until::text AS "validUntil",a.reminder_days AS "reminderDays",(a.valid_until-$2::date) AS "daysRemaining" FROM student_transport_allocations a JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id JOIN transport_routes r ON r.school_id=a.school_id AND r.id=a.route_id WHERE a.school_id=$1 AND a.status='active' AND a.valid_until IS NOT NULL AND a.valid_until<=$2::date+a.reminder_days ORDER BY a.valid_until`,
          [schoolId, today],
        )
      ).rows;
      const vehicles = (
        await getPool().query(
          `SELECT v.id,v.registration_number AS "registrationNumber",v.insurance_expires_on::text AS "insuranceExpiresOn",p.audit_details AS profile FROM transport_vehicles v LEFT JOIN transport_vehicle_profiles p ON p.school_id=v.school_id AND p.vehicle_id=v.id WHERE v.school_id=$1 AND v.status<>'retired'`,
          [schoolId],
        )
      ).rows;
      return {
        today,
        allocations,
        vehicles,
        note: "This is an in-application due list. No SMS, WhatsApp or email delivery is configured.",
      };
    },
  );
  const childParams = z.object({
    schoolId: z.string().uuid(),
    studentId: z.string().uuid(),
  });
  app.get(
    "/api/schools/:schoolId/portal/children/:studentId/transport/subscription",
    { preHandler: requirePermission("guardian.student.view") },
    async (req) => {
      const { schoolId, studentId } = parseInput(childParams, req.params);
      const actor = getActor(req);
      await assertGuardianLinked(getPool(), schoolId, actor.userId, studentId);
      return getTransportSubscription(
        getPool(),
        schoolId,
        studentId,
        todayInTimeZone(actor.school.timezone),
      );
    },
  );
  app.post(
    "/api/schools/:schoolId/portal/children/:studentId/transport/renewals",
    { preHandler: requirePermission("guardian.student.view") },
    async (req, reply) => {
      const { schoolId, studentId } = parseInput(childParams, req.params);
      const actor = getActor(req);
      await assertGuardianLinked(getPool(), schoolId, actor.userId, studentId);
      const input = parseInput(
        z.object({
          requestedUntil: z.string().date(),
          reason: z.string().trim().max(500).default(""),
        }),
        req.body,
      );
      const id = await requestRenewal(
        schoolId,
        studentId,
        actor.userId,
        input.requestedUntil,
        input.reason,
        todayInTimeZone(actor.school.timezone),
      );
      return reply.status(201).send({ id, status: "pending" });
    },
  );
  app.get(
    "/api/schools/:schoolId/student/transport/subscription",
    { preHandler: requirePermission("student.profile.view") },
    async (req) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        req.params,
      );
      const actor = getActor(req);
      const student = (
        await getPool().query<{ id: string }>(
          "SELECT id FROM students WHERE school_id=$1 AND user_id=$2",
          [schoolId, actor.userId],
        )
      ).rows[0];
      if (!student) throw notFound("Student not found");
      return getTransportSubscription(
        getPool(),
        schoolId,
        student.id,
        todayInTimeZone(actor.school.timezone),
      );
    },
  );
  app.post(
    "/api/schools/:schoolId/student/transport/renewals",
    { preHandler: requirePermission("student.profile.view") },
    async (req, reply) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        req.params,
      );
      const actor = getActor(req);
      const student = (
        await getPool().query<{ id: string }>(
          "SELECT id FROM students WHERE school_id=$1 AND user_id=$2",
          [schoolId, actor.userId],
        )
      ).rows[0];
      if (!student) throw notFound("Student not found");
      const input = parseInput(
        z.object({
          requestedUntil: z.string().date(),
          reason: z.string().trim().max(500).default(""),
        }),
        req.body,
      );
      const id = await requestRenewal(
        schoolId,
        student.id,
        actor.userId,
        input.requestedUntil,
        input.reason,
        todayInTimeZone(actor.school.timezone),
      );
      return reply.status(201).send({ id, status: "pending" });
    },
  );

  app.post(
    "/api/schools/:schoolId/transport/allocations/bulk",
    { preHandler: requirePermission("transport.allocate") },
    async (req) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        req.params,
      );
      const input = parseInput(
        z.object({
          csv: z.string().min(1).max(1000000),
          mode: z.enum(["preview", "commit"]),
          confirmPreview: z.boolean().optional(),
        }),
        req.body,
      );
      const actor = getActor(req);
      const today = todayInTimeZone(actor.school.timezone);
      if (input.mode === "commit" && !input.confirmPreview)
        throw badRequest("Preview the import and confirm it first");
      return withTransaction(async (db) => {
        const result =
          input.mode === "preview"
            ? await previewTransportBulk(db, schoolId, input.csv, today)
            : await commitTransportBulk(
                db,
                schoolId,
                actor.userId,
                input.csv,
                today,
              );
        if (input.mode === "commit")
          await recordAudit(db, {
            schoolId,
            actorUserId: actor.userId,
            action: "transport.bulk_allocated",
            entityType: "school",
            entityId: schoolId,
            outcome: "success",
            after: {
              created: result.createCount,
              unchanged: result.unchangedCount,
              rows: result.rows.length,
            },
            ...requestMeta(req),
          });
        return result;
      });
    },
  );
}

async function requestRenewal(
  schoolId: string,
  studentId: string,
  userId: string,
  requestedUntil: string,
  reason: string,
  today: string,
) {
  return withTransaction(async (db) => {
    const allocation = (
      await db.query<{
        id: string;
        valid_until: string | null;
        effective_from: string;
      }>(
        `SELECT id,valid_until::text,effective_from::text FROM student_transport_allocations WHERE school_id=$1 AND student_id=$2 AND status='active' FOR UPDATE`,
        [schoolId, studentId],
      )
    ).rows[0];
    if (!allocation) throw notFound("Active allocation not found");
    if (
      requestedUntil <= today ||
      requestedUntil <= (allocation.valid_until ?? allocation.effective_from)
    )
      throw badRequest(
        "Choose a future expiry after current transport validity",
      );
    if (
      (
        await db.query(
          `SELECT 1 FROM transport_renewal_requests WHERE school_id=$1 AND allocation_id=$2 AND status='pending'`,
          [schoolId, allocation.id],
        )
      ).rowCount
    )
      throw conflict("A renewal request is already pending");
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO transport_renewal_requests(school_id,allocation_id,requested_until,requested_by,reason) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [schoolId, allocation.id, requestedUntil, userId, reason],
      )
    ).rows[0]!.id;
    await recordAudit(db, {
      schoolId,
      actorUserId: userId,
      action: "transport.renewal_requested",
      entityType: "transport_renewal_request",
      entityId: id,
      outcome: "success",
      after: { allocationId: allocation.id, requestedUntil, reason },
    });
    return id;
  });
}
