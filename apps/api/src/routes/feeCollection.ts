import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { canAccessSection, visibleSectionIds } from "@erp/core";
import { getPool, withTransaction } from "../db";
import {
  getActor,
  requireAnyPermission,
  requirePermission,
  requestMeta,
} from "../auth/guards";
import { badRequest, forbidden, notFound, parseInput } from "../lib/errors";
import { recordAudit } from "../lib/audit";
import {
  getOperatingPolicy,
  operatingPolicyInput,
} from "../lib/institutionPolicy";
import { loadLedger } from "./fees";
import { todayInTimeZone } from "../lib/format";
const params = z.object({ schoolId: z.string().uuid() });
export async function registerFeeCollectionRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/operating-policy",
    { preHandler: requirePermission("school.view") },
    async (req) => ({
      policy: await getOperatingPolicy(parseInput(params, req.params).schoolId),
    }),
  );
  app.put(
    "/api/schools/:schoolId/operating-policy",
    { preHandler: requirePermission("school.manage") },
    async (req) => {
      const { schoolId } = parseInput(params, req.params);
      const actor = getActor(req);
      const policy = parseInput(operatingPolicyInput, req.body);
      return withTransaction(async (db) => {
        const before = (
          await db.query(
            "SELECT policy FROM institution_operating_policy WHERE school_id=$1 FOR UPDATE",
            [schoolId],
          )
        ).rows[0]?.policy;
        await db.query(
          `INSERT INTO institution_operating_policy(school_id,policy,updated_by) VALUES($1,$2,$3) ON CONFLICT(school_id) DO UPDATE SET policy=excluded.policy,version=institution_operating_policy.version+1,updated_by=excluded.updated_by,updated_at=now()`,
          [schoolId, JSON.stringify(policy), actor.userId],
        );
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "institution.operating_policy_updated",
          entityType: "school",
          entityId: schoolId,
          outcome: "success",
          before,
          after: policy,
          ...requestMeta(req),
        });
        return { policy };
      });
    },
  );
  app.get(
    "/api/schools/:schoolId/fee-collection",
    {
      preHandler: requireAnyPermission(
        "fees.collection.record",
        "fees.payment.verify",
      ),
    },
    async (req) => {
      const { schoolId } = parseInput(params, req.params);
      const actor = getActor(req);
      const policy = await getOperatingPolicy(schoolId);
      assertCollectorReadAccess(actor, policy);
      const scope = visibleSectionIds(actor);
      const students = (
        await getPool().query(
          `SELECT s.id,concat_ws(' ',s.first_name,s.last_name) AS name,s.admission_number AS "admissionNumber",e.section_id AS "sectionId",c.name AS "className",sec.name AS "sectionName",c.grade_order AS grade
 FROM students s JOIN enrollments e ON e.school_id=s.school_id AND e.student_id=s.id AND e.enrollment_status='active' JOIN academic_years y ON y.id=e.academic_year_id AND y.status='active' JOIN sections sec ON sec.id=e.section_id JOIN classes c ON c.id=sec.class_id
 WHERE s.school_id=$1 AND ($2::uuid[] IS NULL OR e.section_id=ANY($2::uuid[])) ORDER BY c.grade_order,sec.name,s.first_name`,
          [schoolId, scope],
        )
      ).rows;
      const entries = (
        await getPool().query(
          `SELECT a.id,a.student_id AS "studentId",a.amount,a.reference_number AS reference,a.payment_date::text AS date,a.status,a.collector_user_id AS "collectorId" FROM fee_offline_payment_acknowledgements a WHERE a.school_id=$1 AND a.collector_user_id IS NOT NULL AND (a.collector_user_id=$2 OR $3) ORDER BY a.created_at DESC LIMIT 200`,
          [
            schoolId,
            actor.userId,
            actor.permissions.has("fees.payment.verify"),
          ],
        )
      ).rows;
      return { policy, students, entries };
    },
  );
  app.get(
    "/api/schools/:schoolId/fee-collection/:studentId/ledger",
    {
      preHandler: requireAnyPermission(
        "fees.collection.record",
        "fees.payment.verify",
      ),
    },
    async (req) => {
      const { schoolId, studentId } = parseInput(
        params.extend({ studentId: z.string().uuid() }),
        req.params,
      );
      const actor = getActor(req);
      assertCollectorReadAccess(actor, await getOperatingPolicy(schoolId));
      const section = (
        await getPool().query<{ section_id: string }>(
          `SELECT section_id FROM enrollments WHERE school_id=$1 AND student_id=$2 AND enrollment_status='active' ORDER BY starts_on DESC LIMIT 1`,
          [schoolId, studentId],
        )
      ).rows[0];
      if (!section || !canAccessSection(actor, section.section_id))
        throw notFound("Student not found in assigned scope");
      return loadLedger(getPool(), schoolId, studentId, null);
    },
  );
  app.post(
    "/api/schools/:schoolId/fee-collection",
    {
      preHandler: requireAnyPermission(
        "fees.collection.record",
        "fees.payment.verify",
      ),
    },
    async (req, reply) => {
      const { schoolId } = parseInput(params, req.params);
      const actor = getActor(req);
      const input = parseInput(
        z.object({
          studentId: z.string().uuid(),
          amount: z.number().positive().max(10000000).multipleOf(0.01),
          method: z.enum([
            "cash",
            "cheque",
            "bank_transfer",
            "upi",
            "demand_draft",
            "pos_slip",
            "other",
          ]),
          reference: z.string().trim().min(2).max(120),
          date: z.string().date(),
          notes: z.string().trim().max(500).default(""),
        }),
        req.body,
      );
      const policy = await getOperatingPolicy(schoolId);
      const today = todayInTimeZone(actor.school.timezone);
      if (
        !policy.collectionEnabled ||
        !policy.effectiveFrom ||
        policy.effectiveFrom > today
      )
        throw badRequest("Collection policy is not active");
      if (input.date > today || input.date < policy.effectiveFrom)
        throw badRequest("Collection date is outside the active policy period");
      const teacher =
        actor.roleCodes.includes("teacher") ||
        actor.roleCodes.includes("teacher_fee_collector");
      const central = actor.roleCodes.some((r) =>
        [
          "finance",
          "central_fee_collector",
          "main_admin",
          "school_admin",
        ].includes(r),
      );
      if (policy.feeCollectionMode === "central" && !central)
        throw forbidden("Use the central collection department");
      if (
        policy.feeCollectionMode === "assigned_teacher" &&
        !central &&
        !teacher
      )
        throw forbidden();
      const id = await withTransaction(async (db) => {
        await db.query(
          "SELECT id FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE",
          [schoolId, input.studentId],
        );
        const enrollment = (
          await db.query<{ section_id: string; grade_order: number | null }>(
            `SELECT e.section_id,c.grade_order FROM enrollments e JOIN classes c ON c.id=e.class_id JOIN academic_years y ON y.id=e.academic_year_id AND y.status='active' WHERE e.school_id=$1 AND e.student_id=$2 AND e.enrollment_status='active' ORDER BY e.starts_on DESC LIMIT 1`,
            [schoolId, input.studentId],
          )
        ).rows[0];
        if (!enrollment || !canAccessSection(actor, enrollment.section_id))
          throw notFound("Student not found in assigned scope");
        if (
          policy.management !== "private" &&
          (enrollment.grade_order === null || enrollment.grade_order <= 8)
        )
          throw badRequest(
            "Government elementary collection is blocked. Review the applicable free-education rules with the school authority",
          );
        const ledger = await loadLedger(db, schoolId, input.studentId, null);
        const pending = (
          await db.query<{ amount: string }>(
            `SELECT coalesce(sum(amount),0)::text AS amount FROM fee_offline_payment_acknowledgements WHERE school_id=$1 AND student_id=$2 AND status IN('pending','under_review','more_info_needed','unmatched')`,
            [schoolId, input.studentId],
          )
        ).rows[0]!;
        if (
          Math.round(input.amount * 100) >
          Math.round((ledger.balance - Number(pending.amount)) * 100)
        )
          throw badRequest(
            "Collection exceeds the outstanding balance after pending submissions",
          );
        const row = (
          await db.query<{ id: string }>(
            `INSERT INTO fee_offline_payment_acknowledgements(school_id,student_id,amount,payment_method,reference_number,payment_date,notes,collector_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [
              schoolId,
              input.studentId,
              input.amount,
              input.method,
              input.reference,
              input.date,
              input.notes,
              actor.userId,
            ],
          )
        ).rows[0]!;
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "fees.collection_recorded",
          entityType: "fee_offline_payment_acknowledgement",
          entityId: row.id,
          outcome: "success",
          after: { ...input, status: "pending" },
          ...requestMeta(req),
        });
        return row.id;
      });
      return reply
        .status(201)
        .send({
          id,
          status: "pending",
          message:
            "Recorded for independent finance verification. The ledger changes only after verification.",
        });
    },
  );
  app.get(
    "/api/schools/:schoolId/attendance/policy-reviews",
    { preHandler: requirePermission("attendance.register.view") },
    async (req) => {
      const { schoolId } = parseInput(params, req.params);
      const actor = getActor(req);
      const scope = visibleSectionIds(actor);
      const policy = await getOperatingPolicy(schoolId);
      const active =
        !!policy.effectiveFrom &&
        policy.effectiveFrom <= todayInTimeZone(actor.school.timezone);
      const items = (
        await getPool().query<{
          id: string;
          name: string;
          admissionNumber: string;
          grade: number | null;
          lateDays: number;
          absentDays: number;
        }>(
          `SELECT s.id,concat_ws(' ',s.first_name,s.last_name) AS name,s.admission_number AS "admissionNumber",c.grade_order AS grade,count(a.id) FILTER(WHERE a.status='late')::int AS "lateDays",count(a.id) FILTER(WHERE a.status='absent')::int AS "absentDays" FROM students s JOIN enrollments e ON e.school_id=s.school_id AND e.student_id=s.id AND e.enrollment_status='active' JOIN academic_years y ON y.id=e.academic_year_id AND y.status='active' JOIN classes c ON c.id=e.class_id LEFT JOIN student_attendance a ON a.school_id=s.school_id AND a.student_id=s.id AND a.attendance_date BETWEEN greatest(y.starts_on,$3::date) AND y.ends_on WHERE s.school_id=$1 AND ($2::uuid[] IS NULL OR e.section_id=ANY($2::uuid[])) GROUP BY s.id,c.grade_order`,
          [schoolId, scope, policy.effectiveFrom ?? "9999-12-31"],
        )
      ).rows
        .map((item) => {
          const protectedStudent = item.grade === null || item.grade <= 8;
          const lateReview =
            active &&
            policy.lateReviewAfterDays !== null &&
            item.lateDays >= policy.lateReviewAfterDays;
          const absenceReview =
            active &&
            policy.absenceReviewAfterDays !== null &&
            item.absentDays >= policy.absenceReviewAfterDays;
          const terminationReview =
            active &&
            !protectedStudent &&
            policy.terminationReviewAfterDays !== null &&
            item.absentDays >= policy.terminationReviewAfterDays;
          return {
            ...item,
            lateReview,
            absenceReview,
            terminationReview,
            protectedStudent,
            proposedFine:
              !protectedStudent &&
              (item.grade ?? 0) >= policy.minGradeForFinancialReview
                ? (lateReview ? policy.lateFineProposalAmount : 0) +
                  (absenceReview ? policy.absenceFineProposalAmount : 0)
                : 0,
            penaltyApplied: false,
            terminationApplied: false,
          };
        })
        .filter((i) => i.lateReview || i.absenceReview || i.terminationReview);
      return {
        policy,
        active,
        items,
        note: "Counts are recorded late/absent days in the active year from the policy effective date, not consecutive calendar days. Proposals require authority review; no charge or withdrawal is created.",
      };
    },
  );
}

function assertCollectorReadAccess(
  actor: import("../auth/session").ActorContext,
  policy: import("../lib/institutionPolicy").OperatingPolicy,
): void {
  if (
    actor.roleCodes.some((r) =>
      [
        "finance",
        "central_fee_collector",
        "main_admin",
        "school_admin",
      ].includes(r),
    )
  )
    return;
  if (
    !policy.collectionEnabled ||
    policy.management === "private" ||
    policy.feeCollectionMode !== "assigned_teacher" ||
    !policy.effectiveFrom ||
    policy.effectiveFrom > todayInTimeZone(actor.school.timezone)
  )
    throw forbidden(
      "Teacher collection access requires an active assigned-teacher government-school policy",
    );
}
