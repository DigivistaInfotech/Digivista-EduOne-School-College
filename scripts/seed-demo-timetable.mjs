// Additive, idempotent demo timetable seed. Refuses to connect anywhere except local PostgreSQL.
// Demo-only users have no password hash and cannot sign in.
import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const parsed = new URL(connectionString);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
  throw new Error('Refusing to seed a non-local database');
}

const client = new pg.Client({ connectionString });
const teacherNames = [
  { first: 'Priya', last: 'Sharma', code: 'DEMO-TT-01', email: 'priya.sharma.timetable@digivista.invalid' },
  { first: 'Rahul', last: 'Verma', code: 'DEMO-TT-02', email: 'rahul.verma.timetable@digivista.invalid' },
  { first: 'Neha', last: 'Kapoor', code: 'DEMO-TT-03', email: 'neha.kapoor.timetable@digivista.invalid' },
];
const roomRows = [
  ['DEMO-TT-ROOM-6A', 'Class 6 [DEMO] · Room 101', 45],
  ['DEMO-TT-LAB-6A', 'Class 6 [DEMO] · Science Lab', 36],
  ['DEMO-TT-ROOM-6B', 'Class 6 [DEMO] · Room 102', 45],
];
const periodRows = [
  ['Period 1 [DEMO]', 1, '08:00', '08:45', false],
  ['Period 2 [DEMO]', 2, '08:50', '09:35', false],
  ['Break [DEMO]', 3, '09:35', '09:55', true],
  ['Period 3 [DEMO]', 4, '09:55', '10:40', false],
  ['Period 4 [DEMO]', 5, '10:45', '11:30', false],
];

async function ensureExistingOrInsert(sql, values, matches, label) {
  const found = await client.query(matches.sql, matches.values);
  if (found.rows[0]) {
    if (!matches.verify(found.rows[0])) throw new Error(`Existing ${label} conflicts with the demo seed; nothing was changed.`);
    return found.rows[0];
  }
  const inserted = await client.query(sql, values);
  return inserted.rows[0];
}

try {
  await client.connect();
  await client.query('BEGIN');
  const schoolResult = await client.query("SELECT id FROM schools WHERE name='Digi-School' AND status='active'");
  if (schoolResult.rowCount !== 1) throw new Error('Expected exactly one active Digi-School');
  const schoolId = schoolResult.rows[0].id;
  const yearResult = await client.query("SELECT id FROM academic_years WHERE school_id=$1 AND name='2026-27 [DEMO]' AND status='active'", [schoolId]);
  if (yearResult.rowCount !== 1) throw new Error('Expected the active 2026-27 [DEMO] academic year');
  const yearId = yearResult.rows[0].id;
  const sectionResult = await client.query(
    "SELECT sec.id, sec.class_id, c.grade_order FROM sections sec JOIN classes c ON c.school_id=sec.school_id AND c.id=sec.class_id WHERE sec.school_id=$1 AND sec.academic_year_id=$2 AND c.name='Class 6 [DEMO]' AND sec.name='A [DEMO]' AND sec.status='active'",
    [schoolId, yearId],
  );
  if (sectionResult.rowCount !== 1) throw new Error('Expected active Class 6 [DEMO] · A [DEMO] section');
  const { id: sectionId, class_id: classId, grade_order: gradeOrder } = sectionResult.rows[0];
  const admin = await client.query("SELECT id FROM users WHERE display_name='Digi-School Admin' ORDER BY created_at LIMIT 1");
  if (!admin.rows[0]) throw new Error('Digi-School admin actor is missing');
  const teacherRole = await client.query("SELECT id FROM roles WHERE code='teacher'");
  if (!teacherRole.rows[0]) throw new Error('Teacher role is missing');

  const subjectsResult = await client.query(
    "SELECT id,code,name FROM subjects WHERE school_id=$1 AND status='active' AND code IN ('DEMO-ENG','DEMO-MATH','DEMO-SCI','DEMO-SST') ORDER BY code",
    [schoolId],
  );
  if (subjectsResult.rowCount !== 4) throw new Error('Expected the four active Digi-School demo subjects (English, Mathematics, Science, Social Studies)');

  const teachers = [];
  for (const [index, spec] of teacherNames.entries()) {
    const displayName = `${spec.first} ${spec.last} [DEMO]`;
    const user = await ensureExistingOrInsert(
      'INSERT INTO users(email,display_name,password_hash,status) VALUES($1,$2,NULL,\'active\') RETURNING id,email,display_name,password_hash,status',
      [spec.email, displayName],
      { sql: 'SELECT id,email,display_name,password_hash,status FROM users WHERE lower(email)=lower($1)', values: [spec.email], verify: (row) => row.display_name === displayName && row.password_hash === null && row.status === 'active' },
      `demo teacher ${displayName}`,
    );
    const staff = await ensureExistingOrInsert(
      'INSERT INTO staff(school_id,user_id,employee_number,first_name,last_name,email,designation,department,status) VALUES($1,$2,$3,$4,$5,$6,\'Teacher [DEMO]\',\'Academics [DEMO]\',\'active\') RETURNING id,user_id,employee_number',
      [schoolId, user.id, spec.code, spec.first, `${spec.last} [DEMO]`, spec.email],
      { sql: 'SELECT id,user_id,employee_number,first_name,last_name,email FROM staff WHERE school_id=$1 AND employee_number=$2', values: [schoolId, spec.code], verify: (row) => row.user_id === user.id && row.employee_number === spec.code && row.first_name === spec.first && row.last_name === `${spec.last} [DEMO]` && row.email === spec.email },
      `demo staff ${spec.code}`,
    );
    await client.query(
      `INSERT INTO user_role_assignments(user_id,role_id,school_id,scope_type,scope_id,granted_by,reason)
       SELECT $1,$2,$3,'section',$4,$5,'Schedule-only synthetic timetable demo identity; no password set'
       WHERE NOT EXISTS (SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role_id=$2 AND school_id=$3 AND revoked_at IS NULL AND (valid_to IS NULL OR valid_to>now()))`,
      [user.id, teacherRole.rows[0].id, schoolId, sectionId, admin.rows[0].id],
    );
    teachers.push({ ...spec, userId: user.id, staffId: staff.id, displayName, index });
  }

  const periods = [];
  for (const spec of periodRows) {
    const [name, sequenceNo, startsAt, endsAt, isBreak] = spec;
    const row = await ensureExistingOrInsert(
      'INSERT INTO timetable_periods(school_id,academic_year_id,name,sequence_no,starts_at,ends_at,is_break) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,sequence_no,starts_at,ends_at,is_break',
      [schoolId, yearId, name, sequenceNo, startsAt, endsAt, isBreak],
      { sql: 'SELECT id,name,sequence_no,starts_at,ends_at,is_break FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND (name=$3 OR sequence_no=$4)', values: [schoolId, yearId, name, sequenceNo], verify: (item) => item.name === name && item.sequence_no === sequenceNo && String(item.starts_at).slice(0,5) === startsAt && String(item.ends_at).slice(0,5) === endsAt && item.is_break === isBreak },
      `period ${name}`,
    );
    periods.push(row);
  }
  const periodBySequence = new Map(periods.map((period) => [period.sequence_no, period]));

  const rooms = [];
  for (const [code, name, capacity] of roomRows) {
    const row = await ensureExistingOrInsert(
      'INSERT INTO rooms(school_id,code,name,capacity,status) VALUES($1,$2,$3,$4,\'active\') RETURNING id,code,name,capacity,status',
      [schoolId, code, name, capacity],
      { sql: 'SELECT id,code,name,capacity,status FROM rooms WHERE school_id=$1 AND code=$2', values: [schoolId, code], verify: (item) => item.name === name && item.capacity === capacity && item.status === 'active' },
      `room ${code}`,
    );
    rooms.push(row);
  }
  const roomByCode = new Map(rooms.map((room) => [room.code, room]));

  // Synthetic verified profiles enable the substitute-candidate flow in this demo only.
  for (const teacher of teachers) {
    for (const subject of subjectsResult.rows) {
      await client.query(
        `INSERT INTO teacher_eligibility_profiles(school_id,staff_id,subject_id,min_grade_order,max_grade_order,qualification,verification_status,max_weekly_periods)
         VALUES($1,$2,$3,$4,$4,'Demo-only synthetic eligibility; not a real credential','verified',30)
         ON CONFLICT (school_id,staff_id,subject_id) DO NOTHING`,
        [schoolId, teacher.staffId, subject.id, gradeOrder ?? 6],
      );
    }
  }

  const subjectByCode = new Map(subjectsResult.rows.map((subject) => [subject.code, subject]));
  const assignments = [
    ['DEMO-ENG', 1, 1, 'DEMO-TT-ROOM-6A'],
    ['DEMO-MATH', 2, 2, 'DEMO-TT-ROOM-6A'],
    ['DEMO-SCI', 4, 3, 'DEMO-TT-LAB-6A'],
    ['DEMO-SST', 5, 1, 'DEMO-TT-ROOM-6B'],
  ];
  let slotCount = 0;
  for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek++) {
    for (const [subjectCode, sequenceNo, teacherIndex, roomCode] of assignments) {
      const subject = subjectByCode.get(subjectCode);
      const period = periodBySequence.get(sequenceNo);
      const teacher = teachers[teacherIndex - 1];
      const room = roomByCode.get(roomCode);
      const existing = await client.query(
        'SELECT id,subject_id,teacher_user_id,room_id FROM timetable_slots WHERE school_id=$1 AND section_id=$2 AND day_of_week=$3 AND period_id=$4',
        [schoolId, sectionId, dayOfWeek, period.id],
      );
      if (existing.rows[0]) {
        const same = existing.rows[0].subject_id === subject.id && existing.rows[0].teacher_user_id === teacher.userId && existing.rows[0].room_id === room.id;
        if (!same) throw new Error(`Existing class 6 lesson at day ${dayOfWeek}, period ${sequenceNo} conflicts with the demo seed; nothing was changed.`);
        slotCount++;
        continue;
      }
      await client.query(
        `INSERT INTO timetable_slots(school_id,academic_year_id,section_id,period_id,day_of_week,subject_id,teacher_user_id,room_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [schoolId, yearId, sectionId, period.id, dayOfWeek, subject.id, teacher.userId, room.id],
      );
      slotCount++;
    }
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ databaseHost: parsed.hostname, school: 'Digi-School', academicYear: '2026-27 [DEMO]', section: 'Class 6 [DEMO] · A [DEMO]', demoTeachers: teachers.map((teacher) => teacher.displayName), periods: periods.length, breakPeriods: periods.filter((period) => period.is_break).length, rooms: rooms.length, weeklySlots: slotCount, note: 'Synthetic demo teacher identities have no password and cannot sign in.' }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
