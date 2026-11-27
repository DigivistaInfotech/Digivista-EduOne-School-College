import type pg from "pg";
import { notFound, badRequest } from "./errors";
export async function substituteCandidates(
  db: pg.Pool | pg.PoolClient,
  schoolId: string,
  slotId: string,
  date: string,
) {
  const target = await db.query<{ teacher_user_id: string;teacher_name:string;attendance_status:string|null;approved_leave:boolean }>(
    `SELECT ts.teacher_user_id,u.display_name AS teacher_name,sa.status AS attendance_status,
 EXISTS(SELECT 1 FROM leave_requests l WHERE l.school_id=ts.school_id AND l.staff_id=st.id AND l.status='approved' AND $3::date BETWEEN l.starts_on AND l.ends_on) AS approved_leave
 FROM timetable_slots ts JOIN users u ON u.id=ts.teacher_user_id
 LEFT JOIN staff st ON st.school_id=ts.school_id AND st.user_id=u.id
 LEFT JOIN staff_attendance sa ON sa.school_id=ts.school_id AND sa.staff_id=st.id AND sa.work_date=$3::date
 JOIN academic_years y ON y.id=ts.academic_year_id AND y.school_id=ts.school_id
 WHERE ts.school_id=$1 AND ts.id=$2 AND ts.day_of_week=EXTRACT(ISODOW FROM $3::date)
 AND $3::date BETWEEN y.starts_on AND y.ends_on`,
    [schoolId, slotId, date],
  );
  if (!target.rows[0])
    throw badRequest(
      "Choose a date within the academic year on the scheduled weekday",
    );
  const candidates = await db.query<{
    userId: string;
    displayName: string;
    eligible: boolean;
    subjectVerified: boolean;
    busy: boolean;
    unavailable: boolean;
    weeklyPeriods: number;
    maxWeeklyPeriods: number | null;
    attendanceStatus: string | null;
  }>(
    `
 WITH target AS (SELECT ts.*,p.starts_at,p.ends_at,c.grade_order FROM timetable_slots ts
 JOIN timetable_periods p ON p.id=ts.period_id JOIN sections s ON s.id=ts.section_id
 JOIN classes c ON c.id=s.class_id WHERE ts.school_id=$1 AND ts.id=$2),
 candidates AS (
 SELECT u.id AS "userId",u.display_name AS "displayName",sa.status AS "attendanceStatus",
 EXISTS(SELECT 1 FROM teacher_eligibility_profiles ep WHERE ep.school_id=$1 AND ep.staff_id=st.id
 AND ep.subject_id=t.subject_id AND ep.verification_status='verified'
 AND t.grade_order BETWEEN ep.min_grade_order AND ep.max_grade_order) AS "subjectVerified",
 (SELECT ep.max_weekly_periods FROM teacher_eligibility_profiles ep WHERE ep.school_id=$1 AND ep.staff_id=st.id AND ep.subject_id=t.subject_id AND ep.verification_status='verified') AS "maxWeeklyPeriods",
 (SELECT count(*)::int FROM timetable_slots w WHERE w.school_id=$1 AND w.academic_year_id=t.academic_year_id AND w.teacher_user_id=u.id)
 + (SELECT count(*)::int FROM timetable_substitutions x WHERE x.school_id=$1 AND x.substitute_teacher_user_id=u.id AND x.status='active' AND x.slot_id<>t.id AND date_trunc('week',x.substitution_date)=date_trunc('week',$3::date)) AS "weeklyPeriods",
 (st.status<>'active' OR coalesce(sa.status IN ('absent','leave','half_day','excused'),false) OR EXISTS(SELECT 1 FROM leave_requests l WHERE l.school_id=$1 AND l.staff_id=st.id AND l.status='approved' AND $3::date BETWEEN l.starts_on AND l.ends_on)) AS unavailable,
 EXISTS(SELECT 1 FROM timetable_slots w JOIN timetable_periods wp ON wp.id=w.period_id
 LEFT JOIN timetable_substitutions x ON x.slot_id=w.id AND x.substitution_date=$3::date AND x.status='active'
 WHERE w.school_id=$1 AND w.id<>t.id AND w.academic_year_id=t.academic_year_id AND w.day_of_week=t.day_of_week
 AND coalesce(x.substitute_teacher_user_id,w.teacher_user_id)=u.id
 AND wp.starts_at<t.ends_at AND wp.ends_at>t.starts_at) AS busy
 FROM target t JOIN staff st ON st.school_id=$1 JOIN users u ON u.id=st.user_id AND u.status='active'
 LEFT JOIN staff_attendance sa ON sa.school_id=$1 AND sa.staff_id=st.id AND sa.work_date=$3::date
 WHERE u.id<>t.teacher_user_id AND EXISTS(SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id=a.role_id
 WHERE a.user_id=u.id AND a.school_id=$1 AND r.code='teacher' AND a.revoked_at IS NULL
 AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now()))
 AND (a.scope_type='school' OR (a.scope_type='section' AND a.scope_id=t.section_id) OR (a.scope_type='class' AND EXISTS(SELECT 1 FROM sections scoped_sec WHERE scoped_sec.school_id=$1 AND scoped_sec.id=t.section_id AND scoped_sec.class_id=a.scope_id)))
 ) SELECT *, ("subjectVerified" AND NOT busy AND NOT unavailable AND "weeklyPeriods"<"maxWeeklyPeriods") AS eligible
 FROM candidates ORDER BY eligible DESC,"weeklyPeriods","displayName"`,
    [schoolId, slotId, date],
  );
  if (!target.rows[0]) throw notFound("Slot not found");
  return {
    originalTeacherId: target.rows[0].teacher_user_id,
    originalTeacherName:target.rows[0].teacher_name,
    originalAttendanceStatus:target.rows[0].attendance_status,
    originalApprovedLeave:target.rows[0].approved_leave,
    items: candidates.rows.map((c) => ({
      ...c,
      reasons: [
        ...(!c.subjectVerified
          ? ["No verified subject / grade eligibility"]
          : []),
        ...(c.busy ? ["Timetable clash"] : []),
        ...(c.unavailable
          ? ["Unavailable: leave / attendance / staff status"]
          : []),
        ...(c.maxWeeklyPeriods !== null && c.weeklyPeriods >= c.maxWeeklyPeriods
          ? ["Weekly workload limit reached"]
          : []),
        ...(c.attendanceStatus === null
          ? ["Attendance not yet recorded; confirm availability"]
          : []),
      ],
    })),
  };
}
