import crypto from 'node:crypto';
import { hashPassword } from '@erp/core';
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLES } from '@erp/shared';
import type pg from 'pg';
import {
  createPool,
  DATABASE_URL,
  databaseUrlParts,
  ensureDatabase,
  isLocalDatabase,
  pingDatabase,
  runMigrations,
  startEmbeddedPostgres,
  waitForDatabase,
} from './index';

export interface DemoSeedSummary {
  schoolId: string;
  studentsCount: number;
  staffCount: number;
  classesCount: number;
  sectionsCount: number;
  vehiclesCount: number;
  transportAllocationsCount: number;
  libraryBooksCount: number;
  libraryCopiesCount: number;
  chargesCount: number;
  paymentsCount: number;
  offlineQueueCount: number;
  attendanceRecordsCount: number;
  shortageCasesCount: number;
  geofencesCount: number;
  biometricProfilesCount: number;
  kiosksCount: number;
  punchEventsCount: number;
  attendanceExceptionsCount: number;
  facilitiesCount?: number;
  maintenanceTicketsCount?: number;
  ptmSlotsCount?: number;
  certificatesCount?: number;
  clubsCount?: number;
  alumniCount?: number;
  demoUsers: Array<{ email: string; role: string; label: string }>;
}

const DEMO_PASSWORDS = {
  admin: 'Admin@12345',
  principal: 'Admin@12345',
  coordinator: 'Coord@12345',
  teacher: 'Teacher@12345',
  student: 'Student@12345',
  parent: 'Parent@12345',
  finance: 'Finance@12345',
  hr: 'Staff@12345',
  transport: 'Staff@12345',
  librarian: 'Staff@12345',
  auditor: 'Auditor@12345',
  staff: 'Staff@12345',
} as const;

export const LIVE_DEMO_CODE = 'DIGIVISTA_DEMO';
export const LIVE_DEMO_DOMAIN = 'erp-live-demo.test';

export async function seedLiveDemo(
  client: pg.PoolClient,
  passwords: Readonly<Record<string, string>>,
  finish: (schoolId: string) => Promise<void>,
): Promise<DemoSeedSummary> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('digivista-live-demo-seed'))");
    const { rows: [state] } = await client.query<{ blocked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM schools WHERE code = $1)
          OR EXISTS (SELECT 1 FROM users WHERE lower(email) LIKE $2) AS blocked`,
      [LIVE_DEMO_CODE, '%@' + LIVE_DEMO_DOMAIN],
    );
    if (state?.blocked !== false) throw new Error('The live demo tenant or account namespace already exists');
    const summary = await executeDemoSeed(client, passwords);
    await finish(summary.schoolId);
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function runHighScaleDemoSeed(poolClient?: pg.PoolClient): Promise<DemoSeedSummary> {
  let localClient = false;
  let client = poolClient;

  if (!client) {
    if (!(await pingDatabase())) {
      if (!isLocalDatabase()) {
        throw new Error(`Cannot reach ${DATABASE_URL}`);
      }
      console.log('Starting embedded PostgreSQL for high-scale demo seed...');
      const handle = await startEmbeddedPostgres({ persistent: true, log: false });
      const parts = databaseUrlParts();
      await ensureDatabase(handle.instance, parts.database);
      await waitForDatabase();
    }
    const pool = createPool();
    await runMigrations(pool);
    client = await pool.connect();
    localClient = true;
  }

  try {
    await client.query('BEGIN');
    const summary = await executeDemoSeed(client);
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (localClient && client) {
      client.release();
    }
  }
}

export async function seedHostedTrial(client: pg.PoolClient) {
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE schools, users IN SHARE ROW EXCLUSIVE MODE');
    const { rows: [state] } = await client.query<{ populated: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM schools) OR EXISTS (SELECT 1 FROM users) AS populated',
    );
    if (state?.populated !== false) throw new Error('Hosted trial seeding requires an empty database');

    const { schoolId } = await executeDemoSeed(client);
    const { rows: assignments } = await client.query<{ role: string; scope_id: string | null }>(
      `SELECT r.code AS role, a.scope_id FROM user_role_assignments a
       JOIN roles r ON r.id = a.role_id WHERE a.school_id = $1`,
      [schoolId],
    );
    const seededRoles = new Set(assignments.map((assignment) => assignment.role));
    for (const role of ROLES.filter((entry) => !seededRoles.has(entry.code))) {
      const scopeId = role.defaultScopeType === 'section'
        ? assignments.find((assignment) => assignment.role === 'teacher' && assignment.scope_id)?.scope_id
        : null;
      if (role.defaultScopeType === 'section' && !scopeId) throw new Error('Missing pilot teacher section');
      const { rows: [user] } = await client.query<{ id: string }>(
        `INSERT INTO users (email, display_name, status) VALUES ($1, $2, 'active') RETURNING id`,
        [`${role.code}@demo.test`, role.name],
      );
      await client.query(
        `INSERT INTO user_role_assignments (user_id, role_id, school_id, scope_type, scope_id, reason)
         SELECT $1, id, $2, $3, $4, 'Hosted trial persona' FROM roles WHERE code = $5`,
        [user!.id, schoolId, role.defaultScopeType, scopeId, role.code],
      );
    }

    const { rows: accounts } = await client.query<{ id: string; email: string; roles: string[] }>(
      `SELECT u.id, u.email, COALESCE(array_agg(r.code ORDER BY r.code)
         FILTER (WHERE r.code IS NOT NULL), '{}') AS roles FROM users u
       LEFT JOIN user_role_assignments a ON a.user_id = u.id LEFT JOIN roles r ON r.id = a.role_id
       GROUP BY u.id ORDER BY u.email`,
    );
    const credentials = [];
    for (const account of accounts) {
      const password = crypto.randomBytes(24).toString('base64url');
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
        account.id, await hashPassword(password),
      ]);
      if (account.roles.length) credentials.push({ email: account.email, roles: account.roles, password });
    }
    await client.query('COMMIT');
    return credentials;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function executeDemoSeed(client: pg.PoolClient, livePasswords?: Readonly<Record<string, string>>): Promise<DemoSeedSummary> {
  console.log('⚡ Starting Rang-Biranga High-Scale CBSE Demo Seed...');

  /* ---------------------- 1. Permissions & Canonical Roles ------------------ */
  for (const code of livePasswords ? [] : PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions (code, description) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`,
      [code, PERMISSION_DESCRIPTIONS[code]],
    );
  }

  const roleIds = new Map<string, string>();
  if (livePasswords) {
    const { rows } = await client.query<{ id: string; code: string }>('SELECT id, code FROM roles');
    for (const role of rows) roleIds.set(role.code, role.id);
    if (ROLES.some((role) => !roleIds.has(role.code))) throw new Error('Live database is missing a canonical role');
  }
  for (const role of livePasswords ? [] : ROLES) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO roles (code, name, description, privileged_flag)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             privileged_flag = EXCLUDED.privileged_flag
       RETURNING id`,
      [role.code, role.name, role.description, role.code === 'main_admin'],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`Could not upsert role ${role.code}`);
    roleIds.set(role.code, id);

    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    for (const permission of role.permissions) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = $2`,
        [id, permission],
      );
    }
  }

  /* ------------------- 2. Demo School & Campuses & Years -------------------- */
  const { rows: schoolRows } = await client.query<{ id: string }>(
    `INSERT INTO schools (code, name, timezone)
     VALUES ($1, $2, 'Asia/Kolkata')
     ${livePasswords ? '' : 'ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name'}
     RETURNING id`,
    livePasswords ? [LIVE_DEMO_CODE, 'Digivista Demonstration School'] : ['GREENFIELD', 'Udaan Valley International School (Demo)'],
  );
  const schoolId = schoolRows[0]!.id;

  await client.query(
    `INSERT INTO campuses (school_id, code, name)
     VALUES ($1, 'MAIN', 'Main Campus (Sikandar Bagh Road)')
     ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name`,
    [schoolId],
  );

  await client.query(
    `INSERT INTO academic_years (school_id, code, name, starts_on, ends_on, status)
     VALUES ($1, '2025-26', 'Academic Year 2025-26', '2025-04-01', '2026-03-31', 'closed')
     ON CONFLICT (school_id, code) DO NOTHING`,
    [schoolId],
  );

  const { rows: yearRows } = await client.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, code, name, starts_on, ends_on, status)
     VALUES ($1, '2026-27', 'Academic Year 2026-27', '2026-04-01', '2027-03-31', 'active')
     ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [schoolId],
  );
  const activeYearId = yearRows[0]!.id;

  /* -------------------- 3. Classes (Nursery to 12) & Sections ---------------- */
  const classConfigs = [
    { code: 'NUR', name: 'Nursery', gradeOrder: 0, sections: [{ code: 'A', name: 'Section A', capacity: 40 }] },
    { code: 'LKG', name: 'LKG', gradeOrder: 0, sections: [{ code: 'A', name: 'Section A', capacity: 45 }] },
    { code: 'UKG', name: 'UKG', gradeOrder: 0, sections: [{ code: 'A', name: 'Section A', capacity: 45 }] },
    ...Array.from({ length: 10 }, (_, i) => ({
      code: `G${i + 1}`,
      name: `Class ${i + 1}`,
      gradeOrder: i + 1,
      sections: [
        { code: 'A', name: 'Section A', capacity: 55 },
        { code: 'B', name: 'Section B', capacity: 55 },
      ],
    })),
    {
      code: 'G11',
      name: 'Class 11',
      gradeOrder: 11,
      sections: [
        { code: 'A', name: 'Section A (Science)', capacity: 50 },
        { code: 'B', name: 'Section B (Commerce)', capacity: 50 },
        { code: 'C', name: 'Section C (Humanities)', capacity: 45 },
      ],
    },
    {
      code: 'G12',
      name: 'Class 12',
      gradeOrder: 12,
      sections: [
        { code: 'A', name: 'Section A (Science)', capacity: 50 },
        { code: 'B', name: 'Section B (Commerce)', capacity: 50 },
        { code: 'C', name: 'Section C (Humanities)', capacity: 45 },
      ],
    },
  ];

  const classIds = new Map<string, string>();
  const sectionIds = new Map<string, string>();

  for (const cfg of classConfigs) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO classes (school_id, code, name, grade_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, grade_order = EXCLUDED.grade_order
       RETURNING id`,
      [schoolId, cfg.code, cfg.name, cfg.gradeOrder],
    );
    const cId = rows[0]!.id;
    classIds.set(cfg.code, cId);

    for (const sec of cfg.sections) {
      const { rows: secRows } = await client.query<{ id: string }>(
        `INSERT INTO sections (school_id, academic_year_id, class_id, code, name, capacity)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (academic_year_id, class_id, code) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity
         RETURNING id`,
        [schoolId, activeYearId, cId, sec.code, sec.name, sec.capacity],
      );
      sectionIds.set(`${cfg.code}-${sec.code}`, secRows[0]!.id);
    }
  }

  /* ------------------------------ 4. Subjects ------------------------------ */
  const subjectsData = [
    ['ENG', 'English Language & Literature'],
    ['HIN', 'Hindi Course A'],
    ['SAN', 'Sanskrit'],
    ['MAT', 'Mathematics'],
    ['SCI', 'Science & Technology'],
    ['SST', 'Social Studies'],
    ['PHY', 'Physics'],
    ['CHE', 'Chemistry'],
    ['BIO', 'Biology'],
    ['CS', 'Computer Science'],
    ['ACC', 'Accountancy'],
    ['BST', 'Business Studies'],
    ['ECO', 'Economics'],
    ['PE', 'Physical Education'],
    ['ART', 'Visual & Performing Arts'],
    // Expanded CBSE stage-wise subjects
    ['EVS', 'Environmental Studies (EVS)'],
    ['IT', 'Information Technology (Skill Subject 402)'],
    ['AI', 'Artificial Intelligence (Skill Subject 417)'],
    ['IP', 'Informatics Practices (065)'],
    ['AP_MAT', 'Applied Mathematics (241)'],
    ['POL', 'Political Science (028)'],
    ['HIS', 'History (027)'],
    ['GEO', 'Geography (029)'],
    ['PSY', 'Psychology (037)'],
    ['SOC', 'Sociology (039)'],
    ['ENT', 'Entrepreneurship (066)'],
    ['NUM', 'Early Numeracy & Logic'],
  ] as const;

  const subjectIds = new Map<string, string>();
  for (const [code, name] of subjectsData) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO subjects (school_id, code, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [schoolId, code, name],
    );
    subjectIds.set(code, rows[0]!.id);
  }

  /* --------------------------- 5. Core Demo Users --------------------------- */
  const passwordHashes: Record<string, string> = {
    admin: await hashPassword(DEMO_PASSWORDS.admin),
    coordinator: await hashPassword(DEMO_PASSWORDS.coordinator),
    teacher: await hashPassword(DEMO_PASSWORDS.teacher),
    student: await hashPassword(DEMO_PASSWORDS.student),
    parent: await hashPassword(DEMO_PASSWORDS.parent),
    finance: await hashPassword(DEMO_PASSWORDS.finance),
    auditor: await hashPassword(DEMO_PASSWORDS.auditor),
    staff: await hashPassword(DEMO_PASSWORDS.staff),
  };

  async function ensureUser(
    email: string,
    displayName: string,
    passHash: string,
  ): Promise<string> {
    if (livePasswords) {
      const username = email.split('@', 1)[0]!;
      const password = livePasswords[username] ?? crypto.randomBytes(32).toString('base64url');
      if (password.length < 24) throw new Error('Live demo passwords must have at least 24 characters');
      const { rows: [user] } = await client.query<{ id: string }>(
        "INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id",
        [`${username}@${LIVE_DEMO_DOMAIN}`, displayName, await hashPassword(password)],
      );
      return user!.id;
    }
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE users SET display_name = $2, password_hash = $3, status = 'active' WHERE id = $1`,
        [existing.rows[0].id, displayName, passHash],
      );
      return existing.rows[0].id;
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [email, displayName, passHash],
    );
    return rows[0]!.id;
  }

  const demoUsers: Record<string, string> = {
    admin: await ensureUser('admin@demo.test', 'Anita Deshpande (Principal)', passwordHashes.admin!),
    coordinator: await ensureUser('coordinator@demo.test', 'Rahul Menon (Academics)', passwordHashes.coordinator!),
    teacher: await ensureUser('teacher@demo.test', 'Sneha Kulkarni (Class Teacher)', passwordHashes.teacher!),
    student: await ensureUser('student@demo.test', 'Kabir Menon (Student Class 10)', passwordHashes.student!),
    aarav: await ensureUser('aarav@demo.test', 'Aarav Sharma (Student Class 6-A)', passwordHashes.student!),
    parent: await ensureUser('parent@demo.test', 'Priya Sharma (Parent)', passwordHashes.parent!),
    finance: await ensureUser('finance@demo.test', 'Vikram Rao (Finance Manager)', passwordHashes.finance!),
    hr: await ensureUser('hr@demo.test', 'Meenakshi Iyer (HR Lead)', passwordHashes.staff!),
    transport: await ensureUser('transport@demo.test', 'Gurpreet Singh (Fleet Manager)', passwordHashes.staff!),
    librarian: await ensureUser('librarian@demo.test', 'Shalini Verma (Chief Librarian)', passwordHashes.staff!),
    auditor: await ensureUser('auditor@demo.test', 'Farah Khan (Internal Auditor)', passwordHashes.auditor!),
  };

  // Assign roles
  const assignments: Array<{
    userId: string;
    role: string;
    scopeType: 'school' | 'section' | 'linked_student' | 'self';
    scopeId: string | null;
  }> = [
    { userId: demoUsers.admin!, role: 'main_admin', scopeType: 'school', scopeId: null },
    { userId: demoUsers.coordinator!, role: 'academic_coordinator', scopeType: 'school', scopeId: null },
    { userId: demoUsers.teacher!, role: 'teacher', scopeType: 'section', scopeId: sectionIds.get('G1-A')! },
    { userId: demoUsers.student!, role: 'student', scopeType: 'self', scopeId: null },
    { userId: demoUsers.aarav!, role: 'student', scopeType: 'self', scopeId: null },
    { userId: demoUsers.parent!, role: 'parent', scopeType: 'linked_student', scopeId: null },
    { userId: demoUsers.finance!, role: 'finance', scopeType: 'school', scopeId: null },
    { userId: demoUsers.hr!, role: 'hr', scopeType: 'school', scopeId: null },
    { userId: demoUsers.transport!, role: 'transport', scopeType: 'school', scopeId: null },
    { userId: demoUsers.librarian!, role: 'librarian', scopeType: 'school', scopeId: null },
    { userId: demoUsers.auditor!, role: 'auditor', scopeType: 'school', scopeId: null },
  ];

  await client.query(
    'DELETE FROM user_role_assignments WHERE school_id = $1 AND user_id = ANY($2::uuid[])',
    [schoolId, Object.values(demoUsers)],
  );

  for (const asgn of assignments) {
    const roleId = roleIds.get(asgn.role);
    if (!roleId) continue;
    await client.query(
      `INSERT INTO user_role_assignments
         (user_id, role_id, school_id, scope_type, scope_id, reason)
       VALUES ($1, $2, $3, $4, $5, 'High scale seed')`,
      [asgn.userId, roleId, schoolId, asgn.scopeType, asgn.scopeId],
    );
  }

  /* ------------------- 6. Staff & HR (85+ Realistic Staff) ------------------ */
  console.log('  Seeding staff members and teacher eligibility profiles...');
  const firstNamesList = [
    'Rajesh', 'Suresh', 'Amit', 'Sunil', 'Manoj', 'Pankaj', 'Deepak', 'Alok',
    'Ramesh', 'Sanjay', 'Vikas', 'Manish', 'Naveen', 'Ashok', 'Anil', 'Pradeep',
    'Sunita', 'Rekha', 'Pooja', 'Anjali', 'Kavita', 'Suman', 'Geeta', 'Shweta',
    'Ritu', 'Neelam', 'Seema', 'Mamta', 'Aarti', 'Usha', 'Vandana', 'Preeti',
    'Archana', 'Madhuri', 'Nisha', 'Sarita', 'Swati', 'Poonam', 'Bhawna', 'Jyoti',
  ];
  const lastNamesList = [
    'Sharma', 'Verma', 'Gupta', 'Singh', 'Mishra', 'Pandey', 'Saxena', 'Chauhan',
    'Yadav', 'Trivedi', 'Tripathi', 'Srivastava', 'Dubey', 'Shukla', 'Tiwari', 'Bhatt',
    'Nair', 'Iyer', 'Menon', 'Pillai', 'Rao', 'Reddy', 'Patel', 'Deshmukh',
  ];

  const staffIdsList: string[] = [];
  const teacherStaffIds: string[] = [];

  // Seed Admin & Leaders
  const coreStaffSpecs = [
    { empNo: 'EMP-0001', userId: demoUsers.admin!, first: 'Anita', last: 'Deshpande', desig: 'Principal', dept: 'Administration', salary: 125000 },
    { empNo: 'EMP-0002', userId: demoUsers.coordinator!, first: 'Rahul', last: 'Menon', desig: 'Academic Coordinator', dept: 'Academics', salary: 85000 },
    { empNo: 'EMP-0003', userId: demoUsers.teacher!, first: 'Sneha', last: 'Kulkarni', desig: 'Senior Primary Teacher', dept: 'Primary', salary: 60000 },
    { empNo: 'EMP-0004', userId: demoUsers.finance!, first: 'Vikram', last: 'Rao', desig: 'Finance Manager', dept: 'Finance', salary: 75000 },
    { empNo: 'EMP-0005', userId: demoUsers.hr!, first: 'Meenakshi', last: 'Iyer', desig: 'HR Manager', dept: 'Human Resources', salary: 70000 },
    { empNo: 'EMP-0006', userId: demoUsers.transport!, first: 'Gurpreet', last: 'Singh', desig: 'Transport Supervisor', dept: 'Transport', salary: 55000 },
    { empNo: 'EMP-0007', userId: demoUsers.librarian!, first: 'Shalini', last: 'Verma', desig: 'Head Librarian', dept: 'Library', salary: 52000 },
    { empNo: 'EMP-0008', userId: demoUsers.auditor!, first: 'Farah', last: 'Khan', desig: 'Internal Auditor', dept: 'Governance', salary: 68000 },
    { empNo: 'EMP-0009', userId: null, first: 'Devendra', last: 'Prasad', desig: 'Senior Driver', dept: 'Transport', salary: 28000 },
    { empNo: 'EMP-0010', userId: null, first: 'Ram', last: 'Kishore', desig: 'Fleet Driver', dept: 'Transport', salary: 26000 },
  ];

  for (const cs of coreStaffSpecs) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO staff
         (school_id, user_id, employee_number, first_name, last_name, designation,
          department, joined_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '2023-04-01', 'active')
       ON CONFLICT (school_id, employee_number) DO UPDATE
         SET user_id = EXCLUDED.user_id, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
       RETURNING id`,
      [schoolId, cs.userId, cs.empNo, cs.first, cs.last, cs.desig, cs.dept],
    );
    staffIdsList.push(rows[0]!.id);
    if (cs.dept === 'Academics' || cs.dept === 'Primary') teacherStaffIds.push(rows[0]!.id);

    await client.query(
      `INSERT INTO staff_salaries
         (school_id, staff_id, amount, currency, effective_from, notes, updated_by)
       VALUES ($1, $2, $3, 'INR', '2026-04-01', 'Annual Revision 2026', $4)
       ON CONFLICT (school_id, staff_id) DO UPDATE SET amount = EXCLUDED.amount`,
      [schoolId, rows[0]!.id, cs.salary, demoUsers.admin!],
    );
  }

  // Seed dedicated CBSE Subject Teachers matching the attendance PDF specification
  const teacherUserMap = new Map<string, string>();
  const specialTeacherSpecs = [
    { empNo: 'EMP1034', first: 'Rajesh', last: 'Sharma', email: 'rajesh.sharma@demo.test', sub: 'ENG', desig: 'Senior English Teacher', dept: 'Secondary' },
    { empNo: 'EMP1048', first: 'Vikram', last: 'Verma', email: 'vikram.verma@demo.test', sub: 'MAT', desig: 'Senior Mathematics Teacher', dept: 'Secondary' },
    { empNo: 'EMP1066', first: 'Pooja', last: 'Gupta', email: 'pooja.gupta@demo.test', sub: 'SCI', desig: 'Senior Science Teacher', dept: 'Secondary' },
    { empNo: 'EMP1075', first: 'Anjali', last: 'Mishra', email: 'anjali.mishra@demo.test', sub: 'SST', desig: 'Social Studies Teacher', dept: 'Middle School' },
    { empNo: 'EMP1102', first: 'Manoj', last: 'Tiwari', email: 'manoj.tiwari@demo.test', sub: 'HIN', desig: 'Hindi Language Teacher', dept: 'Middle School' },
    { empNo: 'EMP1121', first: 'Ritu', last: 'Saxena', email: 'ritu.saxena@demo.test', sub: 'CS', desig: 'Computer Science Faculty', dept: 'Secondary' },
  ];

  for (const st of specialTeacherSpecs) {
    const uid = await ensureUser(st.email, `${st.first} ${st.last}`, passwordHashes.teacher!);
    teacherUserMap.set(st.empNo, uid);
    const teacherRoleId = roleIds.get('teacher');
    if (teacherRoleId) {
      await client.query(
        `INSERT INTO user_role_assignments (user_id, role_id, school_id, scope_type, scope_id, reason)
         VALUES ($1, $2, $3, 'school', null, 'Subject Teacher Role')
         ON CONFLICT DO NOTHING`,
        [uid, teacherRoleId, schoolId],
      );
    }

    const { rows: stRows } = await client.query<{ id: string }>(
      `INSERT INTO staff
         (school_id, user_id, employee_number, first_name, last_name, designation, department, joined_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '2023-06-15', 'active')
       ON CONFLICT (school_id, employee_number) DO UPDATE
         SET user_id = EXCLUDED.user_id, status = 'active'
       RETURNING id`,
      [schoolId, uid, st.empNo, st.first, st.last, st.desig, st.dept],
    );
    const sid = stRows[0]!.id;
    staffIdsList.push(sid);
    teacherStaffIds.push(sid);

    await client.query(
      `INSERT INTO staff_salaries (school_id, staff_id, amount, currency, effective_from, updated_by)
       VALUES ($1, $2, 62000, 'INR', '2026-04-01', $3)
       ON CONFLICT (school_id, staff_id) DO NOTHING`,
      [schoolId, sid, demoUsers.admin!],
    );

    const subId = subjectIds.get(st.sub);
    if (subId) {
      await client.query(
        `INSERT INTO teacher_eligibility_profiles
           (school_id, staff_id, subject_id, qualification, min_grade_order, max_grade_order, max_weekly_periods, verification_status)
         VALUES ($1, $2, $3, 'B.Ed, Post-Graduate Specialist', 6, 12, 28, 'verified')
         ON CONFLICT (school_id, staff_id, subject_id) DO NOTHING`,
        [schoolId, sid, subId],
      );
    }
  }

  // Seed 75 more teachers and specialists to exceed 80 total staff
  const departments = ['Primary', 'Middle School', 'Secondary', 'Senior Secondary', 'Physical Education', 'Arts & Music'];
  for (let i = 11; i <= (livePasswords ? 25 : 85); i++) {
    const empNo = `EMP-${String(i).padStart(4, '0')}`;
    const fName = firstNamesList[(i * 3) % firstNamesList.length]!;
    const lName = lastNamesList[(i * 5) % lastNamesList.length]!;
    const dept = departments[i % departments.length]!;
    const desig = dept === 'Primary' ? 'PRT Teacher' : dept === 'Middle School' ? 'TGT Teacher' : dept === 'Senior Secondary' ? 'PGT Lecturer' : 'Specialist Teacher';
    const salary = 45000 + ((i * 1200) % 35000);

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO staff
         (school_id, employee_number, first_name, last_name, designation, department, joined_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, '2024-06-15', 'active')
       ON CONFLICT (school_id, employee_number) DO UPDATE SET status = 'active'
       RETURNING id`,
      [schoolId, empNo, fName, lName, desig, dept],
    );
    const sid = rows[0]!.id;
    staffIdsList.push(sid);
    teacherStaffIds.push(sid);

    await client.query(
      `INSERT INTO staff_salaries (school_id, staff_id, amount, currency, effective_from, updated_by)
       VALUES ($1, $2, $3, 'INR', '2026-04-01', $4)
       ON CONFLICT (school_id, staff_id) DO NOTHING`,
      [schoolId, sid, salary, demoUsers.admin!],
    );

    // Seed Teacher Eligibility Profile
    const qualifications = ['B.Ed, M.Sc Mathematics', 'B.Ed, M.A English', 'B.Ed, M.Sc Physics', 'B.Ed, M.Sc Chemistry', 'B.Ed, M.A History', 'B.P.Ed', 'MCA, B.Ed'];
    const minG = dept === 'Primary' ? 1 : dept === 'Middle School' ? 6 : 9;
    const maxG = dept === 'Primary' ? 5 : dept === 'Middle School' ? 10 : 12;
    const subCode = dept === 'Primary' ? 'ENG' : dept === 'Middle School' ? 'SCI' : dept === 'Senior Secondary' ? 'PHY' : 'ART';
    const subId = subjectIds.get(subCode) ?? Array.from(subjectIds.values())[0];
    if (subId) {
      await client.query(
        `INSERT INTO teacher_eligibility_profiles
           (school_id, staff_id, subject_id, qualification, min_grade_order, max_grade_order, max_weekly_periods, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, 28, 'verified')
         ON CONFLICT (school_id, staff_id, subject_id) DO NOTHING`,
        [schoolId, sid, subId, qualifications[i % qualifications.length]!, minG, maxG],
      );
    }
  }

  // Shifts and Assignments
  const { rows: shiftRows } = await client.query<{ id: string }>(
    `INSERT INTO staff_shifts (school_id, code, name, starts_at, ends_at, grace_minutes)
     VALUES ($1, 'GENERAL', 'General Faculty Shift', '08:00', '15:30', 15)
     ON CONFLICT (school_id, code) DO UPDATE SET active = true
     RETURNING id`,
    [schoolId],
  );
  const shiftId = shiftRows[0]!.id;

  for (const sid of staffIdsList.slice(0, 40)) {
    await client.query(
      `INSERT INTO staff_shift_assignments (school_id, staff_id, shift_id, effective_from)
       VALUES ($1, $2, $3, '2026-04-01')
       ON CONFLICT (school_id, staff_id, effective_from) DO NOTHING`,
      [schoolId, sid, shiftId],
    );
  }

  // Approved Payroll Run
  const { rows: prRows } = await client.query<{ id: string }>(
    `INSERT INTO payroll_runs (school_id, period_start, period_end, notes, status, created_by, approved_by, approved_at)
     VALUES ($1, '2026-09-01', '2026-09-30', 'September 2026 Monthly Salary Run', 'approved', $2, $3, now())
     ON CONFLICT (school_id, period_start, period_end) DO UPDATE SET status = 'approved'
     RETURNING id`,
    [schoolId, demoUsers.finance!, demoUsers.admin!],
  );
  const payrollRunId = prRows[0]!.id;

  for (const sid of staffIdsList) {
    await client.query(
      `INSERT INTO payslips (school_id, run_id, staff_id, gross_amount, deductions, net_amount, notes)
       SELECT $1, $2, s.id, sal.amount, ROUND(sal.amount * 0.12, 2), ROUND(sal.amount * 0.88, 2), 'Provident Fund & Professional Tax'
       FROM staff s
       JOIN staff_salaries sal ON sal.staff_id = s.id
       WHERE s.id = $3
       ON CONFLICT (school_id, run_id, staff_id) DO NOTHING`,
      [schoolId, payrollRunId, sid],
    );
  }

  /* ------------------- 7. Students (1,270 Realistically Seeded) ------------- */
  console.log('  Seeding students across Nursery to Class 12 and sections...');
  const studentIndianFirstNames = [
    'Aarav', 'Diya', 'Kabir', 'Ananya', 'Vivaan', 'Riya', 'Ishaan', 'Roshni',
    'Advait', 'Tanvi', 'Reyansh', 'Saanvi', 'Dhruv', 'Meera', 'Arjun', 'Prisha',
    'Vihaan', 'Navya', 'Atharva', 'Anika', 'Aryan', 'Myra', 'Shaurya', 'Tara',
    'Ayaan', 'Ishita', 'Aditya', 'Kiara', 'Rudra', 'Sneha', 'Dev', 'Pooja',
    'Yash', 'Kriti', 'Rohan', 'Pari', 'Kunal', 'Riddhi', 'Siddharth', 'Avni',
    'Manav', 'Bhavya', 'Tanishq', 'Palak', 'Harsh', 'Shruti', 'Varun', 'Isha',
    'Nikhil', 'Neha', 'Parth', 'Khushi',
  ];
  const studentIndianSurnames = [
    'Sharma', 'Patel', 'Menon', 'Iyer', 'Gupta', 'Verma', 'Singh', 'Nair',
    'Joshi', 'Kulkarni', 'Rao', 'Khan', 'Banerjee', 'Chatterjee', 'Reddy', 'Kapoor',
    'Malhotra', 'Bhatia', 'Mehta', 'Shah', 'Agarwal', 'Mishra', 'Pandey', 'Saxena',
    'Chauhan', 'Deshmukh', 'Kadam', 'Pillai', 'Nambiar', 'Sen', 'Bose', 'Ghosh',
  ];
  const bloodGroups = ['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-'];

  const allStudentIds: Array<{ id: string; grade: number; sectionId: string; roll: number }> = [];

  // Create Parent Guardian User
  const parentEmail = livePasswords ? `parent@${LIVE_DEMO_DOMAIN}` : 'parent@demo.test';
  const { rows: parentGuardianRows } = await client.query<{ id: string }>(
    `INSERT INTO guardians (school_id, user_id, first_name, last_name, email, phone)
     VALUES ($1, $2, 'Priya', 'Sharma', $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [schoolId, demoUsers.parent!, parentEmail, livePasswords ? null : '+91 98765 40001'],
  );
  let parentGuardianId = parentGuardianRows[0]?.id;
  if (!parentGuardianId) {
    const res = await client.query<{ id: string }>(
      'SELECT id FROM guardians WHERE school_id = $1 AND email = $2 LIMIT 1',
      [schoolId, parentEmail],
    );
    parentGuardianId = res.rows[0]!.id;
  }

  let aaravInfo: { studentId: string; enrollmentId: string; sectionId: string; classId: string } | null = null;
  let anayaInfo: { studentId: string; enrollmentId: string; sectionId: string; classId: string } | null = null;

  let admissionSeq = 0;
  for (const cfg of classConfigs) {
    const classId = classIds.get(cfg.code)!;
    const grade = cfg.gradeOrder;
    const birthYear = 2026 - Math.max(3, grade + 5);

    for (const sec of cfg.sections) {
      const sectionKey = `${cfg.code}-${sec.code}`;
      const sectionId = sectionIds.get(sectionKey)!;

      // Realistic class sizes: 30 for Nursery, 35 for LKG/UKG/11/12, 48 for Classes 1-10
      const classRollMax =
        livePasswords ? 4 :
        cfg.code === 'NUR' ? 30 :
        cfg.code === 'LKG' || cfg.code === 'UKG' ? 35 :
        cfg.gradeOrder >= 11 ? 35 : 48;

      for (let roll = 1; roll <= classRollMax; roll++) {
        admissionSeq++;
        const admNo = `ADM-2026-${String(admissionSeq).padStart(5, '0')}`;
        const fName = studentIndianFirstNames[(roll + admissionSeq) % studentIndianFirstNames.length]!;
        const lName = studentIndianSurnames[(roll * 3 + admissionSeq) % studentIndianSurnames.length]!;
        const dobMonth = String(((roll % 12) + 1)).padStart(2, '0');
        const dobDay = String(((roll % 28) + 1)).padStart(2, '0');
        const dob = `${birthYear}-${dobMonth}-${dobDay}`;
        const bg = bloodGroups[(roll + (grade > 0 ? grade : 1)) % bloodGroups.length]!;
        const cbseReg = grade >= 9 ? `CBSE/2026/G${String(grade).padStart(2, '0')}/${String(admissionSeq).padStart(4, '0')}` : null;
        const phone = livePasswords ? null : `+91 98765 ${String(10000 + (admissionSeq % 90000))}`;

        // Link student@demo.test to Kabir (Class 10), aarav@demo.test to Aarav (Class 6), and Anaya (Class 3)
        const isAarav = cfg.code === 'G6' && sec.code === 'A' && roll === (livePasswords ? 2 : 15);
        const isAnaya = cfg.code === 'G3' && sec.code === 'B' && roll === (livePasswords ? 2 : 32);
        const isKabir = cfg.code === 'G10' && sec.code === 'A' && roll === 1;

        const studentUserId = isAarav ? demoUsers.aarav! : isKabir ? demoUsers.student! : null;
        const studentFirstName = isAarav ? 'Aarav' : isAnaya ? 'Anaya' : isKabir ? 'Kabir' : fName;
        const studentLastName = isAarav || isAnaya ? 'Sharma' : isKabir ? 'Menon' : lName;
        const studentRollNo = roll;
        const studentAdmNo = isAarav ? '24A015' : isAnaya ? '24A032' : admNo;

        const { rows: stRows } = await client.query<{ id: string }>(
          `INSERT INTO students
             (school_id, user_id, admission_number, roll_number, first_name, last_name,
              date_of_birth, blood_group, emergency_contact, cbse_reg_no, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')
           ON CONFLICT (school_id, admission_number) DO UPDATE
             SET user_id = EXCLUDED.user_id,
                 first_name = EXCLUDED.first_name,
                 last_name = EXCLUDED.last_name,
                 roll_number = EXCLUDED.roll_number,
                 cbse_reg_no = EXCLUDED.cbse_reg_no
           RETURNING id`,
          [schoolId, studentUserId, studentAdmNo, studentRollNo, studentFirstName, studentLastName, dob, bg, phone, cbseReg],
        );
        const stId = stRows[0]!.id;
        allStudentIds.push({ id: stId, grade, sectionId, roll });

        // Active enrollment
        const { rows: enRows } = await client.query<{ id: string }>(
          `INSERT INTO enrollments
             (school_id, student_id, academic_year_id, class_id, section_id, enrollment_status, starts_on)
           VALUES ($1, $2, $3, $4, $5, 'active', '2026-04-01')
           ON CONFLICT (student_id, academic_year_id) WHERE enrollment_status = 'active'
           DO UPDATE SET class_id = EXCLUDED.class_id, section_id = EXCLUDED.section_id
           RETURNING id`,
          [schoolId, stId, activeYearId, classId, sectionId],
        );
        const enrollId = enRows[0]!.id;

        if (isAarav) {
          aaravInfo = { studentId: stId, enrollmentId: enrollId, sectionId, classId };
        } else if (isAnaya) {
          anayaInfo = { studentId: stId, enrollmentId: enrollId, sectionId, classId };
        }

        // Link parent@demo.test to Aarav (G6-A) and Anaya (G3-B)
        if (isAarav || isAnaya) {
          await client.query(
            `INSERT INTO student_guardians
               (school_id, student_id, guardian_id, relationship_type, is_primary, portal_access_status)
             VALUES ($1, $2, $3, 'Mother', true, 'verified')
             ON CONFLICT (student_id, guardian_id) DO UPDATE SET portal_access_status = 'verified'`,
            [schoolId, stId, parentGuardianId],
          );
        }
      }
    }
  }

  /* ------------------- 8. Attendance & 80% Shortage Register Cases ---------- */
  console.log('  Seeding attendance records and shortage cases...');
  // We seed attendance for students in Class 1, 8, 10, 12 across 40 dates
  const termDates = [
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07',
    '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-13', '2026-07-14',
    '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-20', '2026-07-21',
    '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-27', '2026-07-28',
    '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
    '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
  ];

  // Pick specific sample students for shortage test cases (< 80%)
  const class10Students = allStudentIds.filter((s) => s.grade === 10);
  const class12Students = allStudentIds.filter((s) => s.grade === 12);
  const class8Students = allStudentIds.filter((s) => s.grade === 8);

  const sampleShortage1 = class10Students[2]!; // roll 3
  const sampleShortage2 = class12Students[4]!; // roll 5
  const sampleShortage3 = class8Students[1]!;  // roll 2

  // Insert shortage register entries in attendance_shortage_cases
  await client.query(
    `INSERT INTO attendance_shortage_cases
       (school_id, student_id, academic_year_id, calculated_attendance_rate, threshold_percent,
        total_working_days, days_attended, stage, warning_level, internal_exam_eligibility,
        board_exam_eligibility, explanation_text, medical_leave_days, authorized_decision,
        decided_by, decided_at, decision_notes)
     VALUES
       ($1, $2, $3, 70.00, 80.00, 40, 28.0, 'decision_rendered', 'second', 'eligible',
        'condoned_by_board', 'Severe viral infection with medical hospitalisation', 12.0,
        'Condoned under CBSE Rule 14.2 (Medical)', $4, now(),
        'Medical leave verified by school physician. Condoned under Rule 14.2.'),
       ($1, $5, $3, 75.00, 80.00, 40, 30.0, 'under_review', 'first', 'under_review',
        'condonation_submitted', 'State-level inter-school basketball tournament training camp', 5.0,
        'Requires PE department confirmation', $4, now(),
        'Under physical education verification.'),
       ($1, $6, $3, 72.50, 80.00, 40, 29.0, 'warning_issued', 'first', 'conditional',
        'not_applicable', null, 0, null, null, null, null)
     ON CONFLICT (school_id, student_id, academic_year_id) DO NOTHING`,
    [schoolId, sampleShortage1.id, activeYearId, demoUsers.admin!, sampleShortage2.id, sampleShortage3.id],
  );

  /* ------------------- 9. Transport Fleet (5 Indian Vehicles) --------------- */
  console.log('  Seeding transport fleet (Indian registrations & BH series)...');
  const vehicleSpecs = [
    { reg: 'UP 58 P 6370', model: 'Tata Starbus Ultra 52-Seater', cap: 52 },
    { reg: 'UP 32 CZ 8901', model: 'Ashok Leyland Sunshine 45-Seater', cap: 45 },
    { reg: 'DL 01 AB 1234', model: 'Eicher Skyline Pro 40-Seater', cap: 40 },
    { reg: '23 BH 1234 AB', model: 'SML Isuzu Executive 35-Seater (BH Series)', cap: 35 },
    { reg: '24 BH 5678 CD', model: 'Force Traveller Mini 18-Seater (BH Series)', cap: 18 },
  ];

  const vehicleIds: string[] = [];
  for (const vs of vehicleSpecs) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO transport_vehicles
         (school_id, registration_number, model, capacity, status, insurance_expires_on)
       VALUES ($1, $2, $3, $4, 'active', '2027-03-31')
       ON CONFLICT (school_id, registration_number) DO UPDATE
         SET model = EXCLUDED.model, capacity = EXCLUDED.capacity
       RETURNING id`,
      [schoolId, vs.reg, vs.model, vs.cap],
    );
    vehicleIds.push(rows[0]!.id);
  }

  // Drivers
  const driverSpecs = [
    { name: 'Devendra Prasad', phone: '+91 98765 60001', lic: 'UP5820150001234' },
    { name: 'Ram Kishore', phone: '+91 98765 60002', lic: 'UP3220180004567' },
    { name: 'Manjeet Singh', phone: '+91 98765 60003', lic: 'DL0120190007890' },
  ];
  const driverIds: string[] = [];
  for (const ds of driverSpecs) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO transport_drivers
         (school_id, full_name, phone, licence_number, licence_expires_on, status)
       VALUES ($1, $2, $3, $4, '2028-12-31', 'active')
       ON CONFLICT (school_id, id) DO NOTHING
       RETURNING id`,
      [schoolId, ds.name, livePasswords ? null : ds.phone, livePasswords ? null : ds.lic],
    );
    if (rows[0]) driverIds.push(rows[0].id);
  }

  // Routes & Stops
  const routeSpecs = [
    { code: 'RT-01', name: 'Route 1: Civil Lines - University Road', vIdx: 0, dIdx: 0 },
    { code: 'RT-02', name: 'Route 2: Gomti Nagar - Shaheed Path', vIdx: 1, dIdx: 1 },
    { code: 'RT-03', name: 'Route 3: Cantonment - Hazratganj (BH Bus)', vIdx: 3, dIdx: 2 },
  ];

  let transportAllocationsCount = 0;
  for (const rs of routeSpecs) {
    const { rows: rRows } = await client.query<{ id: string }>(
      `INSERT INTO transport_routes
         (school_id, code, name, vehicle_id, driver_id, attendant_name, status)
       VALUES ($1, $2, $3, $4, $5, 'Sunita Devi', 'active')
       ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [schoolId, rs.code, rs.name, vehicleIds[rs.vIdx] ?? null, driverIds[rs.dIdx] ?? null],
    );
    const rId = rRows[0]!.id;

    // Stops
    const stopNames = ['Main Gate Bus Stop', 'Market Square', 'Residential Colony Point', 'Final Terminus'];
    const stopIds: string[] = [];
    for (let sIdx = 0; sIdx < stopNames.length; sIdx++) {
      const { rows: stpRows } = await client.query<{ id: string }>(
        `INSERT INTO transport_stops (school_id, route_id, name, sequence_no, scheduled_pickup, scheduled_drop)
         VALUES ($1, $2, $3, $4, '07:15', '14:45')
         ON CONFLICT (school_id, route_id, sequence_no) WHERE retired_at IS NULL DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [schoolId, rId, stopNames[sIdx]!, sIdx + 1],
      );
      stopIds.push(stpRows[0]!.id);
    }

    // Allocate 30 students to each route
    const sampleStudents = allStudentIds.slice(transportAllocationsCount, transportAllocationsCount + 30);
    for (const [stIdx, st] of sampleStudents.entries()) {
      const stpId = stopIds[stIdx % stopIds.length]!;
      await client.query(
        `INSERT INTO student_transport_allocations
           (school_id, student_id, route_id, stop_id, effective_from, status, created_by)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active', $5)
         ON CONFLICT (school_id, student_id, effective_from) DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id`,
        [schoolId, st.id, rId, stpId, demoUsers.admin!],
      );
      transportAllocationsCount++;
    }
  }

  /* ------------------- 10. Library Catalogue & Circulation ------------------ */
  console.log('  Seeding library catalogue & physical book copies...');
  const { rows: catRows } = await client.query<{ id: string }>(
    `INSERT INTO library_categories (school_id, code, name)
     VALUES
       ($1, 'CBSE_TEXT', 'CBSE / NCERT Core Textbooks'),
       ($1, 'REF_SCIENCE', 'Science & Mathematics Reference'),
       ($1, 'LIT_CLASSICS', 'English & World Literature'),
       ($1, 'HINDI_LIT', 'Hindi Sahitya & Poetry')
     ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [schoolId],
  );
  const coreCatId = catRows[0]?.id;

  const booksData = [
    { title: 'NCERT Mathematics Class 10', author: 'NCERT Editorial Board', isbn: '978-81-7450-634-4' },
    { title: 'NCERT Science Class 10', author: 'NCERT Science Team', isbn: '978-81-7450-649-8' },
    { title: 'Concepts of Physics (Vol 1)', author: 'Dr. H.C. Verma', isbn: '978-81-7709-187-8' },
    { title: 'Mathematics for Class 10', author: 'R.D. Sharma', isbn: '978-93-8997-512-3' },
    { title: 'First Flight: Textbook in English for Class 10', author: 'NCERT', isbn: '978-81-7450-658-0' },
    { title: 'Godan', author: 'Munshi Premchand', isbn: '978-81-7028-003-3' },
    { title: 'Discovery of India', author: 'Jawaharlal Nehru', isbn: '978-01-4303-103-1' },
    { title: 'Wings of Fire', author: 'Dr. A.P.J. Abdul Kalam', isbn: '978-81-7371-146-3' },
  ];

  let libraryBooksCount = 0;
  let libraryCopiesCount = 0;
  for (const b of booksData) {
    const { rows: bRows } = await client.query<{ id: string }>(
      `INSERT INTO library_books (school_id, category_id, title, author, isbn, language, status)
       VALUES ($1, $2, $3, $4, $5, 'English', 'active')
       ON CONFLICT (school_id, isbn) WHERE isbn IS NOT NULL DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [schoolId, coreCatId ?? null, b.title, b.author, b.isbn],
    );
    const bookId = bRows[0]!.id;
    libraryBooksCount++;

    // Seed 4 copies per book
    for (let c = 1; c <= 4; c++) {
      const accNo = `ACC-${String(libraryCopiesCount + 1).padStart(5, '0')}`;
      await client.query(
        `INSERT INTO library_copies (school_id, book_id, accession_number, status, acquired_on)
         VALUES ($1, $2, $3, 'available', '2025-06-01')
         ON CONFLICT (school_id, accession_number) DO NOTHING`,
        [schoolId, bookId, accNo],
      );
      libraryCopiesCount++;
    }
  }

  /* ------------------- 11. Fees, Structures & Offline Verification Queue ---- */
  console.log('  Seeding fee heads, class structures & offline verification queue...');
  const feeHeadSpecs = [
    ['TUITION', 'Tuition Fee', 'Core academic instruction'],
    ['ACTIVITY', 'Annual Activity & Sports Fee', 'Extracurriculars, laboratory & sports'],
    ['EXAM', 'CBSE Examination Fee', 'Term evaluation & Board assessments'],
    ['TRANSPORT', 'School Bus Conveyance Fee', 'Safe transport fleet conveyance'],
  ] as const;

  const feeHeadIds = new Map<string, string>();
  for (const [code, name, desc] of feeHeadSpecs) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO fee_heads (school_id, code, name, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [schoolId, code, name, desc],
    );
    feeHeadIds.set(code, rows[0]!.id);
  }

  // Structures for Classes (Nursery to 12)
  for (const cfg of classConfigs) {
    const cId = classIds.get(cfg.code)!;
    const gradeVal = Math.max(1, cfg.gradeOrder);
    const tuitionAmount = cfg.gradeOrder <= 0 ? 28000 : 35000 + gradeVal * 2500;
    const actAmount = cfg.gradeOrder <= 0 ? 4000 : 6000;
    const examAmount = cfg.gradeOrder >= 9 ? 3500 : (cfg.gradeOrder <= 0 ? 1000 : 2000);

    await client.query(
      `INSERT INTO fee_structures (school_id, academic_year_id, class_id, fee_head_id, amount, due_on)
       VALUES
         ($1, $2, $3, $4, $5, '2026-04-15'),
         ($1, $2, $3, $6, $7, '2026-05-15'),
         ($1, $2, $3, $8, $9, '2026-08-15')
       ON CONFLICT (academic_year_id, class_id, fee_head_id) DO UPDATE SET amount = EXCLUDED.amount`,
      [schoolId, activeYearId, cId, feeHeadIds.get('TUITION')!, tuitionAmount, feeHeadIds.get('ACTIVITY')!, actAmount, feeHeadIds.get('EXAM')!, examAmount],
    );
  }

  // Charges for students
  let chargesCount = 0;
  for (const st of allStudentIds.slice(0, 150)) {
    const tuitionHeadId = feeHeadIds.get('TUITION')!;
    const tuitionAmount = 35000 + st.grade * 2500;
    await client.query(
      `INSERT INTO student_charges
         (school_id, student_id, academic_year_id, fee_head_id, description, amount, due_on, created_by)
       VALUES ($1, $2, $3, $4, 'Annual Tuition Fee', $5, '2026-04-15', $6)
       ON CONFLICT (student_id, academic_year_id, fee_head_id) DO NOTHING`,
      [schoolId, st.id, activeYearId, tuitionHeadId, tuitionAmount, demoUsers.admin!],
    );
    chargesCount++;
  }

  // Seed Offline Payment Acknowledgements Queue (D-041 verification workflow)
  console.log('  Seeding offline payment queue cases (pending, verified, query)...');
  const sampleStudentForOffline = allStudentIds[0]!;
  const sampleStudentForVerified = allStudentIds[1]!;
  const sampleStudentForQuery = allStudentIds[2]!;

  await client.query(
    `INSERT INTO fee_offline_payment_acknowledgements
       (school_id, student_id, amount, payment_method, reference_number,
        payment_date, bank_name, status, notes, reviewed_by, reviewed_at, review_notes)
     VALUES
       ($1, $2, 42500.00, 'upi', 'UPI/2026/0401/889211', '2026-04-10', 'State Bank of India',
        'pending', 'Paid via Google Pay, screenshot uploaded', null, null, null),
       ($1, $3, 45000.00, 'bank_transfer', 'NEFT/HDFC/99882211', '2026-04-05', 'HDFC Bank',
        'verified', 'Direct NEFT transfer from father salary account', $4, now(), 'Verified from branch scroll'),
       ($1, $5, 20000.00, 'cheque', 'CHQ-889901', '2026-04-12', 'Punjab National Bank',
        'more_info_needed', 'Cheque deposited in school dropbox', $4, now(),
        'Cheque amount ₹20,000 does not match the first instalment demand note of ₹26,000. Please contact accounts.')
     ON CONFLICT DO NOTHING`,
    [schoolId, sampleStudentForOffline.id, sampleStudentForVerified.id, demoUsers.finance!, sampleStudentForQuery.id],
  );

  /* ------------------- 12. School Configurations (Studio) ------------------- */
  console.log('  Seeding school configuration studio records...');
  await client.query(
    `INSERT INTO school_configurations (school_id, config_key, config_value, version, status, published_by, published_at)
     VALUES
       ($1, 'navigation_labels', '{"attendance": "Daily Roll Call", "exams": "Assessments & CBSE Reports", "fees": "Fee Billing & Receipts"}'::jsonb, 1, 'published', $2, now()),
       ($1, 'attendance_policy', '{"minimumThreshold": 80.0, "warningGraceDays": 3, "medicalExemptionAllowed": true, "boardExamCondonationCap": 15.0}'::jsonb, 1, 'published', $2, now()),
       ($1, 'workflow_settings', '{"offlineFeeDualApproval": false, "leaveAutoApproveDays": 1, "studentProfileApprovalRequired": true}'::jsonb, 1, 'published', $2, now()),
       ($1, 'library_policy', '{"maxBooksPerStudent": 3, "loanDurationDays": 14, "overdueFinePerDay": 2.00}'::jsonb, 1, 'published', $2, now()),
       ($1, 'branding', '{"primaryColor": "#0B3F4B", "accentSun": "#FFC83D", "accentCoral": "#FF756B", "schoolMotto": "Vidya Dadati Vinayam (Knowledge Bestows Humility)"}'::jsonb, 1, 'published', $2, now())
     ON CONFLICT (school_id, config_key, version) DO NOTHING`,
    [schoolId, demoUsers.admin!],
  );

  /* ------------------- 13. Parent & Student Portal Data (Aarav & Anaya) ----- */
  console.log('  Seeding Timetable, Period Attendance (Classes 6-12) & Portal records...');
  if (aaravInfo) {
    const aaravStudentId = aaravInfo.studentId;
    const aaravEnrollId = aaravInfo.enrollmentId;
    const sec6AId = aaravInfo.sectionId;

    // 13.1 Timetable Periods (8 Periods + 2 Breaks)
    const periodSpecs = [
      { seq: 1, name: 'Period 1', start: '08:30:00', end: '09:15:00', isBreak: false },
      { seq: 2, name: 'Period 2', start: '09:15:00', end: '10:00:00', isBreak: false },
      { seq: 3, name: 'Period 3', start: '10:00:00', end: '10:45:00', isBreak: false },
      { seq: 4, name: 'Morning Break', start: '10:45:00', end: '11:00:00', isBreak: true },
      { seq: 5, name: 'Period 4', start: '11:00:00', end: '11:45:00', isBreak: false },
      { seq: 6, name: 'Period 5', start: '11:45:00', end: '12:30:00', isBreak: false },
      { seq: 7, name: 'Lunch Break', start: '12:30:00', end: '13:15:00', isBreak: true },
      { seq: 8, name: 'Period 6', start: '13:15:00', end: '14:00:00', isBreak: false },
      { seq: 9, name: 'Period 7', start: '14:00:00', end: '14:45:00', isBreak: false },
      { seq: 10, name: 'Period 8', start: '14:45:00', end: '15:30:00', isBreak: false },
    ];

    const periodMap = new Map<number, string>();
    for (const ps of periodSpecs) {
      const { rows: pRows } = await client.query<{ id: string }>(
        `INSERT INTO timetable_periods
           (school_id, academic_year_id, name, sequence_no, starts_at, ends_at, is_break)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (academic_year_id, sequence_no) DO UPDATE
           SET name = EXCLUDED.name, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, is_break = EXCLUDED.is_break
         RETURNING id`,
        [schoolId, activeYearId, ps.name, ps.seq, ps.start, ps.end, ps.isBreak],
      );
      periodMap.set(ps.seq, pRows[0]!.id);
    }

    // Room 201 for Class 6-A
    const { rows: rmRows } = await client.query<{ id: string }>(
      `INSERT INTO rooms (school_id, code, name, capacity)
       VALUES ($1, 'ROOM-201', 'Classroom 6-A (Main Block)', 45)
       ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [schoolId],
    );
    const room6AId = rmRows[0]!.id;

    // 13.2 Timetable Slots for Class 6-A
    const slotMapping = [
      { seq: 1, subCode: 'ENG', teacherEmp: 'EMP1034' },
      { seq: 2, subCode: 'MAT', teacherEmp: 'EMP1048' },
      { seq: 3, subCode: 'SCI', teacherEmp: 'EMP1066' },
      { seq: 5, subCode: 'SST', teacherEmp: 'EMP1075' },
      { seq: 6, subCode: 'HIN', teacherEmp: 'EMP1102' },
      { seq: 8, subCode: 'CS', teacherEmp: 'EMP1121' },
      { seq: 9, subCode: 'PE', teacherEmp: 'EMP1034' },
      { seq: 10, subCode: 'ART', teacherEmp: 'EMP1048' },
    ];

    let sstSlotId = '';
    for (let dow = 1; dow <= 5; dow++) {
      for (const sm of slotMapping) {
        const pId = periodMap.get(sm.seq)!;
        const subId = subjectIds.get(sm.subCode)!;
        const tUserId = teacherUserMap.get(sm.teacherEmp) || demoUsers.teacher!;

        const { rows: slotRows } = await client.query<{ id: string }>(
          `INSERT INTO timetable_slots
             (school_id, academic_year_id, section_id, period_id, day_of_week, subject_id, teacher_user_id, room_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (section_id, day_of_week, period_id) DO UPDATE
             SET subject_id = EXCLUDED.subject_id, teacher_user_id = EXCLUDED.teacher_user_id, room_id = EXCLUDED.room_id
           RETURNING id`,
          [schoolId, activeYearId, sec6AId, pId, dow, subId, tUserId, room6AId],
        );
        if (sm.subCode === 'SST' && dow === 5) {
          sstSlotId = slotRows[0]!.id;
        }
      }
    }

    // 13.3 Timetable Substitution
    if (sstSlotId && teacherUserMap.get('EMP1075') && teacherUserMap.get('EMP1121')) {
      await client.query(
        `INSERT INTO timetable_substitutions
           (school_id, slot_id, substitution_date, original_teacher_user_id, substitute_teacher_user_id, assigned_by_user_id, reason, status)
         VALUES ($1, $2, '2026-10-30', $3, $4, $5, 'Attending CBSE Regional Curriculum Workshop', 'active')
         ON CONFLICT (slot_id, substitution_date) DO UPDATE
           SET substitute_teacher_user_id = EXCLUDED.substitute_teacher_user_id,
               status = 'active', reason = EXCLUDED.reason`,
        [
          schoolId,
          sstSlotId,
          teacherUserMap.get('EMP1075')!,
          teacherUserMap.get('EMP1121')!,
          demoUsers.coordinator!,
        ],
      );
    }

    // 13.4 Aarav's Attendance: 96 days matching PDF (77 present, 19 absent -> 80%)
    const attendanceDates: string[] = [];
    const { rows: dateRows } = await client.query<{ today: string }>(
      `SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM schools WHERE id = $1`,
      [schoolId],
    );
    const todayIso = dateRows[0]!.today;
    attendanceDates.push(todayIso);

    const curr = new Date(todayIso);
    curr.setUTCDate(curr.getUTCDate() - 1);
    while (attendanceDates.length < 96) {
      const dow = curr.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        attendanceDates.unshift(curr.toISOString().slice(0, 10));
      }
      curr.setUTCDate(curr.getUTCDate() - 1);
    }

    for (let idx = 0; idx < attendanceDates.length; idx++) {
      const aDate = attendanceDates[idx]!;
      const isAbsent = idx % 5 === 0 && idx < 95;
      const attStatus = isAbsent ? 'absent' : 'present';
      await client.query(
        `INSERT INTO student_attendance
           (school_id, student_id, enrollment_id, attendance_date, status, recorded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (enrollment_id, attendance_date) DO UPDATE
           SET status = EXCLUDED.status, created_at = EXCLUDED.created_at`,
        [schoolId, aaravStudentId, aaravEnrollId, aDate, attStatus, demoUsers.teacher!, `${aDate} 08:05:00`],
      );
    }

    // 13.5 Period-wise Attendance for Today across 8 periods
    for (const sm of slotMapping) {
      const pId = periodMap.get(sm.seq)!;
      const subId = subjectIds.get(sm.subCode)!;
      const origTeacher = teacherUserMap.get(sm.teacherEmp) || demoUsers.teacher!;
      const isSubst = sm.subCode === 'SST';
      const substTeacher = isSubst ? teacherUserMap.get('EMP1121') : null;

      await client.query(
        `INSERT INTO student_period_attendance
           (school_id, student_id, enrollment_id, section_id, period_id, subject_id,
            attendance_date, status, teacher_user_id, substitute_teacher_user_id, marked_by_user_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-10-30', 'present', $7, $8, $9, $10)
         ON CONFLICT (enrollment_id, attendance_date, period_id) DO UPDATE
           SET status = 'present', substitute_teacher_user_id = EXCLUDED.substitute_teacher_user_id`,
        [
          schoolId,
          aaravStudentId,
          aaravEnrollId,
          sec6AId,
          pId,
          subId,
          origTeacher,
          substTeacher,
          origTeacher,
          isSubst ? 'Substitute lesson conducted by Ms. Ritu Saxena' : null,
        ],
      );
    }

    // 13.6 Transport Allocation (Route 2 Bus 07, Community Gate)
    const rt2Res = await client.query<{ id: string }>(
      `SELECT id FROM transport_routes WHERE school_id = $1 AND code = 'RT-02' LIMIT 1`,
      [schoolId],
    );
    if (rt2Res.rows[0]) {
      const r2Id = rt2Res.rows[0].id;
      const { rows: stpRows } = await client.query<{ id: string }>(
        `INSERT INTO transport_stops (school_id, route_id, name, sequence_no, scheduled_pickup, scheduled_drop)
         VALUES ($1, $2, 'Community Gate', 3, '07:15', '14:45')
         ON CONFLICT (school_id, route_id, sequence_no) WHERE retired_at IS NULL DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [schoolId, r2Id],
      );
      const commStopId = stpRows[0]!.id;

      await client.query(
        `INSERT INTO student_transport_allocations
           (school_id, student_id, route_id, stop_id, effective_from, status, created_by)
         VALUES ($1, $2, $3, $4, '2026-04-01', 'active', $5)
         ON CONFLICT (school_id, student_id, effective_from) DO UPDATE
           SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id, status = 'active'`,
        [schoolId, aaravStudentId, r2Id, commStopId, demoUsers.admin!],
      );
    }

    // 13.7 Aarav's Fee Charges, Payment Receipts & Offline Acknowledgment
    const tuitionHeadId = feeHeadIds.get('TUITION')!;
    const transportHeadId = feeHeadIds.get('TRANSPORT')!;

    await client.query(
      `INSERT INTO student_charges
         (school_id, student_id, academic_year_id, fee_head_id, description, amount, due_on, created_by)
       VALUES
         ($1, $2, $3, $4, 'Quarter 3 Tuition Fee', 5000.00, '2026-11-10', $5),
         ($1, $2, $3, $6, 'Quarter 3 Bus Conveyance Fee', 1500.00, '2026-11-10', $5)
       ON CONFLICT (student_id, academic_year_id, fee_head_id) DO UPDATE SET amount = EXCLUDED.amount`,
      [schoolId, aaravStudentId, activeYearId, tuitionHeadId, demoUsers.finance!, transportHeadId],
    );

    await client.query(
      `INSERT INTO payments
         (school_id, student_id, academic_year_id, amount, method, reference, receipt_number, paid_on, recorded_by)
       VALUES ($1, $2, $3, 6500.00, 'upi', 'TXN-UPI-20261005-9988', 'RCPT-2026-001', '2026-10-05', $4)
       ON CONFLICT (school_id, receipt_number) DO NOTHING`,
      [schoolId, aaravStudentId, activeYearId, demoUsers.finance!],
    );

    await client.query(
      `INSERT INTO fee_offline_payment_acknowledgements
         (school_id, student_id, amount, payment_method, reference_number, payment_date, bank_name, status, notes)
       VALUES ($1, $2, 2000.00, 'bank_transfer', 'NEFT-AXIS-20260905', '2026-09-05', 'Axis Bank', 'pending', 'Advance sports kit deposit')
       ON CONFLICT DO NOTHING`,
      [schoolId, aaravStudentId],
    );

    if (anayaInfo) {
      await client.query(
        `INSERT INTO student_charges
           (school_id, student_id, academic_year_id, fee_head_id, description, amount, due_on, created_by)
         VALUES ($1, $2, $3, $4, 'Quarter 3 Tuition Fee', 3500.00, '2026-11-10', $5)
         ON CONFLICT (student_id, academic_year_id, fee_head_id) DO UPDATE SET amount = EXCLUDED.amount`,
        [schoolId, anayaInfo.studentId, activeYearId, tuitionHeadId, demoUsers.finance!],
      );
    }

    // 13.8 Student Leave Requests
    await client.query(
      `INSERT INTO student_leave_requests
         (school_id, student_id, guardian_id, starts_on, ends_on, reason_category, reason_text, status)
       VALUES ($1, $2, $3, '2026-11-02', '2026-11-03', 'medical', 'Doctor advised rest due to seasonal viral fever and throat infection', 'pending')
       ON CONFLICT DO NOTHING`,
      [schoolId, aaravStudentId, parentGuardianId],
    );

    // 13.9 Authorised Pickup Persons
    await client.query(
      `INSERT INTO student_pickup_authorisations
         (school_id, student_id, guardian_id, authorised_person_name, relationship, phone, id_proof_type, id_proof_number, emergency_only, status)
       VALUES
         ($1, $2, $3, 'Rajesh Sharma', 'Father', $4, 'Aadhaar', 'XXXX-XXXX-8921', false, 'approved'),
         ($1, $2, $3, 'Suman Sharma', 'Grandmother', $5, 'Aadhaar', 'XXXX-XXXX-4512', true, 'approved')
       ON CONFLICT DO NOTHING`,
        [schoolId, aaravStudentId, parentGuardianId, livePasswords ? '0000000000' : '+91 98765 40002', livePasswords ? '0000000000' : '+91 98765 40003'],
    );

    // 13.10 Student Document Consents
    await client.query(
      `INSERT INTO student_document_consents
         (school_id, student_id, guardian_id, academic_year_id, document_type, title, description, status, submitted_at)
       VALUES
         ($1, $2, $3, $4, 'annual_consent', 'Annual Consent & Code of Conduct Form', 'Annual declaration for student rules and digital device policy', 'submitted', now()),
         ($1, $2, $3, $4, 'trip_consent', 'Educational Trip to Science City Consent', 'Parental approval for full-day bus excursion to Regional Science City', 'pending', null),
         ($1, $2, $3, $4, 'medical_info', 'Medical & Emergency Health Record', 'Confidential emergency health records, allergies and medication history', 'submitted', now()),
         ($1, $2, $3, $4, 'transport_consent', 'School Bus & Safety Guidelines Consent', 'School transport guidelines and seatbelt safety agreement', 'submitted', now())
       ON CONFLICT DO NOTHING`,
      [schoolId, aaravStudentId, parentGuardianId, activeYearId],
    );

    // 13.11 Direct Parent Messages
    await client.query(
      `INSERT INTO parent_student_messages
         (school_id, student_id, sender_user_id, sender_role, sender_name, category, title, content, is_read, created_at)
       VALUES
         ($1, $2, $3, 'teacher', 'Ms. Anjali (Class Teacher)', 'teacher_note', 'Class Participation', 'Aarav participated well in today''s class discussion on the Water Cycle. Keep it up!', false, now() - INTERVAL '2 hours'),
         ($1, $2, $4, 'admin', 'Asterleaf Administration', 'ptm_reminder', 'PTM Reminder', 'Parent-Teacher Meeting on 14 Nov 2026 (09:00 AM - 12:00 PM). Please confirm your slot.', true, now() - INTERVAL '1 day')
       ON CONFLICT DO NOTHING`,
      [schoolId, aaravStudentId, teacherUserMap.get('EMP1075') || demoUsers.teacher!, demoUsers.admin!],
    );

    // 13.12 Transport Alert Preferences
    await client.query(
      `INSERT INTO student_transport_alert_preferences
         (school_id, student_id, guardian_id, bus_approaching, boarding, drop_off, delays)
       VALUES ($1, $2, $3, true, true, true, true)
       ON CONFLICT (school_id, student_id, guardian_id) DO UPDATE
         SET bus_approaching = true, boarding = true, drop_off = true, delays = true`,
      [schoolId, aaravStudentId, parentGuardianId],
    );

    // 13.13 Homework Assignments
    const engSubId = subjectIds.get('ENG')!;
    const matSubId = subjectIds.get('MAT')!;
    await client.query(
      `INSERT INTO homework_assignments
         (school_id, academic_year_id, section_id, subject_id, title, instructions, due_at, status, published_at, created_by)
       VALUES
         ($1, $2, $3, $4, 'English: Read one short story', 'Read Chapter 4 (The Water Cycle) and complete questions 1-5', now() + INTERVAL '1 day', 'published', now(), $5),
         ($1, $2, $3, $6, 'Maths: Practise addition & algebraic expressions', 'Complete exercise 4.2 questions 1-5 on page 58', now() + INTERVAL '1 day', 'published', now(), $7)
       ON CONFLICT DO NOTHING`,
      [
        schoolId,
        activeYearId,
        sec6AId,
        engSubId,
        teacherUserMap.get('EMP1034') || demoUsers.teacher!,
        matSubId,
        teacherUserMap.get('EMP1048') || demoUsers.teacher!,
      ],
    );

    // 13.14 Learning Corner Resources
    await client.query(
      `INSERT INTO learning_resources
         (school_id, subject_id, title, resource_type, description, status, created_by)
       VALUES
         ($1, $2, 'The Water Cycle & Evaporation', 'video', 'Illustrated science video explaining precipitation, condensation and evaporation cycles', 'published', $5),
         ($1, $3, 'Speed Maths & Multiplication Tricks', 'document', 'Practice worksheet with mental arithmetic speed techniques and 10 quiz questions', 'published', $5),
         ($1, $4, 'Panchatantra: The Lion and the Mouse', 'document', 'Audio story with moral reasoning and reading comprehension questions', 'published', $5)
       ON CONFLICT DO NOTHING`,
      [schoolId, subjectIds.get('SCI')!, matSubId, engSubId, demoUsers.admin!],
    );

    // 13.15 Event Notices
    await client.query(
      `INSERT INTO notices
         (school_id, title, body, audience, status, published_at, created_by)
       VALUES
         ($1, 'PTM (Nursery - XII)', 'Parent-Teacher Meeting across all grades from 09:00 AM to 12:00 PM.', 'all', 'published', '2026-11-14 09:00:00', $2),
         ($1, 'CBSE Science Exhibition', 'Annual inter-school science and innovation showcase.', 'all', 'published', '2026-11-21 10:00:00', $2),
         ($1, 'Annual Sports Day Meet', 'Track and field events, inter-house relays and drill performances.', 'all', 'published', '2026-12-05 08:30:00', $2),
         ($1, 'Winter Vacation Begins', 'School remains closed for winter break. Classes resume in January.', 'all', 'published', '2026-12-17 00:00:00', $2)
       ON CONFLICT DO NOTHING`,
      [schoolId, demoUsers.admin!],
    );
  }

  // =========================================================================
  // 14. STAFF GEOFENCING, FACE BIOMETRICS & KIOSK ATTENDANCE (0033)
  // =========================================================================
    console.log('📍 Seeding Staff Geofences, Biometrics, Entrance Kiosks & Telemetry...');

    // 14.1 Active Geofences
    const geofenceSpecs = [
      {
        name: 'Main Academic Block',
        locationType: 'campus',
        latitude: 26.853245,
        longitude: 80.946123,
        radiusMeters: 150,
        maxAccuracy: 50,
        notes: 'Covers Academic Wing A & B, Admin Building, Primary Wing and Central Quadrangle',
      },
      {
        name: 'Junior School & Sports Complex',
        locationType: 'sports_ground',
        latitude: 26.855000,
        longitude: 80.948000,
        radiusMeters: 180,
        maxAccuracy: 60,
        notes: 'Covers Junior Wing, Football Turf, Swimming Complex and Athletic Pavilion',
      },
      {
        name: 'Transport Depot & Workshop',
        locationType: 'transport_depot',
        latitude: 26.851000,
        longitude: 80.943000,
        radiusMeters: 120,
        maxAccuracy: 40,
        notes: 'Dedicated bus fleet yard, fueling station, driver lounge and maintenance depot',
      },
      {
        name: 'Regional Science City (Offsite Excursion)',
        locationType: 'approved_offsite',
        latitude: 26.862500,
        longitude: 80.938000,
        radiusMeters: 250,
        maxAccuracy: 70,
        notes: 'Approved educational excursion venue for CBSE inter-school science exhibition',
      },
    ];

    const geofenceIdMap = new Map<string, string>();
    for (const gf of geofenceSpecs) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO school_geofences
           (school_id, name, location_type, latitude, longitude, radius_meters, max_accuracy_threshold_meters, is_active, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
         ON CONFLICT (school_id, name) DO UPDATE
           SET latitude = EXCLUDED.latitude,
               longitude = EXCLUDED.longitude,
               radius_meters = EXCLUDED.radius_meters,
               max_accuracy_threshold_meters = EXCLUDED.max_accuracy_threshold_meters,
               is_active = true
         RETURNING id`,
        [schoolId, gf.name, gf.locationType, gf.latitude, gf.longitude, gf.radiusMeters, gf.maxAccuracy, gf.notes],
      );
      geofenceIdMap.set(gf.name, rows[0]!.id);
    }

    // Helper for synthetic biometric template vector and AES-256 encryption
    function createSeedBiometricTemplate(seed: string): { templateHash: string; encryptedData: string } {
      const hash = crypto.createHash('sha256').update(seed).digest('hex');
      const vector: number[] = [];
      for (let i = 0; i < 128; i++) {
        const byte = parseInt(hash.slice((i * 2) % 64, ((i * 2) % 64) + 2), 16) || 0;
        vector.push((byte / 255.0) * 2.0 - 1.0);
      }
      let norm = 0;
      for (const v of vector) norm += v * v;
      norm = Math.sqrt(norm);
      const normalized = vector.map((v) => (norm > 0 ? v / norm : 0));
      const jsonStr = JSON.stringify(normalized);

      const configuredKey=process.env.BIOMETRIC_ENCRYPTION_KEY;
      if(!configuredKey||!/^[a-f0-9]{64}$/i.test(configuredKey))throw new Error('Configure BIOMETRIC_ENCRYPTION_KEY before seeding synthetic face templates');
      const key = Buffer.from(configuredKey, 'hex');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag().toString('hex');
      const encryptedData = `${iv.toString('hex')}:${tag}:${encrypted}`;
      return { templateHash: hash, encryptedData };
    }

    // 14.2 Enrolled Staff Biometrics (DPDPA 2023 Consent & Encrypted Embeddings)
    const staffRows = await client.query<{ id: string; employee_number: string; user_id: string }>(
      `SELECT id, employee_number, user_id FROM staff WHERE school_id = $1 AND employee_number IN ('EMP-0001', 'EMP-0003', 'EMP-0004', 'EMP-0005', 'EMP-0006')`,
      [schoolId],
    );
    const staffByEmp = new Map(staffRows.rows.map((r) => [r.employee_number, r]));

    const enrolledStaffKeys = livePasswords ? [] : ['EMP-0001', 'EMP-0003', 'EMP-0004', 'EMP-0005', 'EMP-0006'];
    for (const empNo of enrolledStaffKeys) {
      const st = staffByEmp.get(empNo);
      if (!st) continue;
      const { templateHash, encryptedData } = createSeedBiometricTemplate(`STAFF_FACE_${empNo}_${schoolId}`);
      await client.query(
        `INSERT INTO staff_biometric_profiles
           (school_id, staff_id, consent_given, consent_version, consent_given_at, enrolment_status, enrolled_at, enrolled_by, template_data_encrypted, template_hash, quality_score)
         VALUES
           ($1, $2, true, 'v1.0-dpdpa', now() - INTERVAL '30 days', 'enrolled', now() - INTERVAL '30 days', $3, $4, $5, 96.50)
         ON CONFLICT (school_id, staff_id) DO UPDATE
           SET consent_given = true,
               enrolment_status = 'enrolled',
               template_data_encrypted = EXCLUDED.template_data_encrypted,
               template_hash = EXCLUDED.template_hash,
               quality_score = EXCLUDED.quality_score`,
        [schoolId, st.id, demoUsers.admin!, encryptedData, templateHash],
      );
    }

    // 14.3 Dedicated Entrance Kiosks
    const mainCampusGfId = geofenceIdMap.get('Main Academic Block');
    const kioskSpecs = [
      {
        code: 'KIOSK-GATE-01',
        name: 'North Gate Main Entrance Kiosk',
        geofenceId: mainCampusGfId,
        appVersion: 'v2.4.0',
        ipAddress: '192.168.1.101',
      },
      {
        code: 'KIOSK-STAFF-ROOM',
        name: 'Senior Faculty Room Entry Tablet',
        geofenceId: mainCampusGfId,
        appVersion: 'v2.4.0',
        ipAddress: '192.168.1.102',
      },
    ];

    const kioskIdMap = new Map<string, string>();
    for (const ks of kioskSpecs) {
      const key = livePasswords ? crypto.randomBytes(32).toString('base64url') : `SECRET_${ks.code}`;
      const keyHash = crypto.createHash('sha256').update(key).digest('hex');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO attendance_kiosks
           (school_id, device_code, device_name, geofence_id, api_key_hash, status, last_heartbeat_at, app_version, ip_address)
         VALUES ($1, $2, $3, $4, $5, 'active', now(), $6, $7)
         ON CONFLICT (school_id, device_code) DO UPDATE
           SET device_name = EXCLUDED.device_name,
               status = 'active',
               last_heartbeat_at = now()
         RETURNING id`,
        [schoolId, ks.code, ks.name, ks.geofenceId, keyHash, ks.appVersion, ks.ipAddress],
      );
      kioskIdMap.set(ks.code, rows[0]!.id);
    }

    // 14.4 Punch Events Telemetry
    const snehaStaff = staffByEmp.get('EMP-0003');
    const gurpreetStaff = staffByEmp.get('EMP-0006');
    const vikramStaff = staffByEmp.get('EMP-0004');

    if (snehaStaff) {
      // Sneha verified punch-in today
      const { rows: pinRows } = await client.query<{ id: string }>(
        `INSERT INTO staff_punch_events
           (school_id, staff_id, work_date, punch_type, punched_at, verification_status,
            latitude, longitude, accuracy_meters, distance_meters, geofence_id, geofence_verified,
            liveness_score, liveness_verified, match_confidence, face_matched, device_source)
         VALUES
           ($1, $2, CURRENT_DATE, 'punch_in', CURRENT_DATE + TIME '07:55:00', 'verified',
            26.853250, 80.946130, 8.5, 12.0, $3, true,
            97.5, true, 96.2, true, 'employee_mobile')
         RETURNING id`,
        [schoolId, snehaStaff.id, mainCampusGfId],
      );

      // Sneha verified punch-out today linked to punch-in
      await client.query(
        `INSERT INTO staff_punch_events
           (school_id, staff_id, work_date, punch_type, punched_at, verification_status,
            latitude, longitude, accuracy_meters, distance_meters, geofence_id, geofence_verified,
            liveness_score, liveness_verified, match_confidence, face_matched, device_source, linked_punch_in_id)
         VALUES
           ($1, $2, CURRENT_DATE, 'punch_out', CURRENT_DATE + TIME '15:35:00', 'verified',
            26.853240, 80.946120, 6.2, 9.5, $3, true,
            96.8, true, 95.4, true, 'employee_mobile', $4)`,
        [schoolId, snehaStaff.id, mainCampusGfId, pinRows[0]?.id || null],
      );

      // Update staff_attendance operational record for Sneha today
      await client.query(
        `INSERT INTO staff_attendance
           (school_id, staff_id, work_date, status, punch_in, punch_out, recorded_by)
         VALUES
           ($1, $2, CURRENT_DATE, 'present', CURRENT_DATE + TIME '07:55:00', CURRENT_DATE + TIME '15:35:00', $3)
         ON CONFLICT (school_id, staff_id, work_date) DO UPDATE
           SET status = 'present',
               punch_in = EXCLUDED.punch_in,
               punch_out = EXCLUDED.punch_out`,
        [schoolId, snehaStaff.id, demoUsers.admin!],
      );

      // Sneha rejected out-of-geofence punch attempt from home
      await client.query(
        `INSERT INTO staff_punch_events
           (school_id, staff_id, work_date, punch_type, punched_at, verification_status,
            latitude, longitude, accuracy_meters, distance_meters, geofence_id, geofence_verified,
            failure_reason, device_source)
         VALUES
           ($1, $2, CURRENT_DATE - INTERVAL '1 day', 'punch_in', CURRENT_DATE - INTERVAL '1 day' + TIME '07:15:00', 'out_of_geofence',
            26.845000, 80.932000, 15.0, 840.0, NULL, false,
            'Location is outside authorised school geofence boundaries (840m from nearest campus)', 'employee_mobile')`,
        [schoolId, snehaStaff.id],
      );
    }

    if (gurpreetStaff) {
      // Gurpreet verified kiosk punch-in at transport depot
      const depotGfId = geofenceIdMap.get('Transport Depot & Workshop');
      await client.query(
        `INSERT INTO staff_punch_events
           (school_id, staff_id, work_date, punch_type, punched_at, verification_status,
            latitude, longitude, accuracy_meters, distance_meters, geofence_id, geofence_verified,
            liveness_score, liveness_verified, match_confidence, face_matched, device_source, kiosk_id)
         VALUES
           ($1, $2, CURRENT_DATE, 'punch_in', CURRENT_DATE + TIME '06:45:00', 'verified',
            26.851010, 80.943010, 5.0, 6.5, $3, true,
            98.5, true, 97.0, true, 'kiosk', $4)`,
        [schoolId, gurpreetStaff.id, depotGfId, kioskIdMap.get('KIOSK-GATE-01')],
      );
    }

    if (vikramStaff) {
      // Vikram rejected poor GPS accuracy attempt
      await client.query(
        `INSERT INTO staff_punch_events
           (school_id, staff_id, work_date, punch_type, punched_at, verification_status,
            latitude, longitude, accuracy_meters, distance_meters, geofence_id, geofence_verified,
            failure_reason, device_source)
         VALUES
           ($1, $2, CURRENT_DATE, 'punch_in', CURRENT_DATE + TIME '08:05:00', 'poor_accuracy',
            26.853200, 80.946100, 140.0, 20.0, $3, false,
            'GPS accuracy threshold exceeded (140m reported, maximum allowed is 50m)', 'employee_mobile')`,
        [schoolId, vikramStaff.id, mainCampusGfId],
      );
    }

    // 14.5 Staff Attendance Exceptions (Manual Requests & Segregated Review)
    if (snehaStaff) {
      // Approved exception for offsite duty at Regional Science City
      await client.query(
        `INSERT INTO staff_attendance_exceptions
           (school_id, staff_id, work_date, exception_type, requested_punch_in, requested_punch_out,
            reason, supporting_document_name, status, requested_by, requested_at, reviewed_by, reviewed_at, review_notes)
         VALUES
           ($1, $2, CURRENT_DATE - INTERVAL '2 days', 'approved_offsite_duty',
            CURRENT_DATE - INTERVAL '2 days' + TIME '08:00:00', CURRENT_DATE - INTERVAL '2 days' + TIME '16:00:00',
            'Supervising Class 9 & 10 students at CBSE State Science Exhibition at Regional Science City venue',
            'CBSE_Science_Exhibition_Duty_Deputation_Order.pdf', 'approved',
            $3, CURRENT_DATE - INTERVAL '3 days' + TIME '14:00:00',
            $4, CURRENT_DATE - INTERVAL '3 days' + TIME '17:30:00',
            'Approved by Principal. Official CBSE deputation order verified.')
         ON CONFLICT DO NOTHING`,
        [schoolId, snehaStaff.id, demoUsers.teacher!, demoUsers.admin!],
      );
    }

    if (vikramStaff) {
      // Pending exception for GPS sensor failure
      await client.query(
        `INSERT INTO staff_attendance_exceptions
           (school_id, staff_id, work_date, exception_type, requested_punch_in, requested_punch_out,
            reason, status, requested_by, requested_at)
         VALUES
           ($1, $2, CURRENT_DATE, 'gps_failure',
            CURRENT_DATE + TIME '08:05:00', NULL,
            'Device GPS hardware failure due to heavy rain shielding at North Turnstile Gate. Present on campus in Accounts office.',
            'pending', $3, CURRENT_DATE + TIME '08:15:00')
         ON CONFLICT DO NOTHING`,
        [schoolId, vikramStaff.id, demoUsers.finance!],
      );
    }

    /* ------------------- 15. Facilities & Maintenance (Module 21) ------------- */
    console.log('  Seeding facilities & maintenance tickets...');
    const facilitiesData = [
      { code: 'FAC-AUD-01', name: 'Rabindranath Tagore Auditorium', cat: 'auditorium', loc: 'Main Block Ground Floor', cap: 600, notes: 'Acoustic treatment, high-output AV projector system' },
      { code: 'FAC-LAB-PHY', name: 'C.V. Raman Physics Laboratory', cat: 'laboratory', loc: 'Science Block 2nd Floor', cap: 45, notes: 'Optical benches, dark room annex, digital multimeter stations' },
      { code: 'FAC-LAB-CHEM', name: 'P.C. Ray Chemistry Laboratory', cat: 'laboratory', loc: 'Science Block 2nd Floor', cap: 45, notes: 'Fume hoods, acid-resistant tiling, emergency eyewash stations' },
      { code: 'FAC-LAB-COMP', name: 'Alan Turing Computer Lab 1', cat: 'laboratory', loc: 'Tech Wing 1st Floor', cap: 50, notes: 'Gigabit LAN, dual-boot Linux/Windows workstations' },
      { code: 'FAC-LIB-01', name: 'Saraswati Central Library', cat: 'library', loc: 'Academic Block 1st Floor', cap: 120, notes: 'RFID gates, quiet study cubicles, digital OPAC kiosks' },
      { code: 'FAC-SPORTS-01', name: 'Major Dhyan Chand Sports Complex', cat: 'sports_ground', loc: 'West Campus Athletic Field', cap: 500, notes: 'Standard synthetic athletics track, football pitch, cricket nets' },
    ];

    const facilityIdMap = new Map<string, string>();
    for (const f of facilitiesData) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO school_facilities (school_id, code, name, category, block_location, capacity, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'operational', $7)
         ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, notes = EXCLUDED.notes
         RETURNING id`,
        [schoolId, f.code, f.name, f.cat, f.loc, f.cap, f.notes],
      );
      facilityIdMap.set(f.code, rows[0]!.id);
    }

    // Maintenance Tickets
    const audFacId = facilityIdMap.get('FAC-AUD-01')!;
    const chemFacId = facilityIdMap.get('FAC-LAB-CHEM')!;
    const compFacId = facilityIdMap.get('FAC-LAB-COMP')!;
    const snehaStaffMember = staffByEmp.get('EMP-0003');

    await client.query(
      `INSERT INTO facility_maintenance_tickets
         (school_id, facility_id, ticket_number, category, priority, description, reported_by, assigned_to, status, estimated_cost, actual_cost, resolution_notes)
       VALUES
         ($1, $2, 'TKT-2026-001', 'hvac', 'high', 'Stage AC unit compressor tripping intermittently during morning assembly', $5, $6, 'in_progress', 15000, 0, 'HVAC contractor scheduled for coil replacement'),
         ($1, $3, 'TKT-2026-002', 'plumbing', 'urgent', 'Bunsen burner main gas line pressure regulator inspection required before board practicals', $5, $6, 'reported', 8500, 0, null),
         ($1, $4, 'TKT-2026-003', 'it_hardware', 'medium', 'Ceiling-mounted Epson projector lamp replacement required in Turing Lab 1', $5, $6, 'resolved', 6200, 5800, 'Replaced projector lamp with OEM unit. Tested 1080p display output.')
       ON CONFLICT (school_id, ticket_number) DO NOTHING`,
      [schoolId, audFacId, chemFacId, compFacId, demoUsers.admin!, snehaStaffMember ? snehaStaffMember.id : null],
    );

    /* ------------------- 16. PTM Appointments (Module 23) -------------------- */
    console.log('  Seeding PTM slots and confirmed bookings...');
    const ptmTeacher = snehaStaffMember?.id;
    let ptmSlotsCount = 0;
    if (ptmTeacher && aaravInfo) {
      const { rows: slotRows } = await client.query<{ id: string }>(
        `INSERT INTO ptm_slots
           (school_id, academic_year_id, teacher_id, title, event_date, start_time, end_time, room_location, max_parents, status)
         VALUES
           ($1, $2, $3, 'Term 1 Mid-Term Parent Teacher Conference (Class 6-A)', '2026-10-15', '09:00', '13:00', 'Room 201 (Classroom 6-A)', 1, 'available'),
           ($1, $2, $3, 'Special Academic Consultation Slot', '2026-10-16', '14:30', '16:00', 'Senior Faculty Room', 1, 'available')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [schoolId, activeYearId, ptmTeacher],
      );
      ptmSlotsCount = slotRows.length || 2;

      // Booking for Aarav Sharma & Priya Sharma
      const ptmSlotId = slotRows[0]?.id;
      if (ptmSlotId) {
        await client.query(
          `INSERT INTO ptm_bookings
             (school_id, slot_id, student_id, guardian_id, booking_notes, teacher_feedback, status)
           VALUES
             ($1, $2, $3, $4, 'Would like to review Aarav progress in Mathematics and Science practicals.', 'Aarav exhibits strong conceptual clarity and participates actively in class discussions.', 'confirmed')
           ON CONFLICT (slot_id, student_id) DO UPDATE SET booking_notes = EXCLUDED.booking_notes`,
          [schoolId, ptmSlotId, aaravInfo.studentId, parentGuardianId],
        );
      }
    }

    /* ------------------- 17. School Certificates (Module 24) ----------------- */
    console.log('  Seeding official school certificates (TC, Bonafide, Character)...');
    let certificatesCount = 0;
    if (aaravInfo && demoUsers.student) {
      const kabirStudent = allStudentIds.find((s) => s.grade === 10 && s.roll === 1);
      const student1 = allStudentIds[10]!;

      const certs = [
        {
          type: 'bonafide',
          num: 'BON/2026/00389',
          stId: aaravInfo.studentId,
          reason: 'Passport renewal and application for National Science Talent Search Exam',
          hash: crypto.createHash('sha256').update(`BON/2026/00389_${aaravInfo.studentId}`).digest('hex'),
          status: 'issued',
          meta: JSON.stringify({ issueAuthority: 'Principal Office', validForMonths: 6 }),
        },
        {
          type: 'character_certificate',
          num: 'CHR/2026/00091',
          stId: kabirStudent ? kabirStudent.id : student1.id,
          reason: 'Application for CBSE Inter-School National Debate and Youth Parliament',
          hash: crypto.createHash('sha256').update(`CHR/2026/00091_${student1.id}`).digest('hex'),
          status: 'issued',
          meta: JSON.stringify({ conduct: 'Exemplary', academicStanding: 'Distinction' }),
        },
        {
          type: 'transfer_certificate',
          num: 'TC/2026/00142',
          stId: student1.id,
          reason: 'Parent job transfer to Mumbai central headquarters',
          hash: crypto.createHash('sha256').update(`TC/2026/00142_${student1.id}`).digest('hex'),
          status: 'approved',
          meta: JSON.stringify({ duesCleared: true, feeReceiptNo: 'RCP-2026-9812', lastClassPassed: 'Class 1-A' }),
        },
      ];

      for (const c of certs) {
        await client.query(
          `INSERT INTO school_certificates
             (school_id, certificate_type, certificate_number, student_id, academic_year_id, issued_on, issued_reason, approved_by, approved_at, verification_hash, metadata, status)
           VALUES
             ($1, $2, $3, $4, $5, '2026-09-01', $6, $7, now(), $8, $9::jsonb, $10)
           ON CONFLICT (school_id, certificate_number) DO UPDATE SET verification_hash = EXCLUDED.verification_hash`,
          [schoolId, c.type, c.num, c.stId, activeYearId, c.reason, demoUsers.admin!, c.hash, c.meta, c.status],
        );
        certificatesCount++;
      }
    }

    /* ------------------- 18. Clubs & Alumni Directory (Module 29) ------------ */
    console.log('  Seeding school clubs, memberships and alumni records...');
    const clubsData = [
      { code: 'CLUB-ROBOTICS', name: 'Asterleaf Robotics & STEM Innovation Club', cat: 'robotics', venue: 'Alan Turing Computer Lab 1', sched: 'Wednesdays 15:30 - 17:00', desc: 'Hands-on IoT, Arduino sensors, VEX robotics, and AI automation models.' },
      { code: 'CLUB-HIN-LIT', name: 'Munshi Premchand Hindi Sahitya Sabha', cat: 'literary', venue: 'Saraswati Central Library', sched: 'Thursdays 15:30 - 17:00', desc: 'Promoting Hindi creative writing, poetry recitation, debate and drama.' },
      { code: 'CLUB-ECO', name: 'Dr. Kalam Eco & Environmental Crusaders Club', cat: 'environment', venue: 'Botanical Garden & Biology Lab', sched: 'Fridays 15:30 - 17:00', desc: 'Zero-waste campus initiatives, rainwater harvesting monitoring, tree plantations.' },
      { code: 'CLUB-MATH', name: 'Aryabhata Mathematics Olympiad Society', cat: 'stem', venue: 'Room 201', sched: 'Tuesdays 15:30 - 17:00', desc: 'Advanced problem-solving, Vedic math algorithms, RMO preparation.' },
    ];

    const clubIdMap = new Map<string, string>();
    for (const cl of clubsData) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO school_clubs
           (school_id, code, name, category, lead_teacher_id, description, venue, meeting_schedule, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
         RETURNING id`,
        [schoolId, cl.code, cl.name, cl.cat, snehaStaffMember ? snehaStaffMember.id : null, cl.desc, cl.venue, cl.sched],
      );
      clubIdMap.set(cl.code, rows[0]!.id);
    }

    // Memberships
    if (aaravInfo) {
      const robClubId = clubIdMap.get('CLUB-ROBOTICS');
      if (robClubId) {
        await client.query(
          `INSERT INTO club_memberships
             (school_id, club_id, student_id, academic_year_id, role, achievements, status)
           VALUES
             ($1, $2, $3, $4, 'member', 'Built line-follower robot with ultrasonic obstacle avoidance', 'active')
           ON CONFLICT (club_id, student_id, academic_year_id) DO NOTHING`,
          [schoolId, robClubId, aaravInfo.studentId, activeYearId],
        );
      }
    }

    const kabirStudent = allStudentIds.find((s) => s.grade === 10 && s.roll === 1);
    if (kabirStudent) {
      const mathClubId = clubIdMap.get('CLUB-MATH');
      if (mathClubId) {
        await client.query(
          `INSERT INTO club_memberships
             (school_id, club_id, student_id, academic_year_id, role, achievements, status)
           VALUES
             ($1, $2, $3, $4, 'captain', 'School Rank 1 in International Mathematics Olympiad (IMO) Round 1', 'active')
           ON CONFLICT (club_id, student_id, academic_year_id) DO NOTHING`,
          [schoolId, mathClubId, kabirStudent.id, activeYearId],
        );
      }
    }

    // Alumni Records
    const alumniStudents = allStudentIds.slice(20, 23);
    const alumniData = [
      { yr: 2022, stream: 'Science', eng: 'higher_education', org: 'Indian Institute of Technology (IIT) Delhi', course: 'B.Tech Computer Science & Engineering', email: 'rohan.kapoor@alumni.test', city: 'New Delhi', notes: 'JEE Advanced All India Rank 184.' },
      { yr: 2023, stream: 'Commerce', eng: 'higher_education', org: 'Shri Ram College of Commerce (SRCC)', course: 'B.Com (Honours)', email: 'ananya.iyer@alumni.test', city: 'Delhi', notes: 'School topper with 98.4% CBSE aggregate.' },
      { yr: 2021, stream: 'Science', eng: 'employed', org: 'Microsoft India R&D', course: 'Software Engineer II', email: 'siddharth.rao@alumni.test', city: 'Hyderabad', notes: 'Active mentor for Asterleaf Robotics Club.' },
    ];

    let alumniCount = 0;
    for (let i = 0; i < alumniData.length; i++) {
      const st = alumniStudents[i];
      const al = alumniData[i]!;
      if (st) {
        await client.query(
          `INSERT INTO alumni_records
             (school_id, student_id, passing_year, stream, current_engagement, institution_or_company, designation_or_course, contact_email, city, notes)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (school_id, student_id) DO UPDATE SET institution_or_company = EXCLUDED.institution_or_company, designation_or_course = EXCLUDED.designation_or_course`,
          [schoolId, st.id, al.yr, al.stream, al.eng, al.org, al.course, al.email, al.city, al.notes],
        );
        alumniCount++;
      }
    }

  console.log('✅ Rang-Biranga High-Scale CBSE Demo Seed Completed Successfully!');

  return {
    schoolId,
    studentsCount: allStudentIds.length,
    staffCount: staffIdsList.length,
    classesCount: classIds.size,
    sectionsCount: sectionIds.size,
    vehiclesCount: vehicleIds.length,
    transportAllocationsCount,
    libraryBooksCount,
    libraryCopiesCount,
    chargesCount,
    paymentsCount: 2,
    offlineQueueCount: 4,
    attendanceRecordsCount: termDates.length * 3 + 96,
    shortageCasesCount: 3,
    geofencesCount: geofenceSpecs.length,
    biometricProfilesCount: enrolledStaffKeys.length,
    kiosksCount: kioskSpecs.length,
    punchEventsCount: 5,
    attendanceExceptionsCount: 2,
    facilitiesCount: facilitiesData.length,
    maintenanceTicketsCount: 3,
    ptmSlotsCount,
    certificatesCount,
    clubsCount: clubsData.length,
    alumniCount,
    demoUsers: [
      { email: 'admin@demo.test', role: 'main_admin', label: 'Super Admin / Principal' },
      { email: 'coordinator@demo.test', role: 'academic_coordinator', label: 'Academic Coordinator' },
      { email: 'teacher@demo.test', role: 'teacher', label: 'Sneha Kulkarni (Class Teacher G1-A)' },
      { email: 'student@demo.test', role: 'student', label: 'Kabir Menon (Student Class 10-A)' },
      { email: 'aarav@demo.test', role: 'student', label: 'Aarav Sharma (Student Class 6-A)' },
      { email: 'parent@demo.test', role: 'parent', label: 'Priya Sharma (Parent of Aarav & Anaya)' },
      { email: 'finance@demo.test', role: 'finance', label: 'Vikram Rao (Finance Manager)' },
      { email: 'hr@demo.test', role: 'hr', label: 'Meenakshi Iyer (HR Manager)' },
      { email: 'transport@demo.test', role: 'transport', label: 'Gurpreet Singh (Fleet Manager)' },
      { email: 'librarian@demo.test', role: 'librarian', label: 'Shalini Verma (Chief Librarian)' },
      { email: 'auditor@demo.test', role: 'auditor', label: 'Farah Khan (Internal Auditor)' },
    ],
  };
}

if (process.argv[1] && process.argv[1].endsWith('demo-seed.ts')) {
  runHighScaleDemoSeed()
    .then((summary) => {
      console.log('\n======================================================');
      console.log('📊 RANG-BIRANGA DEMO SEED AUDIT & COVERAGE REPORT');
      console.log('======================================================');
      console.log(`School ID:                    ${summary.schoolId}`);
      console.log(`Classes (Nursery - XII):      ${summary.classesCount}`);
      console.log(`Sections (Stage-Wise):        ${summary.sectionsCount}`);
      console.log(`Total Students Enrolled:      ${summary.studentsCount}`);
      console.log(`Total Staff (Teaching & Ops): ${summary.staffCount}`);
      console.log(`Transport Fleet Vehicles:     ${summary.vehiclesCount}`);
      console.log(`Student Transport Allocs:     ${summary.transportAllocationsCount}`);
      console.log(`Library Books Titles:         ${summary.libraryBooksCount}`);
      console.log(`Library Physical Copies:      ${summary.libraryCopiesCount}`);
      console.log(`Attendance Shortage Cases:    ${summary.shortageCasesCount}`);
      console.log(`Offline Fee Queue Records:    ${summary.offlineQueueCount}`);
      console.log(`Active School Geofences:      ${summary.geofencesCount}`);
      console.log(`Enrolled Staff Biometrics:    ${summary.biometricProfilesCount}`);
      console.log(`Entrance Attendance Kiosks:   ${summary.kiosksCount}`);
      console.log(`Staff Punch Events Logged:    ${summary.punchEventsCount}`);
      console.log(`Staff Attendance Exceptions:  ${summary.attendanceExceptionsCount}`);
      console.log(`School Facilities Seeded:     ${summary.facilitiesCount}`);
      console.log(`Maintenance Tickets Logged:   ${summary.maintenanceTicketsCount}`);
      console.log(`PTM Slots Configured:         ${summary.ptmSlotsCount}`);
      console.log(`Official School Certificates: ${summary.certificatesCount}`);
      console.log(`Clubs & Student Societies:    ${summary.clubsCount}`);
      console.log(`Alumni Directory Records:     ${summary.alumniCount}`);
      console.log('------------------------------------------------------');
      console.log('🔑 DEMO LOGIN CREDENTIALS:');
      for (const u of summary.demoUsers) {
        console.log(`  - [${u.role.padEnd(20)}] ${u.email.padEnd(24)} (Pass: Admin@12345 / Coord@12345 / Teacher@12345 / Student@12345 / Parent@12345 / Finance@12345 / Staff@12345)`);
      }
      console.log('======================================================\n');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed execution failed:', err);
      process.exit(1);
    });
}
