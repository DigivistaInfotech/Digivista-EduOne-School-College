import { todayInTimeZone } from "../lib/format";
import { getOperatingPolicy } from "../lib/institutionPolicy";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool, withTransaction } from "../db";
import { substituteCandidates } from "../lib/substituteCandidates";
import { canAccessSection, visibleSectionIds } from "@erp/core";
import { requireAuth, requireAnyPermission, getActor } from "../auth/guards";
import { notFound, badRequest } from "../lib/errors";
import { assertGuardianLinked } from "../lib/portal";
import { recordAudit } from "../lib/audit";
import type {
  AdvancedAttendanceSummary,
  PeriodAttendanceItem,
  SubjectWiseAttendanceItem,
} from "@erp/shared";

const schoolParams = z.object({
  schoolId: z.string().uuid(),
});

const studentAttendanceParams = z.object({
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
});

const periodAttendanceBody = z.object({
  date: z.string().date(),
  periodId: z.string().uuid(),
  subjectId: z.string().uuid(),
  teacherUserId: z.string().uuid().optional(),
  substituteTeacherUserId: z.string().uuid().optional(),
  records: z.array(
    z.object({
      studentId: z.string().uuid(),
      status: z.enum(["present", "absent", "late", "excused", "unmarked"]),
      notes: z.string().max(200).optional(),
    }),
  ),
});

const substitutionBody = z.object({
  slotId: z.string().uuid(),
  substitutionDate: z.string().date(),
  substituteTeacherUserId: z.string().uuid(),
  reason: z.string().min(3).max(300),
});

export async function advancedAttendanceRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * Comprehensive advanced attendance endpoint matching the Classes 6-12 attendance specification.
   * Accessible by authorized staff, the student themselves, or verified linked parents.
   */
  app.get(
    "/api/schools/:schoolId/students/:studentId/attendance/advanced",
    { preHandler: requireAuth },
    async (request) => {
      const { schoolId, studentId } = studentAttendanceParams.parse(
        request.params,
      );
      const queryDate = (request.query as { date?: string })?.date;
      const actor = getActor(request);
      const pool = getPool();

      // Access verification:
      // 1. If staff with attendance.register.view or students.profile.view
      const hasStaffPermission =
        actor.permissions.has("attendance.register.view") ||
        actor.permissions.has("students.profile.view");

      if (!hasStaffPermission) {
        // 2. Check if student themselves
        const studentRow = await pool.query<{
          id: string;
          user_id: string | null;
        }>(
          "SELECT id, user_id FROM students WHERE school_id = $1 AND id = $2",
          [schoolId, studentId],
        );
        if (!studentRow.rows[0]) throw notFound("Student not found");

        const isOwnStudent = studentRow.rows[0].user_id === actor.userId;
        if (!isOwnStudent) {
          // 3. Check if verified linked guardian
          await assertGuardianLinked(pool, schoolId, actor.userId, studentId);
        }
      }

      // Fetch student details, current enrollment, class, section, stream
      const studentInfo = await pool.query<{
        id: string;
        first_name: string;
        last_name: string | null;
        admission_number: string;
        roll_number: string | null;
        class_name: string;
        class_code: string;
        grade_order: number | null;
        section_name: string;
        section_id: string;
        enrollment_id: string;
        academic_year_id: string;
        academic_year_name: string;
        stream: string | null;
      }>(
        `SELECT s.id, s.first_name, s.last_name, s.admission_number, s.roll_number,
                c.name AS class_name, c.code AS class_code, c.grade_order,
                sec.name AS section_name, sec.id AS section_id,
                e.id AS enrollment_id, ay.id AS academic_year_id, ay.name AS academic_year_name,
                COALESCE(e.stream, sec.stream, 'general') AS stream
         FROM students s
         JOIN enrollments e ON e.student_id = s.id AND e.school_id = s.school_id AND e.enrollment_status = 'active'
         JOIN sections sec ON sec.id = e.section_id AND sec.school_id = s.school_id
         JOIN classes c ON c.id = sec.class_id AND c.school_id = s.school_id
         JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.school_id = s.school_id
         WHERE s.school_id = $1 AND s.id = $2
         LIMIT 1`,
        [schoolId, studentId],
      );

      if (!studentInfo.rows[0]) {
        throw notFound("Active student enrollment not found");
      }

      const info = studentInfo.rows[0];
      const enrollmentId = info.enrollment_id;
      const sectionId = info.section_id;
      if (hasStaffPermission && !canAccessSection(actor, sectionId,'attendance.register.view') && !canAccessSection(actor,sectionId,'students.profile.view'))
        throw notFound("Student not found in your assigned sections");
      const academicYearId = info.academic_year_id;

      // Cumulative attendance counts
      const cumulativeCounts = await pool.query<{
        total_days: string;
        present_days: string;
        absent_days: string;
        late_days: string;
        half_days: string;
        excused_days: string;
      }>(
        `SELECT
           COUNT(*)::text AS total_days,
           COUNT(*) FILTER (WHERE status = 'present')::text AS present_days,
           COUNT(*) FILTER (WHERE status = 'absent')::text AS absent_days,
           COUNT(*) FILTER (WHERE status = 'late')::text AS late_days,
           COUNT(*) FILTER (WHERE status = 'half_day')::text AS half_days,
           COUNT(*) FILTER (WHERE status = 'excused')::text AS excused_days
         FROM student_attendance
         WHERE school_id = $1 AND enrollment_id = $2`,
        [schoolId, enrollmentId],
      );

      const cRow = cumulativeCounts.rows[0] || {
        total_days: "0",
        present_days: "0",
        absent_days: "0",
        late_days: "0",
        half_days: "0",
        excused_days: "0",
      };

      const totalDays = parseInt(cRow.total_days, 10) || 0;
      const presentDays = parseInt(cRow.present_days, 10) || 0;
      const absentDays = parseInt(cRow.absent_days, 10) || 0;
      const lateDays = parseInt(cRow.late_days, 10) || 0;
      const halfDays = parseInt(cRow.half_days, 10) || 0;
      const excusedDays = parseInt(cRow.excused_days, 10) || 0;

      // Credit present + late + half_day (0.5)
      const effectiveAttended = presentDays + lateDays + halfDays * 0.5;
      const cumulativePercentage =
        totalDays > 0 ? Math.round((effectiveAttended / totalDays) * 100) : 100;

      // Month-wise breakdown
      const monthRows = await pool.query<{
        m_num: number;
        m_name: string;
        yr: number;
        total: string;
        present: string;
      }>(
        `SELECT
           EXTRACT(MONTH FROM attendance_date)::int AS m_num,
           TO_CHAR(attendance_date, 'Mon') AS m_name,
           EXTRACT(YEAR FROM attendance_date)::int AS yr,
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE status IN ('present', 'late', 'half_day'))::text AS present
         FROM student_attendance
         WHERE school_id = $1 AND enrollment_id = $2
         GROUP BY yr, m_num, m_name
         ORDER BY yr ASC, m_num ASC`,
        [schoolId, enrollmentId],
      );

      const monthWise = monthRows.rows.map((row) => {
        const mTotal = parseInt(row.total, 10) || 0;
        const mPresent = parseInt(row.present, 10) || 0;
        const pct = mTotal > 0 ? Math.round((mPresent / mTotal) * 100) : 100;
        return {
          month: row.m_name,
          year: row.yr,
          totalDays: mTotal,
          presentDays: mPresent,
          percentage: pct,
        };
      });

      // Target date for period-wise view
      let targetDate = queryDate;
      if (!targetDate) {
        const latestDateQuery = await pool.query<{ latest_date: string }>(
          `SELECT TO_CHAR(COALESCE(MAX(attendance_date), CURRENT_DATE), 'YYYY-MM-DD') AS latest_date
           FROM student_attendance
           WHERE school_id = $1 AND enrollment_id = $2`,
          [schoolId, enrollmentId],
        );
        targetDate =
          latestDateQuery.rows[0]?.latest_date ||
          new Date().toISOString().slice(0, 10);
      }

      // Check day of week for timetable matching (1=Monday ... 7=Sunday)
      const dayOfWeekQuery = await pool.query<{ dow: number }>(
        `SELECT EXTRACT(ISODOW FROM $1::date)::int AS dow`,
        [targetDate],
      );
      const dayOfWeek = dayOfWeekQuery.rows[0]?.dow || 1;

      // Period-wise records for the chosen date
      const periodRows = await pool.query<{
        period_no: number;
        period_name: string;
        starts_at: string;
        ends_at: string;
        subject_name: string;
        teacher_name: string | null;
        employee_code: string | null;
        substitute_name: string | null;
        status: string | null;
      }>(
        `SELECT
           tp.sequence_no AS period_no,
           tp.name AS period_name,
           TO_CHAR(tp.starts_at, 'HH24:MI') AS starts_at,
           TO_CHAR(tp.ends_at, 'HH24:MI') AS ends_at,
           COALESCE(sub.name, 'Activity') AS subject_name,
           COALESCE(st.first_name || ' ' || COALESCE(st.last_name, ''), u.display_name, 'Teacher') AS teacher_name,
           COALESCE(st.employee_number, 'EMP1001') AS employee_code,
           subst_u.display_name AS substitute_name,
           COALESCE(spa.status, CASE WHEN sa.status IS NOT NULL THEN sa.status ELSE 'unmarked' END) AS status
         FROM timetable_periods tp
         LEFT JOIN timetable_slots ts
           ON ts.period_id = tp.id AND ts.section_id = $3 AND ts.day_of_week = $4
         LEFT JOIN subjects sub ON sub.id = ts.subject_id
         LEFT JOIN users u ON u.id = ts.teacher_user_id
         LEFT JOIN staff st ON st.user_id = ts.teacher_user_id AND st.school_id = tp.school_id
         LEFT JOIN timetable_substitutions tsub
           ON tsub.slot_id = ts.id AND tsub.substitution_date = $5::date AND tsub.status = 'active'
         LEFT JOIN users subst_u ON subst_u.id = tsub.substitute_teacher_user_id
         LEFT JOIN student_period_attendance spa
           ON spa.period_id = tp.id AND spa.student_id = $2 AND spa.attendance_date = $5::date
         LEFT JOIN student_attendance sa
           ON sa.student_id = $2 AND sa.attendance_date = $5::date
         WHERE tp.school_id = $1 AND tp.academic_year_id = $6 AND tp.is_break = false
         ORDER BY tp.sequence_no ASC`,
        [schoolId, studentId, sectionId, dayOfWeek, targetDate, academicYearId],
      );

      const periodItems: PeriodAttendanceItem[] = periodRows.rows.map(
        (row) => ({
          periodNumber: row.period_no,
          name: row.period_name,
          time: `${row.starts_at} - ${row.ends_at}`,
          subjectName: row.subject_name,
          teacherName: row.teacher_name || "Subject Teacher",
          teacherCode: row.employee_code || "EMP1000",
          isSubstitute: Boolean(row.substitute_name),
          substituteTeacherName: row.substitute_name,
          status: (row.status as any) || "unmarked",
        }),
      );

      const markedCount = periodItems.filter(
        (p) => p.status !== "unmarked",
      ).length;
      const presentPeriodCount = periodItems.filter(
        (p) => p.status === "present" || p.status === "late",
      ).length;
      const absentPeriodCount = periodItems.filter(
        (p) => p.status === "absent",
      ).length;

      // Subject-wise attendance calculation
      const subjectWiseRows = await pool.query<{
        subject_id: string;
        subject_name: string;
        subject_code: string;
        teacher_name: string | null;
        employee_code: string | null;
        classes_held: string;
        classes_attended: string;
      }>(
        `SELECT
           sub.id AS subject_id,
           sub.name AS subject_name,
           sub.code AS subject_code,
           COALESCE(st.first_name || ' ' || COALESCE(st.last_name, ''), u.display_name, 'Teacher') AS teacher_name,
           COALESCE(st.employee_number, 'EMP1034') AS employee_code,
           COUNT(DISTINCT spa.id)::text AS classes_held,
           COUNT(DISTINCT spa.id) FILTER (WHERE spa.status IN ('present', 'late', 'half_day'))::text AS classes_attended
         FROM subjects sub
         JOIN timetable_slots ts ON ts.subject_id = sub.id AND ts.section_id = $3
         LEFT JOIN users u ON u.id = ts.teacher_user_id
         LEFT JOIN staff st ON st.user_id = ts.teacher_user_id AND st.school_id = sub.school_id
         LEFT JOIN student_period_attendance spa
           ON spa.subject_id = sub.id AND spa.student_id = $2
         WHERE sub.school_id = $1
         GROUP BY sub.id, sub.name, sub.code, st.first_name, st.last_name, u.display_name, st.employee_number
         ORDER BY sub.name ASC`,
        [schoolId, studentId, sectionId],
      );

      const subjectWise: SubjectWiseAttendanceItem[] = subjectWiseRows.rows.map(
        (row) => {
          const held = parseInt(row.classes_held, 10) || 0;
          const attended = parseInt(row.classes_attended, 10) || 0;

          const missed = Math.max(0, held - attended);
          const pct = held > 0 ? Math.round((attended / held) * 100) : 0;

          return {
            subjectId: row.subject_id,
            subjectName: row.subject_name,
            subjectCode: row.subject_code,
            teacherName: row.teacher_name || "Teacher",
            teacherCode: row.employee_code || "EMP1000",
            classesHeld: held,
            classesAttended: attended,
            classesMissed: missed,
            percentage: pct,
          };
        },
      );

      // Attendance shortage calculation & status
      const isSeniorBoardClass =
        info.grade_order === 10 || info.grade_order === 12;
      const requiredThreshold = (await getOperatingPolicy(schoolId))
        .attendanceThreshold;
      const boardThreshold = 75;

      let shortageStatus:
        | "normal"
        | "preventive_warning"
        | "shortage_alert"
        | "examination_review" = "normal";
      let shortageMessage =
        "Attendance is above the configured school warning threshold.";

      if (cumulativePercentage < boardThreshold) {
        shortageStatus = "examination_review";
        shortageMessage = isSeniorBoardClass
          ? `Urgent: Attendance (${cumulativePercentage}%) is below the mandatory 75% CBSE Board exam eligibility rule. Ask the school to review the applicable board requirements and condonation process.`
          : `Attendance (${cumulativePercentage}%) has fallen below 75%. Academic review and condonation required.`;
      } else if (cumulativePercentage < requiredThreshold) {
        shortageStatus = "shortage_alert";
        shortageMessage = `Alert: Current attendance (${cumulativePercentage}%) is below the school's ${requiredThreshold}% threshold. Immediate improvement is required.`;
      } else if (cumulativePercentage < 85) {
        shortageStatus = "preventive_warning";
        shortageMessage = `Preventive Notice: Attendance is at ${cumulativePercentage}%. Maintain regular attendance to stay well above the configured ${requiredThreshold}% warning threshold.`;
      }

      const summary: AdvancedAttendanceSummary = {
        student: {
          id: info.id,
          studentId: info.id,
          name: [info.first_name, info.last_name].filter(Boolean).join(" "),
          fullName: [info.first_name, info.last_name].filter(Boolean).join(" "),
          admissionNumber: info.admission_number,
          rollNumber: info.roll_number,
          className: info.class_name,
          classCode: info.class_code,
          sectionName: info.section_name,
          stream: info.stream?.toUpperCase() || "GENERAL",
        },
        session: info.academic_year_name,
        cumulative: {
          workingDays: totalDays,
          presentDays,
          absentDays,
          excusedDays,
          percentage: cumulativePercentage,
        },
        monthWise,
        dateWise: {
          date: targetDate,
          markedPeriods: markedCount,
          presentPeriods: presentPeriodCount,
          absentPeriods: absentPeriodCount,
          unmarkedPeriods: periodItems.length - markedCount,
          periods: periodItems,
        },
        periods: periodItems,
        subjectWise,
        shortageAlert: {
          isShortage: cumulativePercentage < requiredThreshold,
          currentRate: cumulativePercentage,
          requiredThreshold,
          boardThreshold,
          status: shortageStatus,
          message: shortageMessage,
        },
      };

      return summary;
    },
  );

  /**
   * Records period-wise attendance for a section on a specific date and period.
   */
  app.post(
    "/api/schools/:schoolId/sections/:sectionId/period-attendance",
    {
      preHandler: requireAnyPermission(
        "attendance.student.record",
        "school.manage",
      ),
    },
    async (request, reply) => {
      const { schoolId, sectionId } = z
        .object({ schoolId: z.string().uuid(), sectionId: z.string().uuid() })
        .parse(request.params);
      const body = periodAttendanceBody.parse(request.body);
      const actor = getActor(request);
      if (body.date > todayInTimeZone(actor.school.timezone))
        throw badRequest("Future attendance cannot be recorded");
      const pool = getPool();

      // Check section and fetch active enrollment ids
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const lesson = (
          await client.query<{
            teacher_user_id: string;
            substitute_teacher_user_id: string | null;
          }>(
            `SELECT ts.teacher_user_id,x.substitute_teacher_user_id FROM timetable_slots ts
          JOIN academic_years y ON y.school_id=ts.school_id AND y.id=ts.academic_year_id
          LEFT JOIN timetable_substitutions x ON x.school_id=ts.school_id AND x.slot_id=ts.id AND x.substitution_date=$5::date AND x.status='active'
          WHERE ts.school_id=$1 AND ts.section_id=$2 AND ts.period_id=$3 AND ts.subject_id=$4
          AND ts.day_of_week=extract(isodow FROM $5::date) AND $5::date BETWEEN y.starts_on AND y.ends_on`,
            [schoolId, sectionId, body.periodId, body.subjectId, body.date],
          )
        ).rows[0];
        if (!lesson)
          throw notFound(
            "Scheduled lesson not found for this section and date",
          );
        if (
          !canAccessSection(actor, sectionId) &&
          lesson.substitute_teacher_user_id !== actor.userId
        )
          throw notFound("Section not found in your assigned scope");
        if (body.teacherUserId && body.teacherUserId !== lesson.teacher_user_id)
          throw badRequest("Teacher must match the scheduled lesson");
        if (
          body.substituteTeacherUserId &&
          body.substituteTeacherUserId !== lesson.substitute_teacher_user_id
        )
          throw badRequest(
            "Substitute must match the approved dated assignment",
          );
        if (
          new Set(body.records.map((r) => r.studentId)).size !==
          body.records.length
        )
          throw badRequest("A student appears more than once");
        let recordedCount = 0;
        for (const record of body.records) {
          // Find enrollment for student
          const enrollRes = await client.query<{ id: string }>(
            `SELECT id FROM enrollments
             WHERE school_id = $1 AND student_id = $2 AND section_id = $3 AND enrollment_status = 'active'
             LIMIT 1`,
            [schoolId, record.studentId, sectionId],
          );
          if (!enrollRes.rows[0])
            throw notFound(
              "Student is not actively enrolled in the selected section",
            );

          await client.query(
            `INSERT INTO student_period_attendance
               (school_id, student_id, enrollment_id, section_id, period_id, subject_id,
                attendance_date, status, teacher_user_id, substitute_teacher_user_id,
                marked_by_user_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (enrollment_id, attendance_date, period_id)
             DO UPDATE SET
               status = EXCLUDED.status,
               substitute_teacher_user_id = EXCLUDED.substitute_teacher_user_id,
               marked_by_user_id = EXCLUDED.marked_by_user_id,
               notes = EXCLUDED.notes,
               updated_at = now()`,
            [
              schoolId,
              record.studentId,
              enrollRes.rows[0].id,
              sectionId,
              body.periodId,
              body.subjectId,
              body.date,
              record.status,
              lesson.teacher_user_id,
              lesson.substitute_teacher_user_id,
              actor.userId,
              record.notes || null,
            ],
          );
          recordedCount += 1;
        }

        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "attendance.period_marked",
          entityType: "section",
          entityId: sectionId,
          outcome: "success",
          after: {
            date: body.date,
            periodId: body.periodId,
            subjectId: body.subjectId,
            recordedCount,
          },
        });

        await client.query("COMMIT");
        return reply.status(200).send({
          success: true,
          recordedCount,
          message: `Recorded period attendance for ${recordedCount} student(s).`,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.get(
    "/api/schools/:schoolId/timetable/substitution-candidates",
    {
      preHandler: requireAnyPermission(
        "academic.timetable.manage",
        "hr.employee.manage",
        "school.manage",
      ),
    },
    async (request) => {
      const { schoolId } = schoolParams.parse(request.params);
      const query = z
        .object({ slotId: z.string().uuid(), date: z.string().date() })
        .parse(request.query);
      const scopeSlot=(await getPool().query<{section_id:string}>('SELECT section_id FROM timetable_slots WHERE school_id=$1 AND id=$2',[schoolId,query.slotId])).rows[0];
      if(!scopeSlot||!canAccessSection(getActor(request),scopeSlot.section_id))throw notFound('Lesson not found in assigned scope');
      return substituteCandidates(
        getPool(),
        schoolId,
        query.slotId,
        query.date,
      );
    },
  );

  /**
   * Assigns a substitute teacher for a timetable slot.
   */
  app.post(
    "/api/schools/:schoolId/timetable/substitutions",
    {
      preHandler: requireAnyPermission(
        "academic.timetable.manage",
        "hr.employee.manage",
        "school.manage",
      ),
    },
    async (request, reply) => {
      const { schoolId } = schoolParams.parse(request.params);
      const body = substitutionBody.parse(request.body);
      const actor = getActor(request);
      return withTransaction(async (pool) => {
        // Serialize assignments within the school so two coordinators cannot double-book a replacement.
        await pool.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
          schoolId,
        ]);
        const scopeSlot=(await pool.query<{section_id:string}>('SELECT section_id FROM timetable_slots WHERE school_id=$1 AND id=$2',[schoolId,body.slotId])).rows[0];
        if(!scopeSlot||!canAccessSection(actor,scopeSlot.section_id))throw notFound('Lesson not found in assigned scope');
        const availability = await substituteCandidates(
          pool,
          schoolId,
          body.slotId,
          body.substitutionDate,
        );
        const candidate = availability.items.find(
          (c) => c.userId === body.substituteTeacherUserId,
        );
        if (!candidate?.eligible)
          throw badRequest("Replacement is not eligible or available", {
            substituteTeacherUserId: candidate?.reasons ?? [
              "Select an eligible teacher from this school",
            ],
          });
        // Find original teacher from timetable slot
        const slotRes = await pool.query<{ teacher_user_id: string }>(
          "SELECT teacher_user_id FROM timetable_slots WHERE school_id = $1 AND id = $2",
          [schoolId, body.slotId],
        );
        if (!slotRes.rows[0]) throw notFound("Timetable slot not found");

        const originalTeacher = slotRes.rows[0].teacher_user_id;

        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO timetable_substitutions
           (school_id, slot_id, substitution_date, original_teacher_user_id,
            substitute_teacher_user_id, assigned_by_user_id, reason, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         ON CONFLICT (slot_id, substitution_date)
         DO UPDATE SET
           substitute_teacher_user_id = EXCLUDED.substitute_teacher_user_id,
           assigned_by_user_id = EXCLUDED.assigned_by_user_id,
           reason = EXCLUDED.reason,
           status = 'active',
           updated_at = now()
         RETURNING id`,
          [
            schoolId,
            body.slotId,
            body.substitutionDate,
            originalTeacher,
            body.substituteTeacherUserId,
            actor.userId,
            body.reason,
          ],
        );

        await recordAudit(pool, {
          schoolId,
          actorUserId: actor.userId,
          action: "timetable.substitute_assigned",
          entityType: "timetable_slot",
          entityId: body.slotId,
          outcome: "success",
          after: {
            substitutionId: rows[0]?.id,
            date: body.substitutionDate,
            originalTeacher,
            substituteTeacher: body.substituteTeacherUserId,
          },
        });

        return reply.status(201).send({
          success: true,
          id: rows[0]?.id,
          message: "Substitute teacher assigned successfully.",
        });
      });
    },
  );

  /**
   * Lists active substitutions for a school and date.
   */
  app.get(
    "/api/schools/:schoolId/timetable/substitutions",
    {
      preHandler: requireAnyPermission(
        "academic.structure.view",
        "hr.employee.manage",
        "school.manage",
      ),
    },
    async (request) => {
      const { schoolId } = schoolParams.parse(request.params);
      const queryDate =
        (request.query as { date?: string })?.date ||
        new Date().toISOString().slice(0, 10);
      const pool = getPool();
      const sections = visibleSectionIds(getActor(request));

      const { rows } = await pool.query(
        `SELECT
           tsub.id, tsub.substitution_date, tsub.reason, tsub.status,
           ts.id AS slot_id, ts.day_of_week,
           orig_u.display_name AS original_teacher_name,
           subst_u.display_name AS substitute_teacher_name,
           sub.name AS subject_name,
           sec.name AS section_name,
           tp.sequence_no AS period_no,
           tp.name AS period_name
         FROM timetable_substitutions tsub
         JOIN timetable_slots ts ON ts.id = tsub.slot_id
         JOIN timetable_periods tp ON tp.id = ts.period_id
         JOIN subjects sub ON sub.id = ts.subject_id
         JOIN sections sec ON sec.id = ts.section_id
         JOIN users orig_u ON orig_u.id = tsub.original_teacher_user_id
         JOIN users subst_u ON subst_u.id = tsub.substitute_teacher_user_id
         WHERE tsub.school_id = $1 AND tsub.substitution_date = $2 AND ($3::uuid[] IS NULL OR ts.section_id=ANY($3::uuid[]))
         ORDER BY tp.sequence_no ASC`,
        [schoolId, queryDate, sections],
      );

      return { items: rows };
    },
  );
}
