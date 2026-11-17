import { getOperatingPolicy } from "../lib/institutionPolicy";
import { studentStage } from "@erp/shared/student-stage";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { getPool } from "../db";
import { getActor, requirePermission } from "../auth/guards";
import { forbidden, notFound, parseInput } from "../lib/errors";
import { recordAudit } from "../lib/audit";
import { todayInTimeZone } from "../lib/format";

const uuidParam = z.object({ schoolId: z.string().uuid() });
const assignmentParam = z.object({
  schoolId: z.string().uuid(),
  assignmentId: z.string().uuid(),
});

const submitHomeworkInput = z.object({
  submissionText: z
    .string()
    .trim()
    .min(1, "Submission content is required")
    .max(10000),
  attachmentUrl: z.string().url().optional().nullable(),
  attachmentName: z.string().max(160).optional().nullable(),
});

const learningAssistantInput = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "Prompt must be at least 3 characters")
    .max(1000),
  subjectId: z.string().uuid().optional().nullable(),
  topic: z.string().trim().max(120).optional().nullable(),
  language: z.enum(["en", "hi"]).default("en"),
  mode: z
    .enum([
      "qa",
      "explain",
      "summarize",
      "revision_notes",
      "practice_questions",
      "quiz",
    ])
    .default("qa"),
});

const profileCorrectionInput = z.object({
  fieldName: z.enum([
    "first_name",
    "last_name",
    "date_of_birth",
    "blood_group",
    "emergency_contact",
    "address",
  ]),
  proposedValue: z.string().trim().min(1).max(200),
  reason: z
    .string()
    .trim()
    .min(5, "Reason must be at least 5 characters")
    .max(500),
  supportingDocName: z.string().max(160).optional().nullable(),
});

const studentConcernInput = z.object({
  category: z
    .enum([
      "academic",
      "homework",
      "timetable",
      "transport",
      "library",
      "wellness",
      "general",
    ])
    .default("general"),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(2000),
});

interface LinkedStudentRow {
  student_id: string;
  admission_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  blood_group: string | null;
  emergency_contact: string | null;
  roll_number: string | null;
  cbse_reg_no: string | null;
  status: string;
  class_id: string;
  class_code: string;
  class_name: string;
  grade_order: number | null;
  section_id: string;
  section_code: string;
  section_name: string;
  academic_year_id: string;
  academic_year_name: string;
}

async function getLinkedStudent(
  schoolId: string,
  userId: string,
): Promise<LinkedStudentRow> {
  const pool = getPool();
  const { rows } = await pool.query<LinkedStudentRow>(
    `SELECT
       s.id AS student_id,
       s.admission_number,
       s.first_name,
       s.middle_name,
       s.last_name,
       to_char(s.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
       s.blood_group,
       s.emergency_contact,
       s.roll_number,
       s.cbse_reg_no,
       s.status,
       c.id AS class_id,
       c.code AS class_code,
       c.name AS class_name,
       c.grade_order,
       sec.id AS section_id,
       sec.code AS section_code,
       sec.name AS section_name,
       ay.id AS academic_year_id,
       ay.name AS academic_year_name
     FROM students s
     JOIN enrollments e ON e.student_id = s.id AND e.school_id = s.school_id AND e.enrollment_status = 'active'
     JOIN classes c ON c.id = e.class_id
     JOIN sections sec ON sec.id = e.section_id
     JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE s.school_id = $1 AND s.user_id = $2
     ORDER BY ay.status = 'active' DESC, e.starts_on DESC
     LIMIT 1`,
    [schoolId, userId],
  );

  const student = rows[0];
  if (!student) {
    throw forbidden("No active student profile linked to your user account.");
  }
  return student;
}

export async function registerStudentPortalRoutes(
  app: FastifyInstance,
): Promise<void> {
  /* ------------------------------- GET /student/me --------------------------- */
  app.get(
    "/api/schools/:schoolId/student/me",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      // Class teacher lookup
      const { rows: teacherRows } = await pool.query<{ teacher_name: string }>(
        `SELECT u.display_name AS teacher_name
         FROM teaching_assignments ta
         JOIN users u ON u.id = ta.user_id
         WHERE ta.school_id = $1 AND ta.section_id = $2
         LIMIT 1`,
        [schoolId, student.section_id],
      );

      // Attendance summary for current academic year
      const { rows: attRows } = await pool.query<{
        total_marked: string;
        attended_days: string;
      }>(
        `SELECT
           count(*)::text AS total_marked,
           coalesce(sum(
             CASE
               WHEN status IN ('present', 'late') THEN 1
               WHEN status = 'half_day' THEN 0.5
               ELSE 0
             END
           ), 0)::text AS attended_days
         FROM student_attendance
         WHERE school_id = $1 AND student_id = $2
           AND attendance_date >= (SELECT starts_on FROM academic_years WHERE id = $3)
           AND attendance_date <= (SELECT ends_on FROM academic_years WHERE id = $3)`,
        [schoolId, student.student_id, student.academic_year_id],
      );

      const totalMarked = Number(attRows[0]?.total_marked ?? 0);
      const attendedDays = Number(attRows[0]?.attended_days ?? 0);
      const attendancePercent =
        totalMarked > 0
          ? Number(((attendedDays / totalMarked) * 100).toFixed(1))
          : 0;

      // Fee summary
      const { rows: feeRows } = await pool.query<{
        total_charged: string;
        total_paid: string;
        total_concession: string;
      }>(
        `SELECT
           coalesce(sum(amount), 0)::text AS total_charged,
           coalesce(sum(concession_amount), 0)::text AS total_concession,
           coalesce((
             SELECT sum(pa.amount)
             FROM payment_allocations pa
             JOIN student_charges sc ON sc.id = pa.charge_id
             WHERE pa.school_id = $1 AND sc.student_id = $2
           ), 0)::text AS total_paid
         FROM student_charges
         WHERE school_id = $1 AND student_id = $2 AND academic_year_id = $3`,
        [schoolId, student.student_id, student.academic_year_id],
      );

      const charged = Number(feeRows[0]?.total_charged ?? 0);
      const concession = Number(feeRows[0]?.total_concession ?? 0);
      const paid = Number(feeRows[0]?.total_paid ?? 0);
      const balance = Math.max(0, charged - concession - paid);

      // Pending counts (homework, exams, notices)
      const { rows: hwCount } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM homework_assignments ha
         WHERE ha.school_id = $1 AND ha.section_id = $2 AND ha.status = 'published'
           AND ha.id NOT IN (
             SELECT hs.assignment_id FROM homework_submissions hs
             WHERE hs.school_id = $1 AND hs.student_id = $3
           )`,
        [schoolId, student.section_id, student.student_id],
      );

      const { rows: noticesCount } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM notices n
         WHERE n.school_id = $1 AND n.status = 'published'
           AND n.audience IN ('all', 'students')
           AND n.id NOT IN (
             SELECT nr.notice_id FROM notice_receipts nr WHERE nr.user_id = $2
           )`,
        [schoolId, request.user!.id],
      );

      return {
        student: {
          id: student.student_id,
          admissionNumber: student.admission_number,
          firstName: student.first_name,
          middleName: student.middle_name,
          lastName: student.last_name,
          fullName: [student.first_name, student.middle_name, student.last_name]
            .filter(Boolean)
            .join(" "),
          dateOfBirth: student.date_of_birth,
          bloodGroup: student.blood_group,
          emergencyContact: student.emergency_contact,
          rollNumber: student.roll_number,
          cbseRegNo: student.cbse_reg_no,
          status: student.status,
          className: student.class_name,
          classCode: student.class_code,
          gradeOrder: student.grade_order,
          sectionName: student.section_name,
          sectionCode: student.section_code,
          academicYearName: student.academic_year_name,
          classTeacher: teacherRows[0]?.teacher_name ?? null,
        },
        attendance: {
          totalWorkingDays: totalMarked,
          attendedDays,
          attendanceRate: attendancePercent,
          shortageWarning:
            totalMarked > 0 &&
            attendancePercent <
              (await getOperatingPolicy(schoolId)).attendanceThreshold,
          thresholdPercent: (await getOperatingPolicy(schoolId))
            .attendanceThreshold,
        },
        fees: {
          totalCharged: charged,
          totalPaid: paid,
          outstandingBalance: balance,
        },
        counts: {
          pendingHomework: Number(hwCount[0]?.count ?? 0),
          unreadNotices: Number(noticesCount[0]?.count ?? 0),
        },
      };
    },
  );

  /* -------------------------- GET /student/timetable ------------------------- */
  app.get(
    "/api/schools/:schoolId/student/timetable",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const { rows: periods } = await pool.query<{
        id: string;
        name: string;
        sequence: number;
        start_time: string;
        end_time: string;
        is_break: boolean;
      }>(
        `SELECT id, name, sequence_no AS sequence,
                to_char(starts_at, 'HH24:MI') AS start_time,
                to_char(ends_at, 'HH24:MI') AS end_time,
                is_break
         FROM timetable_periods
         WHERE school_id = $1 AND academic_year_id = $2
         ORDER BY sequence_no ASC`,
        [schoolId, student.academic_year_id],
      );

      const { rows: slots } = await pool.query<{
        id: string;
        day_of_week: number;
        period_id: string;
        subject_name: string;
        subject_code: string;
        teacher_name: string | null;
        room_name: string | null;
      }>(
        `SELECT
           ts.id,
           ts.day_of_week,
           ts.period_id,
           sub.name AS subject_name,
           sub.code AS subject_code,
           u.display_name AS teacher_name,
           r.name AS room_name
         FROM timetable_slots ts
         JOIN subjects sub ON sub.id = ts.subject_id
         LEFT JOIN users u ON u.id = ts.teacher_user_id
         LEFT JOIN rooms r ON r.id = ts.room_id
         WHERE ts.school_id = $1 AND ts.section_id = $2
         ORDER BY ts.day_of_week, ts.period_id`,
        [schoolId, student.section_id],
      );

      const slotItems = slots.map((s) => ({
        id: s.id,
        dayOfWeek: s.day_of_week,
        periodId: s.period_id,
        subjectName: s.subject_name,
        subjectCode: s.subject_code,
        teacherName: s.teacher_name,
        roomName: s.room_name,
      }));

      return {
        periods: periods.map((p) => ({
          id: p.id,
          name: p.name,
          sequence: p.sequence,
          startTime: p.start_time,
          endTime: p.end_time,
          isBreak: p.is_break,
        })),
        slots: slotItems,
        items: slotItems,
      };
    },
  );

  /* -------------------------- GET /student/attendance ------------------------ */
  app.get(
    "/api/schools/:schoolId/student/attendance",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const { rows } = await pool.query<{
        attendance_date: string;
        status: string;
        source: string;
      }>(
        `SELECT
           to_char(attendance_date, 'YYYY-MM-DD') AS attendance_date,
           status,
           source
         FROM student_attendance
         WHERE school_id = $1 AND student_id = $2
         ORDER BY attendance_date DESC
         LIMIT 180`,
        [schoolId, student.student_id],
      );

      const totalMarked = rows.length;
      const attended = rows.reduce((sum, r) => {
        if (r.status === "present" || r.status === "late") return sum + 1;
        if (r.status === "half_day") return sum + 0.5;
        return sum;
      }, 0);

      const rate =
        totalMarked > 0
          ? Number(((attended / totalMarked) * 100).toFixed(1))
          : 0;

      return {
        rate,
        attendanceRate: rate,
        totalMarked,
        totalWorkingDays: totalMarked,
        attendedDays: attended,
        shortageWarning:
          totalMarked > 0 &&
          rate < (await getOperatingPolicy(schoolId)).attendanceThreshold,
        days: rows.map((r) => ({
          date: r.attendance_date,
          status: r.status,
          source: r.source,
        })),
      };
    },
  );

  /* --------------------------- GET /student/homework ------------------------- */
  app.get(
    "/api/schools/:schoolId/student/homework",
    { preHandler: [requirePermission("learning.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const { rows } = await pool.query<{
        id: string;
        subject_name: string;
        title: string;
        description: string;
        due_date: string;
        max_score: number | null;
        submission_id: string | null;
        submission_text: string | null;
        submission_status: string | null;
        submitted_at: string | null;
        score: number | null;
        feedback: string | null;
      }>(
        `SELECT
           ha.id,
           sub.name AS subject_name,
           ha.title,
           ha.instructions AS description,
           to_char(ha.due_at, 'YYYY-MM-DD') AS due_date,
           ha.max_marks AS max_score,
           hs.id AS submission_id,
           hs.content AS submission_text,
           hs.status AS submission_status,
           to_char(hs.submitted_at, 'YYYY-MM-DD HH24:MI') AS submitted_at,
           hs.marks AS score,
           hs.feedback
         FROM homework_assignments ha
         JOIN subjects sub ON sub.id = ha.subject_id
         LEFT JOIN homework_submissions hs
           ON hs.assignment_id = ha.id AND hs.student_id = $2 AND hs.school_id = $1
         WHERE ha.school_id = $1 AND ha.section_id = $3 AND ha.status = 'published'
         ORDER BY ha.due_at DESC`,
        [schoolId, student.student_id, student.section_id],
      );

      return {
        items: rows.map((r) => ({
          id: r.id,
          subjectName: r.subject_name,
          title: r.title,
          description: r.description,
          dueDate: r.due_date,
          maxScore: r.max_score,
          submission: r.submission_id
            ? {
                id: r.submission_id,
                text: r.submission_text,
                status: r.submission_status,
                submittedAt: r.submitted_at,
                score: r.score,
                feedback: r.feedback,
              }
            : null,
        })),
      };
    },
  );

  /* ------------------- POST /student/homework/:id/submit --------------------- */
  app.post(
    "/api/schools/:schoolId/student/homework/:assignmentId/submit",
    { preHandler: [requirePermission("learning.view")] },
    async (request) => {
      const { schoolId, assignmentId } = parseInput(
        assignmentParam,
        request.params,
      );
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const input = parseInput(submitHomeworkInput, request.body);
      const pool = getPool();

      // Ensure assignment exists and belongs to student's section
      const { rows: hwRows } = await pool.query<{
        id: string;
        due_date: string;
        status: string;
      }>(
        `SELECT id, to_char(due_date, 'YYYY-MM-DD') AS due_date, status
         FROM homework_assignments
         WHERE school_id = $1 AND id = $2 AND section_id = $3`,
        [schoolId, assignmentId, student.section_id],
      );

      if (!hwRows[0] || hwRows[0].status !== "published") {
        throw notFound(
          "Homework assignment not found or not currently accepting submissions.",
        );
      }

      // Check existing submission
      const { rows: existing } = await pool.query<{
        id: string;
        status: string;
      }>(
        `SELECT id, status FROM homework_submissions
         WHERE school_id = $1 AND assignment_id = $2 AND student_id = $3`,
        [schoolId, assignmentId, student.student_id],
      );

      let submissionId = existing[0]?.id;
      if (submissionId) {
        await pool.query(
          `UPDATE homework_submissions
           SET submission_text = $1, status = 'submitted', submitted_at = now()
           WHERE school_id = $2 AND id = $3`,
          [input.submissionText, schoolId, submissionId],
        );
      } else {
        const { rows: inserted } = await pool.query<{ id: string }>(
          `INSERT INTO homework_submissions
             (school_id, assignment_id, student_id, submission_text, status, submitted_at)
           VALUES ($1, $2, $3, $4, 'submitted', now())
           RETURNING id`,
          [schoolId, assignmentId, student.student_id, input.submissionText],
        );
        submissionId = inserted[0]!.id;
      }

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: "homework.submitted",
        entityType: "homework_submission",
        entityId: submissionId,
        outcome: "success",
      });

      return { status: "submitted", submissionId };
    },
  );

  /* --------------------------- GET /student/learning ------------------------- */
  app.get(
    "/api/schools/:schoolId/student/learning",
    { preHandler: [requirePermission("learning.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const { rows } = await pool.query<{
        id: string;
        title: string;
        description: string | null;
        subject_name: string;
        resource_type: string;
        url: string | null;
        created_at: string;
      }>(
        `SELECT
           lr.id,
           lr.title,
           lr.description,
           sub.name AS subject_name,
           lr.resource_type,
           lr.url,
           to_char(lr.created_at, 'YYYY-MM-DD') AS created_at
         FROM learning_resources lr
         JOIN subjects sub ON sub.id = lr.subject_id
         WHERE lr.school_id = $1 AND lr.class_id = $2 AND lr.status = 'published'
         ORDER BY lr.created_at DESC`,
        [schoolId, student.class_id],
      );

      return {
        resources: rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          subjectName: r.subject_name,
          resourceType: r.resource_type,
          url: r.url,
          createdAt: r.created_at,
        })),
      };
    },
  );

  /* ------------------- POST /student/learning/assistant ---------------------- */
  app.post(
    "/api/schools/:schoolId/student/learning/assistant",
    { preHandler: [requirePermission("learning.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const input = parseInput(learningAssistantInput, request.body);
      const pool = getPool();

      if (
        input.subjectId &&
        !(
          await pool.query(
            "SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2",
            [schoolId, input.subjectId],
          )
        ).rowCount
      ) {
        throw notFound("Subject not found");
      }
      // This is a local demo study planner, not a model-backed answer service.
      // Resource metadata is listed separately; it does not justify a citation.
      const { rows: resources } = await pool.query<{
        id: string;
        title: string;
        subject_name: string | null;
        url: string | null;
      }>(
        `SELECT lr.id, lr.title, lr.url, sub.name AS subject_name
         FROM learning_resources lr
         LEFT JOIN subjects sub ON sub.id = lr.subject_id AND sub.school_id = lr.school_id
         WHERE lr.school_id = $1 AND lr.class_id = $2 AND lr.status = 'published'
           AND lr.visibility IN ('all', 'students')
           AND ($3::uuid IS NULL OR lr.subject_id = $3)
         ORDER BY lr.created_at DESC, lr.id
         LIMIT 5`,
        [schoolId, student.class_id, input.subjectId ?? null],
      );
      const availableResources = resources.map((resource) => ({
        id: resource.id,
        title: resource.title,
        subjectName: resource.subject_name,
        url:
          resource.url && /^https?:\/\//i.test(resource.url)
            ? resource.url
            : null,
      }));
      const isHindi = input.language === "hi";
      const task =
        input.mode === "summarize" || input.mode === "revision_notes"
          ? isHindi
            ? "पढ़े हुए पाठ के मुख्य बिंदु अपने शब्दों में लिखें।"
            : "Write the main points from a resource you have read, in your own words."
          : input.mode === "practice_questions" || input.mode === "quiz"
            ? isHindi
              ? "पाठ से एक परिभाषा, एक उदाहरण और एक अभ्यास प्रश्न चुनें। उत्तर शिक्षक से जाँचें।"
              : "Choose a definition, an example and a practice exercise from your resource. Ask your teacher to check the answers."
            : isHindi
              ? "अपने शिक्षक से अवधारणा समझें, फिर पाठ का एक उदाहरण हल करें।"
              : "Ask your teacher to explain the concept, then work through an example in your resource.";
      const answerText = isHindi
        ? `डेमो अध्ययन योजना — "${input.prompt}"\n${task}\nयह स्थानीय टेम्पलेट है; आपके प्रश्न का सत्यापित उत्तर या पाठ का सारांश नहीं है।`
        : `Demo study plan for "${input.prompt}"\n${task}\nThis is a local template, not a verified answer to your question or a summary of the resource.`;
      const citations: never[] = [];
      await pool.query(
        `INSERT INTO learning_assistant_queries
           (school_id, student_id, class_id, subject_id, topic, prompt, language, mode, response_text, citations, provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'deterministic_local')`,
        [
          schoolId,
          student.student_id,
          student.class_id,
          input.subjectId ?? null,
          input.topic ?? null,
          input.prompt,
          input.language,
          input.mode,
          answerText,
          JSON.stringify(citations),
        ],
      );
      return {
        answer: answerText,
        response: answerText,
        mode: input.mode,
        language: input.language,
        provider: "deterministic_local",
        isDemo: true,
        citations,
        availableResources,
        disclaimer:
          "DIGI study planner demo: local study template only. No AI model or textbook-content retrieval is configured; listed resources are not evidence for an answer.",
      };
    },
  );

  /* ---------------------------- GET /student/exams --------------------------- */
  app.get(
    "/api/schools/:schoolId/student/exams",
    { preHandler: [requirePermission("exams.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      // Only published exams are visible to students
      const { rows } = await pool.query<{
        exam_id: string;
        exam_name: string;
        exam_type: string;
        published_at: string;
        subject_name: string;
        max_marks: number;
        mark_obtained: number;
        grade: string | null;
      }>(
        `SELECT
           e.id AS exam_id,
           e.name AS exam_name,
           e.exam_type,
           to_char(e.published_at, 'YYYY-MM-DD') AS published_at,
           sub.name AS subject_name,
           es.max_mark AS max_marks,
           em.mark AS mark_obtained,
           gb.grade
         FROM exams e
         JOIN exam_subjects es ON es.exam_id = e.id AND es.school_id = e.school_id
         JOIN subjects sub ON sub.id = es.subject_id
         JOIN exam_marks em ON em.exam_subject_id = es.id AND em.student_id = $2 AND em.school_id = e.school_id
         LEFT JOIN grading_bands gb
           ON gb.scheme_id = e.grading_scheme_id
          AND round((em.mark / es.max_mark) * 100, 2) >= gb.min_percentage
          AND round((em.mark / es.max_mark) * 100, 2) <= gb.max_percentage
         WHERE e.school_id = $1 AND e.academic_year_id = $3 AND e.status = 'published'
         ORDER BY e.published_at DESC, sub.name ASC`,
        [schoolId, student.student_id, student.academic_year_id],
      );

      // Group by exam
      const examMap = new Map<string, any>();
      for (const r of rows) {
        if (!examMap.has(r.exam_id)) {
          examMap.set(r.exam_id, {
            examId: r.exam_id,
            examName: r.exam_name,
            examType: r.exam_type,
            publishedAt: r.published_at,
            subjects: [],
            totalObtained: 0,
            totalMax: 0,
          });
        }
        const exam = examMap.get(r.exam_id)!;
        exam.subjects.push({
          subjectName: r.subject_name,
          maxMarks: r.max_marks,
          markObtained: r.mark_obtained,
          grade: r.grade,
        });
        exam.totalObtained += Number(r.mark_obtained);
        exam.totalMax += Number(r.max_marks);
      }

      return {
        exams: Array.from(examMap.values()).map((ex) => ({
          ...ex,
          percentage:
            ex.totalMax > 0
              ? Number(((ex.totalObtained / ex.totalMax) * 100).toFixed(2))
              : 0,
        })),
      };
    },
  );

  /* ---------------------------- GET /student/fees ---------------------------- */
  app.get(
    "/api/schools/:schoolId/student/fees",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const { rows: charges } = await pool.query<{
        id: string;
        fee_head_name: string;
        amount: number;
        concession_amount: number;
        paid_amount: number;
        due_date: string | null;
      }>(
        `SELECT
           sc.id,
           fh.name AS fee_head_name,
           sc.amount,
           sc.concession_amount,
           coalesce(sum(pa.amount), 0)::numeric AS paid_amount,
           to_char(sc.due_date, 'YYYY-MM-DD') AS due_date
         FROM student_charges sc
         JOIN fee_heads fh ON fh.id = sc.fee_head_id
         LEFT JOIN payment_allocations pa ON pa.charge_id = sc.id AND pa.school_id = sc.school_id
         WHERE sc.school_id = $1 AND sc.student_id = $2 AND sc.academic_year_id = $3
         GROUP BY sc.id, fh.name, sc.amount, sc.concession_amount, sc.due_date
         ORDER BY sc.due_date ASC NULLS LAST`,
        [schoolId, student.student_id, student.academic_year_id],
      );

      const { rows: payments } = await pool.query<{
        id: string;
        receipt_number: string;
        amount: number;
        method: string;
        paid_at: string;
      }>(
        `SELECT
           p.id,
           p.receipt_number,
           p.amount,
           p.method,
           to_char(p.paid_at, 'YYYY-MM-DD') AS paid_at
         FROM payments p
         JOIN payment_allocations pa ON pa.payment_id = p.id
         WHERE p.school_id = $1 AND pa.student_id = $2
         GROUP BY p.id, p.receipt_number, p.amount, p.method, p.paid_at
         ORDER BY p.paid_at DESC`,
        [schoolId, student.student_id],
      );

      return {
        charges: charges.map((c) => {
          const balance = Math.max(
            0,
            Number(c.amount) -
              Number(c.concession_amount) -
              Number(c.paid_amount),
          );
          return {
            id: c.id,
            feeHead: c.fee_head_name,
            amount: Number(c.amount),
            concession: Number(c.concession_amount),
            paid: Number(c.paid_amount),
            balance,
            status:
              balance === 0
                ? "paid"
                : Number(c.paid_amount) > 0
                  ? "partial"
                  : "unpaid",
            dueDate: c.due_date,
          };
        }),
        payments: payments.map((p) => ({
          id: p.id,
          receiptNumber: p.receipt_number,
          amount: Number(p.amount),
          method: p.method,
          paidAt: p.paid_at,
        })),
      };
    },
  );

  /* --------------------------- GET /student/library -------------------------- */
  app.get(
    "/api/schools/:schoolId/student/library",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      // Find library member for student
      const { rows: memberRows } = await pool.query<{ id: string }>(
        `SELECT id FROM library_members
         WHERE school_id = $1 AND student_id = $2`,
        [schoolId, student.student_id],
      );

      const memberId = memberRows[0]?.id;
      if (!memberId) {
        return { issuedLoans: [], reservations: [] };
      }

      const { rows: loans } = await pool.query<{
        id: string;
        title: string;
        author: string | null;
        accession_number: string;
        issued_at: string;
        due_date: string;
        status: string;
      }>(
        `SELECT
           ll.id,
           lb.title,
           lb.author,
           lc.accession_number,
           to_char(ll.issued_at, 'YYYY-MM-DD') AS issued_at,
           to_char(ll.due_date, 'YYYY-MM-DD') AS due_date,
           ll.status
         FROM library_loans ll
         JOIN library_copies lc ON lc.id = ll.copy_id
         JOIN library_books lb ON lb.id = lc.book_id
         WHERE ll.school_id = $1 AND ll.member_id = $2 AND ll.status = 'active'
         ORDER BY ll.due_date ASC`,
        [schoolId, memberId],
      );

      return {
        issuedLoans: loans.map((l) => ({
          id: l.id,
          title: l.title,
          author: l.author,
          accessionNumber: l.accession_number,
          issuedAt: l.issued_at,
          dueDate: l.due_date,
          status: l.status,
        })),
      };
    },
  );

  /* -------------------------- GET /student/transport ------------------------- */
  app.get(
    "/api/schools/:schoolId/student/transport",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const { rows } = await pool.query<{
        route_name: string;
        route_code: string;
        stop_name: string;
        morning_pickup_time: string | null;
        afternoon_drop_time: string | null;
        vehicle_reg: string | null;
        driver_name: string | null;
        driver_phone: string | null;
      }>(
        `SELECT
           tr.name AS route_name,
           tr.code AS route_code,
           ts.name AS stop_name,
           to_char(ts.morning_pickup_time, 'HH24:MI') AS morning_pickup_time,
           to_char(ts.afternoon_drop_time, 'HH24:MI') AS afternoon_drop_time,
           tv.registration_number AS vehicle_reg,
           td.full_name AS driver_name,
           td.phone AS driver_phone
         FROM student_transport_allocations sta
         JOIN transport_routes tr ON tr.id = sta.route_id
         LEFT JOIN transport_stops ts ON ts.id = sta.stop_id
         LEFT JOIN transport_vehicles tv ON tv.id = tr.vehicle_id
         LEFT JOIN transport_drivers td ON td.id = tr.driver_id
         WHERE sta.school_id = $1 AND sta.student_id = $2 AND sta.status = 'active'
         LIMIT 1`,
        [schoolId, student.student_id],
      );

      if (!rows[0]) return { assigned: false, transport: null };

      return {
        assigned: true,
        transport: {
          routeName: rows[0].route_name,
          routeCode: rows[0].route_code,
          stopName: rows[0].stop_name,
          morningPickupTime: rows[0].morning_pickup_time,
          afternoonDropTime: rows[0].afternoon_drop_time,
          vehicleRegistration: rows[0].vehicle_reg,
          driverName: rows[0].driver_name,
          driverPhone: rows[0].driver_phone,
        },
      };
    },
  );

  /* -------------------------- GET /student/concerns -------------------------- */
  app.get(
    "/api/schools/:schoolId/student/concerns",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const { rows } = await pool.query<{
        id: string;
        ticket_number: string;
        title: string;
        description: string;
        status: string;
        priority: string;
        created_at: string;
      }>(
        `SELECT
           c.id,
           c.reference AS ticket_number,
           c.subject AS title,
           c.description,
           c.status,
           c.priority,
           to_char(c.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
         FROM concerns c
         WHERE c.school_id = $1 AND c.student_id = $2
         ORDER BY c.created_at DESC`,
        [schoolId, student.student_id],
      );

      return {
        items: rows.map((r) => ({
          id: r.id,
          ticketNumber: r.ticket_number,
          title: r.title,
          description: r.description,
          status: r.status,
          priority: r.priority,
          createdAt: r.created_at,
        })),
      };
    },
  );

  /* -------------------------- POST /student/concerns ------------------------- */
  app.post(
    "/api/schools/:schoolId/student/concerns",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const input = parseInput(studentConcernInput, request.body);
      const pool = getPool();

      // Find or default concern category
      let { rows: cats } = await pool.query<{ id: string }>(
        `SELECT id FROM concern_categories WHERE school_id = $1 LIMIT 1`,
        [schoolId],
      );

      if (!cats[0]) {
        const { rows: newCat } = await pool.query<{ id: string }>(
          `INSERT INTO concern_categories (school_id, code, name, default_priority, sla_hours)
           VALUES ($1, 'GENERAL', 'General Pastoral Support', 'medium', 48)
           ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [schoolId],
        );
        cats = newCat;
      }

      const ticketNumber = `CON-${Date.now().toString().slice(-6)}`;
      const { rows: inserted } = await pool.query<{ id: string }>(
        `INSERT INTO concerns
           (school_id, category_id, student_id, requester_user_id, requester_name, reference, subject, description, priority, status, sla_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'medium', 'open', now() + interval '48 hours')
         RETURNING id`,
        [
          schoolId,
          cats[0]!.id,
          student.student_id,
          request.user!.id,
          `${student.first_name} ${student.last_name ?? ""}`.trim(),
          ticketNumber,
          input.title,
          input.description,
        ],
      );

      return {
        id: inserted[0]!.id,
        ticketNumber,
        status: "open",
      };
    },
  );

  /* ------------------- POST /student/profile-correction ---------------------- */
  app.post(
    "/api/schools/:schoolId/student/profile-correction",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const input = parseInput(profileCorrectionInput, request.body);
      const pool = getPool();

      const { rows: inserted } = await pool.query<{ id: string }>(
        `INSERT INTO student_profile_correction_requests
           (school_id, student_id, requested_by, field_name, current_value, proposed_value, reason, supporting_doc_name, status)
         VALUES ($1, $2, $3, $4, null, $5, $6, $7, 'pending')
         RETURNING id`,
        [
          schoolId,
          student.student_id,
          request.user!.id,
          input.fieldName,
          input.proposedValue,
          input.reason,
          input.supportingDocName || null,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: "student.profile_correction.requested",
        entityType: "student_profile_correction_request",
        entityId: inserted[0]!.id,
        outcome: "success",
      });

      return {
        id: inserted[0]!.id,
        status: "pending",
        message:
          "Your profile correction request has been submitted for administrator review.",
      };
    },
  );

  /* ------------------- GET /student/dashboard ---------------------- */
  app.get(
    "/api/schools/:schoolId/student/dashboard",
    { preHandler: [requirePermission("student.profile.view")] },
    async (request) => {
      const { schoolId } = parseInput(uuidParam, request.params);
      const student = await getLinkedStudent(schoolId, request.user!.id);
      const pool = getPool();

      const gradeTier = studentStage(student.grade_order);

      // 1. Attendance Today & Cumulative
      const attRes = await pool.query<{
        total_days: string;
        present_days: string;
        today_status: string | null;
      }>(
        `SELECT
           COUNT(*)::text AS total_days,
           COUNT(*) FILTER (WHERE status IN ('present', 'late', 'half_day'))::text AS present_days,
           (SELECT status FROM student_attendance WHERE school_id = $1 AND student_id = $2 AND attendance_date = $3::date LIMIT 1) AS today_status
         FROM student_attendance
         WHERE school_id = $1 AND student_id = $2`,
        [
          schoolId,
          student.student_id,
          todayInTimeZone(getActor(request).school.timezone),
        ],
      );

      const totDays = parseInt(attRes.rows[0]?.total_days || "0", 10);
      const presDays = parseInt(attRes.rows[0]?.present_days || "0", 10);
      const overallPercentage =
        totDays > 0 ? Math.round((presDays / totDays) * 100) : 0;
      const todayStatus = attRes.rows[0]?.today_status;
      const statusToday =
        todayStatus === "present"
          ? "Present today"
          : todayStatus === "absent"
            ? "Absent today"
            : todayStatus === "half_day"
              ? "Half day today"
              : todayStatus === "late"
                ? "Late today"
                : "Not marked yet";

      // 2. Homework (Today / Pending)
      const hwRes = await pool.query<{
        id: string;
        title: string;
        instructions: string | null;
        due_at: string;
        subject_name: string;
      }>(
        `SELECT ha.id, ha.title, ha.instructions, ha.due_at::text, sub.name AS subject_name
         FROM homework_assignments ha
         JOIN subjects sub ON sub.id = ha.subject_id
         LEFT JOIN homework_submissions hs
           ON hs.assignment_id = ha.id AND hs.student_id = $2
         WHERE ha.school_id = $1 AND ha.section_id = $3
           AND hs.id IS NULL
         ORDER BY ha.due_at ASC
         LIMIT 4`,
        [schoolId, student.student_id, student.section_id],
      );

      const todayItems = hwRes.rows.map((h) => ({
        id: h.id,
        subjectName: h.subject_name,
        title: h.title,
        instructions: h.instructions || "",
        dueAt: h.due_at,
      }));

      // 3. Today's Timetable
      const ttRes = await pool.query<{
        period_no: number;
        subject_name: string;
        teacher_name: string;
        starts_at: string;
        ends_at: string;
        room_name: string | null;
      }>(
        `SELECT
           tp.sequence_no AS period_no,
           sub.name AS subject_name,
           u.display_name AS teacher_name,
           TO_CHAR(tp.starts_at, 'HH12:MI AM') AS starts_at,
           TO_CHAR(tp.ends_at, 'HH12:MI AM') AS ends_at,
           rm.name AS room_name
         FROM timetable_slots ts
         JOIN timetable_periods tp ON tp.id = ts.period_id
         JOIN subjects sub ON sub.id = ts.subject_id
         JOIN users u ON u.id = ts.teacher_user_id
         LEFT JOIN rooms rm ON rm.id = ts.room_id
         WHERE ts.school_id = $1 AND ts.section_id = $2
         ORDER BY tp.sequence_no ASC
         LIMIT 6`,
        [schoolId, student.section_id],
      );

      const timetable = ttRes.rows.map((t) => ({
        periodNumber: t.period_no,
        subjectName: t.subject_name,
        teacherName: t.teacher_name,
        time: `${t.starts_at} - ${t.ends_at}`,
        room: t.room_name || "Classroom",
      }));

      // 4. Learning Corner
      const learnRes = await pool.query<{
        id: string;
        title: string;
        resource_type: string;
        url: string | null;
        description: string | null;
        subject_name: string;
      }>(
        `SELECT lr.id, lr.title, lr.resource_type, lr.url, lr.description, sub.name AS subject_name
         FROM learning_resources lr
         JOIN subjects sub ON sub.id = lr.subject_id AND sub.school_id = lr.school_id
         WHERE lr.school_id = $1 AND lr.status = 'published'
           AND (lr.class_id IS NULL OR lr.class_id = $2)
           AND lr.visibility IN ('all', 'students')
         ORDER BY lr.created_at DESC, lr.id
         LIMIT 6`,
        [schoolId, student.class_id],
      );

      const learningCorner = learnRes.rows.map((l) => ({
        id: l.id,
        subjectName: l.subject_name,
        title: l.title,
        resourceType: l.resource_type,
        url: l.url || undefined,
        summary: l.description || undefined,
      }));

      // 5. Notices
      const noticeRes = await pool.query<{
        id: string;
        title: string;
        published_at: string;
        audience: string;
      }>(
        `SELECT id, title, published_at::text, audience
         FROM notices
         WHERE school_id = $1 AND status = 'published'
         ORDER BY published_at DESC
         LIMIT 4`,
        [schoolId],
      );

      const notices = noticeRes.rows.map((n) => ({
        id: n.id,
        title: n.title,
        date: n.published_at.slice(0, 10),
        category: n.audience,
      }));

      return {
        student: {
          id: student.student_id,
          name: [student.first_name, student.last_name]
            .filter(Boolean)
            .join(" "),
          admissionNumber: student.admission_number,
          rollNumber: student.roll_number,
          className: student.class_name,
          sectionName: student.section_name,
          academicYearName: student.academic_year_name,
          gradeTier,
        },
        attendance: {
          statusToday,
          overallPercentage,
          monthName: new Intl.DateTimeFormat("en-US", { month: "long" }).format(
            new Date(),
          ),
        },
        homework: {
          pendingCount: hwRes.rows.length,
          todayItems,
        },
        timetable,
        learningCorner,
        notices,
      };
    },
  );
}
