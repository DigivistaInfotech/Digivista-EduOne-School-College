import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getPool } from '../db';
import { requirePermission } from '../auth/guards';
import { badRequest, notFound, parseInput } from '../lib/errors';
import { recordAudit } from '../lib/audit';

const eligibilityParam = z.object({
  schoolId: z.string().uuid(),
});

const createEligibilityInput = z.object({
  staffId: z.string().uuid(),
  subjectId: z.string().uuid(),
  qualification: z.string().trim().min(2).max(140),
  minGradeOrder: z.coerce.number().int().min(1).max(12).default(1),
  maxGradeOrder: z.coerce.number().int().min(1).max(12).default(12),
  maxWeeklyPeriods: z.coerce.number().int().min(1).max(50).default(30),
  verificationStatus: z.enum(['pending', 'verified', 'rejected']).default('verified'),
});

const checkAssignmentInput = z.object({
  staffId: z.string().uuid(),
  subjectId: z.string().uuid(),
  sectionId: z.string().uuid(),
  overrideReason: z.string().trim().max(300).optional(),
});

export async function registerTeacherEligibilityRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------- GET /staff/teacher-eligibility ------------------------ */
  app.get(
    '/api/schools/:schoolId/staff/teacher-eligibility',
    { preHandler: [requirePermission('hr.employee.view')] },
    async (request) => {
      const { schoolId } = parseInput(eligibilityParam, request.params);
      const pool = getPool();

      const { rows } = await pool.query<{
        id: string;
        staff_id: string;
        staff_name: string;
        employee_number: string;
        subject_id: string;
        subject_name: string;
        qualification: string;
        min_grade_order: number;
        max_grade_order: number;
        max_weekly_periods: number;
        verification_status: string;
      }>(
        `SELECT
           tep.id,
           st.id AS staff_id,
           st.full_name AS staff_name,
           st.employee_number,
           sub.id AS subject_id,
           sub.name AS subject_name,
           tep.qualification,
           tep.min_grade_order,
           tep.max_grade_order,
           tep.max_weekly_periods,
           tep.verification_status
         FROM teacher_eligibility_profiles tep
         JOIN staff st ON st.id = tep.staff_id
         JOIN subjects sub ON sub.id = tep.subject_id
         WHERE tep.school_id = $1
         ORDER BY st.full_name ASC, sub.name ASC`,
        [schoolId],
      );

      return {
        items: rows.map((r) => ({
          id: r.id,
          staffId: r.staff_id,
          staffName: r.staff_name,
          employeeNumber: r.employee_number,
          subjectId: r.subject_id,
          subjectName: r.subject_name,
          qualification: r.qualification,
          minGradeOrder: r.min_grade_order,
          maxGradeOrder: r.max_grade_order,
          maxWeeklyPeriods: r.max_weekly_periods,
          verificationStatus: r.verification_status,
        })),
      };
    },
  );

  /* ------------------- POST /staff/teacher-eligibility ----------------------- */
  app.post(
    '/api/schools/:schoolId/staff/teacher-eligibility',
    { preHandler: [requirePermission('hr.employee.manage')] },
    async (request) => {
      const { schoolId } = parseInput(eligibilityParam, request.params);
      const input = parseInput(createEligibilityInput, request.body);
      const pool = getPool();

      if (input.minGradeOrder > input.maxGradeOrder) {
        throw badRequest('Minimum class grade order cannot be greater than maximum class grade order.');
      }

      const { rows: inserted } = await pool.query<{ id: string }>(
        `INSERT INTO teacher_eligibility_profiles
           (school_id, staff_id, subject_id, qualification, min_grade_order, max_grade_order, max_weekly_periods, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (school_id, staff_id, subject_id)
         DO UPDATE SET
           qualification = EXCLUDED.qualification,
           min_grade_order = EXCLUDED.min_grade_order,
           max_grade_order = EXCLUDED.max_grade_order,
           max_weekly_periods = EXCLUDED.max_weekly_periods,
           verification_status = EXCLUDED.verification_status
         RETURNING id`,
        [
          schoolId,
          input.staffId,
          input.subjectId,
          input.qualification,
          input.minGradeOrder,
          input.maxGradeOrder,
          input.maxWeeklyPeriods,
          input.verificationStatus,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: 'hr.teacher_eligibility.recorded',
        entityType: 'teacher_eligibility_profile',
        entityId: inserted[0]!.id,
        outcome: 'success',
      });

      return {
        id: inserted[0]!.id,
        status: input.verificationStatus,
        profile: {
          id: inserted[0]!.id,
          staff_id: input.staffId,
          subject_id: input.subjectId,
          qualification: input.qualification,
          min_grade_order: input.minGradeOrder,
          max_grade_order: input.maxGradeOrder,
          max_weekly_periods: input.maxWeeklyPeriods,
          verification_status: input.verificationStatus,
        },
      };
    },
  );

  /* ------------------- POST /academic/check-teacher-assignment --------------- */
  app.post(
    '/api/schools/:schoolId/academic/check-teacher-assignment',
    { preHandler: [requirePermission('academic.structure.view')] },
    async (request) => {
      const { schoolId } = parseInput(eligibilityParam, request.params);
      const input = parseInput(checkAssignmentInput, request.body);
      const pool = getPool();

      // Check staff employment status
      const { rows: staffRows } = await pool.query<{ id: string; status: string; first_name: string; last_name: string | null }>(
        `SELECT id, status, first_name, last_name FROM staff WHERE school_id = $1 AND id = $2`,
        [schoolId, input.staffId],
      );
      if (!staffRows[0] || staffRows[0].status !== 'active') {
        return {
          valid: false,
          eligible: false,
          warnings: ['Teacher is not an active staff member.'],
          reason: 'Teacher is not an active staff member.',
          requiresOverride: false,
        };
      }
      const staffFullName = [staffRows[0].first_name, staffRows[0].last_name].filter(Boolean).join(' ');

      // Check section and class grade order
      const { rows: secRows } = await pool.query<{ grade_order: number | null; class_name: string }>(
        `SELECT c.grade_order, c.name AS class_name
         FROM sections sec
         JOIN classes c ON c.id = sec.class_id
         WHERE sec.school_id = $1 AND sec.id = $2`,
        [schoolId, input.sectionId],
      );
      if (!secRows[0]) throw notFound('Section not found');

      const targetGradeOrder = secRows[0].grade_order ?? 1;

      // Check eligibility profile
      const { rows: profRows } = await pool.query<{
        id: string;
        verification_status: string;
        min_grade_order: number;
        max_grade_order: number;
        qualification: string;
        max_weekly_periods: number;
      }>(
        `SELECT id, verification_status, min_grade_order, max_grade_order, qualification, max_weekly_periods
         FROM teacher_eligibility_profiles
         WHERE school_id = $1 AND staff_id = $2 AND subject_id = $3`,
        [schoolId, input.staffId, input.subjectId],
      );

      const profile = profRows[0];
      if (!profile) {
        if (input.overrideReason) {
          return {
            valid: true,
            eligible: true,
            overridden: true,
            warnings: ['Assigned without verified eligibility profile under authorized administrative override.'],
            warning: 'Assigned without verified eligibility profile under authorized administrative override.',
          };
        }
        return {
          valid: false,
          eligible: false,
          requiresOverride: true,
          warnings: [`No verified eligibility profile found for ${staffFullName} for this subject. An authorized override is required.`],
          reason: `No verified eligibility profile found for ${staffFullName} for this subject. An authorized override is required.`,
        };
      }

      if (profile.verification_status !== 'verified') {
        if (!input.overrideReason) {
          return {
            valid: false,
            eligible: false,
            requiresOverride: true,
            warnings: [`Teacher qualification verification status is "${profile.verification_status}".`],
            reason: `Teacher qualification verification status is "${profile.verification_status}".`,
          };
        }
      }

      if (targetGradeOrder < profile.min_grade_order || targetGradeOrder > profile.max_grade_order) {
        if (!input.overrideReason) {
          return {
            valid: false,
            eligible: false,
            requiresOverride: true,
            warnings: [`Target class (${secRows[0].class_name}) is outside teacher's verified grade range (Classes ${profile.min_grade_order}-${profile.max_grade_order}).`],
            reason: `Target class (${secRows[0].class_name}) is outside teacher's verified grade range (Classes ${profile.min_grade_order}-${profile.max_grade_order}).`,
          };
        }
      }

      // Check workload
      const { rows: countRows } = await pool.query<{ slot_count: string }>(
        `SELECT count(*)::text AS slot_count
         FROM timetable_slots ts
         JOIN staff st ON st.user_id = ts.teacher_user_id AND st.school_id = ts.school_id
         WHERE ts.school_id = $1 AND st.id = $2`,
        [schoolId, input.staffId],
      );

      const assignedPeriods = Number(countRows[0]?.slot_count ?? 0);
      if (assignedPeriods >= profile.max_weekly_periods && !input.overrideReason) {
        return {
          valid: false,
          eligible: false,
          requiresOverride: true,
          warnings: [`Workload exceeds maximum weekly periods (${assignedPeriods}/${profile.max_weekly_periods}).`],
          reason: `Workload exceeds maximum weekly periods (${assignedPeriods}/${profile.max_weekly_periods}).`,
        };
      }

      return {
        valid: true,
        eligible: true,
        warnings: [],
        qualification: profile.qualification,
        assignedPeriods,
        maxWeeklyPeriods: profile.max_weekly_periods,
      };
    },
  );
}
