import { getOperatingPolicy } from "../lib/institutionPolicy";
import { visibleSectionIds, canAccessSection } from "@erp/core";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { getActor, requirePermission } from "../auth/guards";
import { notFound, parseInput } from "../lib/errors";
import { recordAudit } from "../lib/audit";

const shortageParam = z.object({
  schoolId: z.string().uuid(),
  id: z.string().uuid(),
});

const warningInput = z.object({
  warningLevel: z.enum(["first", "second", "final"]),
  notes: z.string().trim().min(5).max(500),
});

const explanationInput = z.object({
  explanationText: z.string().trim().min(10).max(2000),
  medicalLeaveDays: z.coerce.number().min(0).max(60).default(0),
});

const decisionInput = z.object({
  internalExamEligibility: z.enum([
    "eligible",
    "conditional",
    "debarred",
    "under_review",
  ]),
  boardExamEligibility: z.enum([
    "eligible",
    "condonation_submitted",
    "condoned_by_board",
    "ineligible",
    "not_applicable",
    "under_review",
  ]),
  authorizedDecision: z.string().trim().min(5).max(100),
  decisionNotes: z.string().trim().min(5).max(1000),
});

export async function registerAttendancePolicyRoutes(
  app: FastifyInstance,
): Promise<void> {
  /* ------------------- GET /attendance/shortages ----------------------------- */
  app.get(
    "/api/schools/:schoolId/attendance/shortages",
    { preHandler: [requirePermission("attendance.register.view")] },
    async (request) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: z.string().uuid() }),
        request.params,
      );
      const pool = getPool();
      const scope = visibleSectionIds(getActor(request));
      const threshold = (await getOperatingPolicy(schoolId))
        .attendanceThreshold;

      // Get active academic year
      const { rows: yearRows } = await pool.query<{
        id: string;
        starts_on: string;
        ends_on: string;
      }>(
        `SELECT id, starts_on, ends_on FROM academic_years WHERE school_id = $1 AND status = 'active' LIMIT 1`,
        [schoolId],
      );

      const activeYear = yearRows[0];
      if (!activeYear) return { threshold, items: [] };

      // Calculate attendance rate for all actively enrolled students
      const { rows: attStats } = await pool.query<{
        student_id: string;
        admission_number: string;
        student_name: string;
        class_name: string;
        grade_order: number | null;
        section_name: string;
        total_marked: string;
        attended_days: string;
      }>(
        `SELECT
           s.id AS student_id,
           s.admission_number,
           concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
           c.name AS class_name,
           c.grade_order,
           sec.name AS section_name,
           count(sa.id)::text AS total_marked,
           coalesce(sum(
             CASE
               WHEN sa.status IN ('present', 'late') THEN 1
               WHEN sa.status = 'half_day' THEN 0.5
               ELSE 0
             END
           ), 0)::text AS attended_days
         FROM students s
         JOIN enrollments e ON e.student_id = s.id AND e.school_id = s.school_id AND e.enrollment_status = 'active'
         JOIN classes c ON c.id = e.class_id
         JOIN sections sec ON sec.id = e.section_id
         LEFT JOIN student_attendance sa
           ON sa.student_id = s.id AND sa.school_id = s.school_id
          AND sa.attendance_date >= $2 AND sa.attendance_date <= $3
         WHERE s.school_id = $1 AND e.academic_year_id = $4 AND ($5::uuid[] IS NULL OR e.section_id=ANY($5::uuid[]))
         GROUP BY s.id, s.admission_number, s.first_name, s.middle_name, s.last_name, c.name, c.grade_order, sec.name
         HAVING count(sa.id) >= 1`,
        [
          schoolId,
          activeYear.starts_on,
          activeYear.ends_on,
          activeYear.id,
          scope,
        ],
      );

      // Check and sync shortage cases
      for (const stat of attStats) {
        const marked = Number(stat.total_marked);
        const attended = Number(stat.attended_days);
        const rate =
          marked > 0 ? Number(((attended / marked) * 100).toFixed(2)) : 100;

        if (rate < threshold) {
          const isBoardClass =
            (stat.grade_order ?? 0) === 10 || (stat.grade_order ?? 0) === 12;
          await pool.query(
            `INSERT INTO attendance_shortage_cases
               (school_id, student_id, academic_year_id, calculated_attendance_rate, threshold_percent,
                total_working_days, days_attended, stage, board_exam_eligibility)
             VALUES ($1, $2, $3, $4, $8, $5, $6, 'potential_shortage', $7)
             ON CONFLICT (school_id, student_id, academic_year_id)
             DO UPDATE SET
               calculated_attendance_rate = EXCLUDED.calculated_attendance_rate,
               total_working_days = EXCLUDED.total_working_days,
               days_attended = EXCLUDED.days_attended, threshold_percent=EXCLUDED.threshold_percent`,
            [
              schoolId,
              stat.student_id,
              activeYear.id,
              rate,
              marked,
              attended,
              isBoardClass ? "under_review" : "not_applicable",
              threshold,
            ],
          );
        } else {
          await pool.query(
            `UPDATE attendance_shortage_cases SET calculated_attendance_rate=$4,total_working_days=$5,days_attended=$6,threshold_percent=$7,stage=CASE WHEN stage='decision_rendered' THEN stage ELSE 'resolved' END WHERE school_id=$1 AND student_id=$2 AND academic_year_id=$3`,
            [
              schoolId,
              stat.student_id,
              activeYear.id,
              rate,
              marked,
              attended,
              threshold,
            ],
          );
        }
      }

      // Return shortage register
      const { rows: shortageRows } = await pool.query<{
        id: string;
        student_id: string;
        admission_number: string;
        student_name: string;
        class_name: string;
        section_name: string;
        calculated_attendance_rate: number;
        total_working_days: number;
        days_attended: number;
        stage: string;
        warning_level: string;
        internal_exam_eligibility: string;
        board_exam_eligibility: string;
        explanation_text: string | null;
        medical_leave_days: number;
        authorized_decision: string | null;
      }>(
        `SELECT
           asc_case.id,
           s.id AS student_id,
           s.admission_number,
           concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
           c.name AS class_name,
           sec.name AS section_name,
           asc_case.calculated_attendance_rate,
           asc_case.total_working_days,
           asc_case.days_attended,
           asc_case.stage,
           asc_case.warning_level,
           asc_case.internal_exam_eligibility,
           asc_case.board_exam_eligibility,
           asc_case.explanation_text,
           asc_case.medical_leave_days,
           asc_case.authorized_decision
         FROM attendance_shortage_cases asc_case
         JOIN students s ON s.id = asc_case.student_id
         JOIN enrollments e ON e.student_id = s.id AND e.enrollment_status = 'active'
         JOIN classes c ON c.id = e.class_id
         JOIN sections sec ON sec.id = e.section_id
         WHERE asc_case.school_id = $1 AND asc_case.academic_year_id = $2 AND asc_case.calculated_attendance_rate<$4 AND ($3::uuid[] IS NULL OR e.section_id=ANY($3::uuid[]))
         ORDER BY asc_case.calculated_attendance_rate ASC`,
        [schoolId, activeYear.id, scope, threshold],
      );

      return {
        threshold,
        items: shortageRows.map((r) => ({
          id: r.id,
          studentId: r.student_id,
          admissionNumber: r.admission_number,
          studentName: r.student_name,
          className: r.class_name,
          sectionName: r.section_name,
          attendanceRate: Number(r.calculated_attendance_rate),
          totalWorkingDays: r.total_working_days,
          daysAttended: Number(r.days_attended),
          stage: r.stage,
          warningLevel: r.warning_level,
          internalExamEligibility: r.internal_exam_eligibility,
          boardExamEligibility: r.board_exam_eligibility,
          explanationText: r.explanation_text,
          medicalLeaveDays: Number(r.medical_leave_days),
          authorizedDecision: r.authorized_decision,
        })),
      };
    },
  );

  /* ------------------- POST /attendance/shortages/:id/warning ---------------- */
  app.post(
    "/api/schools/:schoolId/attendance/shortages/:id/warning",
    { preHandler: [requirePermission("attendance.correction.approve")] },
    async (request) => {
      const { schoolId, id } = parseInput(shortageParam, request.params);
      const input = parseInput(warningInput, request.body);
      const pool = getPool();
      await assertShortageScope(schoolId, id, getActor(request));

      const { rowCount } = await pool.query(
        `UPDATE attendance_shortage_cases
         SET warning_level = $1, stage = 'warning_issued'
         WHERE school_id = $2 AND id = $3`,
        [input.warningLevel, schoolId, id],
      );

      if (rowCount === 0) throw notFound("Attendance shortage case not found");

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: "attendance.shortage_warning.issued",
        entityType: "attendance_shortage_case",
        entityId: id,
        outcome: "success",
        after: { warningLevel: input.warningLevel, notes: input.notes },
      });

      return { status: "warning_issued", warningLevel: input.warningLevel };
    },
  );

  /* ------------------- POST /attendance/shortages/:id/explain ---------------- */
  app.post(
    "/api/schools/:schoolId/attendance/shortages/:id/explain",
    { preHandler: [requirePermission("attendance.correction.approve")] },
    async (request) => {
      const { schoolId, id } = parseInput(shortageParam, request.params);
      const input = parseInput(explanationInput, request.body);
      const pool = getPool();
      await assertShortageScope(schoolId, id, getActor(request));

      const { rowCount } = await pool.query(
        `UPDATE attendance_shortage_cases
         SET explanation_text = $1, medical_leave_days = $2, stage = 'explanation_received'
         WHERE school_id = $3 AND id = $4`,
        [input.explanationText, input.medicalLeaveDays, schoolId, id],
      );

      if (rowCount === 0) throw notFound("Attendance shortage case not found");

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: "attendance.shortage_explanation.recorded",
        entityType: "attendance_shortage_case",
        entityId: id,
        outcome: "success",
        after: { medicalLeaveDays: input.medicalLeaveDays },
      });

      return { status: "explanation_received", stage: "explanation_received" };
    },
  );

  /* ------------------- POST /attendance/shortages/:id/decision --------------- */
  app.post(
    "/api/schools/:schoolId/attendance/shortages/:id/decision",
    { preHandler: [requirePermission("attendance.correction.approve")] },
    async (request) => {
      const { schoolId, id } = parseInput(shortageParam, request.params);
      const input = parseInput(decisionInput, request.body);
      const pool = getPool();
      await assertShortageScope(schoolId, id, getActor(request));

      const { rowCount } = await pool.query(
        `UPDATE attendance_shortage_cases
         SET internal_exam_eligibility = $1,
             board_exam_eligibility = $2,
             authorized_decision = $3,
             decision_notes = $4,
             decided_by = $5,
             decided_at = now(),
             stage = 'decision_rendered'
         WHERE school_id = $6 AND id = $7`,
        [
          input.internalExamEligibility,
          input.boardExamEligibility,
          input.authorizedDecision,
          input.decisionNotes,
          request.user!.id,
          schoolId,
          id,
        ],
      );

      if (rowCount === 0) throw notFound("Attendance shortage case not found");

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: "attendance.shortage_decision.rendered",
        entityType: "attendance_shortage_case",
        entityId: id,
        outcome: "success",
        after: {
          decision: input.authorizedDecision,
          internalExamEligibility: input.internalExamEligibility,
          boardExamEligibility: input.boardExamEligibility,
        },
      });

      return {
        status: "decision_rendered",
        stage: "decision_rendered",
        authorizedDecision: input.authorizedDecision,
        internalExamEligibility: input.internalExamEligibility,
        boardExamEligibility: input.boardExamEligibility,
      };
    },
  );
}

async function assertShortageScope(
  schoolId: string,
  id: string,
  actor: import("../auth/session").ActorContext,
): Promise<void> {
  const rows = (
    await getPool().query<{ section_id: string }>(
      `SELECT e.section_id FROM attendance_shortage_cases c JOIN enrollments e ON e.school_id=c.school_id AND e.student_id=c.student_id AND e.academic_year_id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2`,
      [schoolId, id],
    )
  ).rows;
  if (!rows.some((r) => canAccessSection(actor, r.section_id)))
    throw notFound("Attendance case not found in assigned scope");
}
