import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoSeedSummary } from "@erp/db";

let app: FastifyInstance;
let pool: pg.Pool;
let stopDatabase: () => Promise<void>;
let schoolId: string;
let seedSummary: DemoSeedSummary;

const cookies = new Map<string, string>();

interface InjectOptions {
  cookie?: string;
  payload?: unknown;
  origin?: string;
  idempotencyKey?: string;
}

async function call(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  options: InjectOptions = {},
): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
  const response = await app.inject({
    method,
    url,
    payload: options.payload as never,
    headers: {
      origin: options.origin ?? "http://localhost:5173",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
  });
  let body: unknown = null;
  if (response.body) {
    try {
      body = JSON.parse(response.body);
    } catch {
      body = response.body;
    }
  }
  return { status: response.statusCode, body, headers: response.headers };
}

async function login(email: string, password = "Admin@12345"): Promise<string> {
  const cached = cookies.get(email);
  if (cached) return cached;
  const response = await call("POST", "/api/auth/login", {
    payload: { email, password },
  });
  expect(
    response.status,
    `login failed for ${email}: ${JSON.stringify(response.body)}`,
  ).toBe(200);
  const setCookie = response.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = String(raw).split(";")[0];
  expect(cookie).toMatch(/^erp_session=/);
  cookies.set(email, cookie!);
  return cookie!;
}

beforeAll(async () => {
  const { startTestDatabase } = await import("@erp/db/test-database");
  const database = await startTestDatabase();
  stopDatabase = database.stop;
  process.env.DATABASE_URL = database.url;
  process.env.NODE_ENV = "test";

  const { buildApp } = await import("../src/app");
  const { getPool } = await import("../src/db");
  pool = getPool();
  app = await buildApp();
  await app.ready();

  let client: any;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      client = await pool.connect();
      break;
    } catch (e) {
      if (attempt === 5) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  try {
    const { runHighScaleDemoSeed } = await import("@erp/db");
    seedSummary = await runHighScaleDemoSeed(client);
  } finally {
    client.release();
  }

  schoolId = seedSummary.schoolId;
});

afterAll(async () => {
  const { closePool } = await import("../src/db");
  await app?.close();
  await closePool();
  await stopDatabase?.();
});

/* -------------------------------------------------------------------------- */
/* 1. PARENT PORTAL: MULTI-CHILD SELECTOR & DASHBOARD SUMMARY                 */
/* -------------------------------------------------------------------------- */
describe("Parent Portal: Multi-Child Dashboard & Access Scoping", () => {
  let parentCookie: string;
  let aaravStudentId: string;
  let anayaStudentId: string;
  let unlinkedStudentId: string;

  beforeAll(async () => {
    parentCookie = await login("parent@demo.test", "Parent@12345");

    // Fetch parent linked children
    const childrenRes = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children`,
      { cookie: parentCookie },
    );
    expect(childrenRes.status).toBe(200);
    expect(Array.isArray(childrenRes.body.items)).toBe(true);
    expect(childrenRes.body.items.length).toBeGreaterThanOrEqual(2);

    const aarav = childrenRes.body.items.find(
      (c: any) => c.fullName?.includes("Aarav") || c.name?.includes("Aarav"),
    );
    const anaya = childrenRes.body.items.find(
      (c: any) => c.fullName?.includes("Anaya") || c.name?.includes("Anaya"),
    );

    expect(aarav, "Aarav must be linked to parent").toBeDefined();
    expect(anaya, "Anaya must be linked to parent").toBeDefined();

    aaravStudentId = aarav.studentId;
    anayaStudentId = anaya.studentId;

    // Pick a student from Class 10 who is NOT linked to Priya Sharma
    const unlinkedRes = await pool.query<{ id: string }>(
      `SELECT s.id FROM students s
       WHERE s.school_id = $1 AND s.id NOT IN ($2, $3)
       LIMIT 1`,
      [schoolId, aaravStudentId, anayaStudentId],
    );
    unlinkedStudentId = unlinkedRes.rows[0]!.id;
  });

  it("allows parent to view Aarav dashboard with attendance, fees, transport and homework", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/dashboard`,
      {
        cookie: parentCookie,
      },
    );
    expect(res.status).toBe(200);
    const d = res.body;

    // A. Child Details
    expect(d.child.studentId).toBe(aaravStudentId);
    expect(d.child.fullName).toContain("Aarav");
    expect(d.child.className).toBe("Class 6");
    expect(d.child.sectionName).toBe("Section A");
    expect(d.child.admissionNumber).toBe("24A015");

    // B. Attendance (80% rate)
    expect(d.attendance).toBeDefined();
    expect(typeof d.attendance.overallPercentage).toBe("number");
    expect(d.attendance.overallPercentage).toBe(80);

    // C. Homework
    expect(d.homework.pendingCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(d.homework.items)).toBe(true);

    // D. Fees & Payments
    const canonicalLedger = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/fees`,
      { cookie: parentCookie },
    );
    expect(canonicalLedger.status).toBe(200);
    expect(d.fees.totalDue).toBe(Math.max(0, canonicalLedger.body.balance));
    expect(
      Math.round(
        (d.fees.breakdown.tuition +
          d.fees.breakdown.transport +
          d.fees.breakdown.other) *
          100,
      ),
    ).toBe(Math.round(d.fees.totalDue * 100));
    expect(d.fees.recentPayments.length).toBeGreaterThanOrEqual(1);

    // E. Transport & Timeline
    expect(d.transport.assignedVehicle).toBe("UP 32 CZ 8901");
    expect(d.transport.routeNumber).toBe("Route 2");
    expect(d.transport.stopName).toBe("Community Gate");
    expect(d.transport.pickupTime).toBe("07:15");
    expect(d.transport.dropTime).toBe("14:45");
    expect(Array.isArray(d.transport.timeline)).toBe(true);

    // F. Direct Messages
    expect(d.messages.length).toBeGreaterThanOrEqual(1);
    expect(d.messages.some((m: any) => m.title === "Class Participation")).toBe(
      true,
    );

    // G. Documents & Consents
    expect(d.documents.length).toBeGreaterThanOrEqual(3);
    expect(d.documents.some((doc: any) => doc.type === "annual_consent")).toBe(
      true,
    );
  });

  it("allows parent to switch child selector to Anaya with distinct class and fee information", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${anayaStudentId}/dashboard`,
      {
        cookie: parentCookie,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.child.studentId).toBe(anayaStudentId);
    expect(res.body.child.fullName).toContain("Anaya");
    expect(res.body.child.className).toBe("Class 3");
    expect(res.body.child.sectionName).toBe("Section B");
    expect(res.body.child.admissionNumber).toBe("24A032");
  });

  it("shows a settled balance as zero and missing transport/results/events without invented records", async () => {
    const student = (
      await pool.query(
        `INSERT INTO students(school_id,admission_number,first_name,status) VALUES($1,'PARENT-ZERO-TEST','Zero Balance','active') RETURNING id`,
        [schoolId],
      )
    ).rows[0];
    const enrollment = (
      await pool.query(
        `SELECT academic_year_id,class_id,section_id,starts_on FROM enrollments WHERE school_id=$1 AND student_id=$2 AND enrollment_status='active' LIMIT 1`,
        [schoolId, aaravStudentId],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,starts_on) VALUES($1,$2,$3,$4,$5,$6)`,
      [
        schoolId,
        student.id,
        enrollment.academic_year_id,
        enrollment.class_id,
        enrollment.section_id,
        enrollment.starts_on,
      ],
    );
    const guardian = (
      await pool.query(
        `SELECT g.id FROM guardians g JOIN users u ON u.id=g.user_id WHERE g.school_id=$1 AND u.email='parent@demo.test'`,
        [schoolId],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO student_guardians(school_id,student_id,guardian_id,relationship_type,portal_access_status) VALUES($1,$2,$3,'parent','verified')`,
      [schoolId, student.id, guardian.id],
    );
    const result = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${student.id}/dashboard`,
      { cookie: parentCookie },
    );
    expect(result.status).toBe(200);
    expect(result.body.fees.totalDue).toBe(0);
    expect(result.body.fees.breakdown).toEqual({
      tuition: 0,
      transport: 0,
      other: 0,
    });
    expect(result.body.fees.dueDate).toBeNull();
    expect(result.body.transport.vehicleNumber).toBeNull();
    expect(result.body.transport.routeName).toBeNull();
    expect(result.body.transport.routeTimeline).toEqual([]);
    expect(result.body.transport.illustrativeEta).toBeNull();
    expect(result.body.academicProgress.subjects).toEqual([]);
    expect(result.body.upcomingEvents).toEqual([]);
  });

  it("strictly enforces tenant & family isolation: parent cannot access unlinked student", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${unlinkedStudentId}/dashboard`,
      {
        cookie: parentCookie,
      },
    );
    // A non-match returns 404 (or 403) to prevent tenant & student existence probing
    expect([403, 404]).toContain(res.status);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. ADVANCED PERIOD-WISE ATTENDANCE (CLASSES 6–12 MATCHING PDF SPEC)       */
/* -------------------------------------------------------------------------- */
describe("Advanced Attendance Management (Classes 6-12 Specification)", () => {
  let aaravCookie: string;
  let parentCookie: string;
  let coordinatorCookie: string;
  let aaravStudentId: string;
  let kabirStudentId: string;
  let section6AId: string;

  beforeAll(async () => {
    parentCookie = await login("parent@demo.test", "Parent@12345");
    aaravCookie = await login("aarav@demo.test", "Student@12345");
    coordinatorCookie = await login("coordinator@demo.test", "Coord@12345");

    // Look up Aarav student ID and section
    const stRes = await pool.query<{ id: string; section_id: string }>(
      `SELECT s.id, e.section_id FROM students s
       JOIN enrollments e ON e.student_id = s.id AND e.enrollment_status = 'active'
       WHERE s.school_id = $1 AND s.admission_number = '24A015' LIMIT 1`,
      [schoolId],
    );
    aaravStudentId = stRes.rows[0]!.id;
    section6AId = stRes.rows[0]!.section_id;

    // Look up Kabir student ID
    const kabirRes = await pool.query<{ id: string }>(
      `SELECT s.id FROM students s WHERE s.school_id = $1 AND s.first_name = 'Kabir' LIMIT 1`,
      [schoolId],
    );
    kabirStudentId = kabirRes.rows[0]!.id;
  });

  it("Aarav accesses advanced attendance matching PDF (cumulative donut, months, 8 periods with EMP codes)", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/students/${aaravStudentId}/attendance/advanced?date=2026-10-30`,
      {
        cookie: aaravCookie,
      },
    );
    expect(res.status).toBe(200);
    const data = res.body;

    // Cumulative stats matching PDF (80% rate, 77 present, 19 absent, 96 days)
    expect(data.cumulative.percentage).toBe(80);
    expect(data.cumulative.presentDays).toBe(77);
    expect(data.cumulative.absentDays).toBe(19);
    expect(data.cumulative.workingDays).toBe(96);

    // Month-wise breakdown (Jul, Aug, Sep, Oct)
    expect(Array.isArray(data.monthWise)).toBe(true);
    expect(data.monthWise.length).toBeGreaterThanOrEqual(4);
    const months = data.monthWise.map((m: any) => m.month);
    expect(months).toContain("Jul");
    expect(months).toContain("Aug");
    expect(months).toContain("Sep");
    expect(months).toContain("Oct");

    // 8 Periods list with employee codes
    expect(Array.isArray(data.periods)).toBe(true);
    expect(data.periods.length).toBe(8);

    // Period 1 English (EMP1034)
    const p1 = data.periods.find((p: any) => p.periodNumber === 1);
    expect(p1).toBeDefined();
    expect(p1.subjectName).toContain("English");
    expect(p1.teacherCode).toBe("EMP1034");
    expect(p1.status).toBe("present");

    // Period 2 Mathematics (EMP1048)
    const p2 = data.periods.find((p: any) => p.periodNumber === 2);
    expect(p2).toBeDefined();
    expect(p2.subjectName).toContain("Mathematics");
    expect(p2.teacherCode).toBe("EMP1048");

    // Period 3 Science (EMP1066)
    const p3 = data.periods.find((p: any) => p.periodNumber === 3);
    expect(p3).toBeDefined();
    expect(p3.subjectName).toContain("Science");
    expect(p3.teacherCode).toBe("EMP1066");

    // Period 4 Social Studies (EMP1075) with substitute teacher EMP1121
    const p4 = data.periods.find(
      (p: any) =>
        p.periodNumber === 5 || p.subjectName.includes("Social Studies"),
    );
    expect(p4).toBeDefined();
    expect(p4.isSubstitute).toBe(true);
    expect(p4.substituteTeacherName).toBeDefined();

    // Subject-wise breakdown table
    expect(Array.isArray(data.subjectWise)).toBe(true);
    expect(data.subjectWise.length).toBeGreaterThanOrEqual(6);
    for (const sw of data.subjectWise) {
      const recorded = (
        await pool.query(
          `SELECT COUNT(*)::int AS held, COUNT(*) FILTER (WHERE status IN ('present','late','half_day'))::int AS attended FROM student_period_attendance WHERE school_id=$1 AND student_id=$2 AND subject_id=$3`,
          [schoolId, aaravStudentId, sw.subjectId],
        )
      ).rows[0];
      expect(sw.classesHeld).toBe(recorded.held);
      expect(sw.classesAttended).toBe(recorded.attended);
      expect(sw.classesAttended).toBeLessThanOrEqual(sw.classesHeld);
      expect(typeof sw.percentage).toBe("number");
      expect(sw.teacherCode).toMatch(/^EMP\d{4}/);
    }
  });

  it("Parent can access linked child advanced attendance", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/students/${aaravStudentId}/attendance/advanced?date=2026-10-30`,
      {
        cookie: parentCookie,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.student.studentId).toBe(aaravStudentId);
  });

  it("Cross-student denial: Aarav cannot view Kabir advanced attendance", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/students/${kabirStudentId}/attendance/advanced`,
      {
        cookie: aaravCookie,
      },
    );
    expect([403, 404]).toContain(res.status);
  });

  it("Coordinator assigns substitute teacher for a timetable slot and records substitution", async () => {
    const targetSlot = (
      await pool.query(
        `SELECT ts.*, (y.starts_on + ((ts.day_of_week-extract(isodow FROM y.starts_on)::int+7)%7))::text AS replacement_date
      FROM timetable_slots ts JOIN academic_years y ON y.id=ts.academic_year_id
      WHERE ts.school_id=$1 AND ts.section_id=$2 LIMIT 1`,
        [schoolId, section6AId],
      )
    ).rows[0];
    // A replacement must be a verified, available teacher, not an arbitrary user.
    const subTeacherId = (
      await pool.query(`INSERT INTO users(email,display_name,password_hash,status)
      SELECT 'qualified-substitute@demo.test','Qualified Substitute',password_hash,'active' FROM users LIMIT 1 RETURNING id`)
    ).rows[0].id;
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,school_id,role_id,scope_type)
      SELECT $1,$2,id,'school' FROM roles WHERE code='teacher'`,
      [subTeacherId, schoolId],
    );
    const staffId = (
      await pool.query(
        `INSERT INTO staff(school_id,user_id,employee_number,first_name,designation)
      VALUES($1,$2,'SUB-QUALIFIED','Qualified','Teacher') RETURNING id`,
        [schoolId, subTeacherId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO teacher_eligibility_profiles(school_id,staff_id,subject_id,min_grade_order,max_grade_order,qualification,max_weekly_periods)
      VALUES($1,$2,$3,0,99,'Verified qualification',30)`,
      [schoolId, staffId, targetSlot.subject_id],
    );

    const subRes = await call(
      "POST",
      `/api/schools/${schoolId}/timetable/substitutions`,
      {
        cookie: coordinatorCookie,
        payload: {
          slotId: targetSlot.id,
          substitutionDate: targetSlot.replacement_date,
          substituteTeacherUserId: subTeacherId,
          reason: "Teacher attending CBSE Cluster Athletic Meet",
        },
      },
    );
    expect(subRes.status).toBe(201);
    expect(subRes.body.success).toBe(true);

    // Verify substitution in query
    const listSubRes = await call(
      "GET",
      `/api/schools/${schoolId}/timetable/substitutions?date=${targetSlot.replacement_date}`,
      {
        cookie: coordinatorCookie,
      },
    );
    expect(listSubRes.status).toBe(200);
    expect(
      listSubRes.body.items.some((i: any) => i.slot_id === targetSlot.id),
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. STUDENT PORTAL DASHBOARD & AGE TIERS                                    */
/* -------------------------------------------------------------------------- */
describe("Student Portal Dashboard (Age-Tiered Views)", () => {
  let aaravCookie: string;
  let kabirCookie: string;

  beforeAll(async () => {
    aaravCookie = await login("aarav@demo.test", "Student@12345");
    kabirCookie = await login("student@demo.test", "Student@12345");
  });

  it("Aarav (Grade 6) accesses middle school dashboard tier with homework ticker", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/student/dashboard`,
      { cookie: aaravCookie },
    );
    expect(res.status).toBe(200);
    const d = res.body;

    expect(d.student.name).toContain("Aarav");
    expect(d.student.className).toBe("Class 6");
    expect(d.student.gradeTier).toBe("middle_g6_g8");

    // Today's attendance
    expect(d.attendance.statusToday).toBe("Present today");
    expect(d.attendance.overallPercentage).toBe(80);

    // Homework ticker
    expect(Array.isArray(d.homework.todayItems)).toBe(true);
    expect(d.homework.todayItems.length).toBeGreaterThanOrEqual(1);

    // Timetable
    expect(Array.isArray(d.timetable)).toBe(true);
    expect(d.timetable.length).toBeGreaterThanOrEqual(6);

    // Learning Corner
    expect(Array.isArray(d.learningCorner)).toBe(true);
    expect(d.learningCorner.length).toBeGreaterThanOrEqual(2);

    // Notices
    expect(Array.isArray(d.notices)).toBe(true);
  });

  it("Kabir (Grade 10) accesses senior secondary dashboard tier", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/student/dashboard`,
      { cookie: kabirCookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.student.gradeTier).toBe("senior_g9_g12");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. PARENT LEAVE REQUESTS, PICKUP AUTHORISATIONS & TRANSPORT ALERTS        */
/* -------------------------------------------------------------------------- */
describe("Parent Requests & Transport Alert Preferences", () => {
  let parentCookie: string;
  let aaravStudentId: string;
  let createdPickupId: string;

  beforeAll(async () => {
    parentCookie = await login("parent@demo.test", "Parent@12345");
    const childrenRes = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children`,
      { cookie: parentCookie },
    );
    const aarav = childrenRes.body.items.find(
      (c: any) => c.fullName?.includes("Aarav") || c.name?.includes("Aarav"),
    );
    aaravStudentId = aarav.studentId;
  });

  it("Parent submits a planned student leave request", async () => {
    const res = await call(
      "POST",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/leave-requests`,
      {
        cookie: parentCookie,
        payload: {
          startsOn: "2026-11-20",
          endsOn: "2026-11-22",
          reasonCategory: "family_function",
          reasonText:
            "Attending elder sibling graduation ceremony out of state",
        },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();

    // List leave requests
    const listRes = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/leave-requests`,
      {
        cookie: parentCookie,
      },
    );
    expect(listRes.status).toBe(200);
    expect(
      listRes.body.items.some((l: any) =>
        l.reason_text.includes("graduation ceremony"),
      ),
    ).toBe(true);
  });

  it("Parent registers and subsequently revokes an authorised pickup person", async () => {
    // 1. Register pickup person
    const regRes = await call(
      "POST",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/pickup-authorisations`,
      {
        cookie: parentCookie,
        payload: {
          authorisedPersonName: "Vikram Sharma",
          relationship: "Uncle",
          phone: "+91 98765 40099",
          idProofType: "Aadhaar",
          idProofNumber: "XXXX-XXXX-9999",
          emergencyOnly: false,
        },
      },
    );
    expect(regRes.status).toBe(201);
    expect(regRes.body.id).toBeDefined();
    createdPickupId = regRes.body.id;

    // 2. Verify in pickup list
    const listRes = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/pickup-authorisations`,
      {
        cookie: parentCookie,
      },
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.some((p: any) => p.id === createdPickupId)).toBe(
      true,
    );

    // 3. Revoke pickup authorization
    const delRes = await call(
      "DELETE",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/pickup-authorisations/${createdPickupId}`,
      {
        cookie: parentCookie,
      },
    );
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    // 4. Verify no longer returned in active list
    const listAfterRes = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/pickup-authorisations`,
      {
        cookie: parentCookie,
      },
    );
    expect(
      listAfterRes.body.items.some((p: any) => p.id === createdPickupId),
    ).toBe(false);
  });

  it("Parent updates transport alert toggles and marks message as read", async () => {
    // 1. Update transport toggles
    const toggleRes = await call(
      "PUT",
      `/api/schools/${schoolId}/portal/children/${aaravStudentId}/transport/alerts`,
      {
        cookie: parentCookie,
        payload: {
          busApproaching: true,
          boarding: false,
          dropOff: true,
          delays: true,
        },
      },
    );
    expect(toggleRes.status).toBe(200);
    expect(toggleRes.body.alerts.boarding).toBe(false);
    expect(toggleRes.body.alerts.busApproaching).toBe(true);

    // 2. Mark parent message as read
    const msgRes = await pool.query<{ id: string }>(
      `SELECT id FROM parent_student_messages WHERE school_id = $1 AND student_id = $2 AND is_read = false LIMIT 1`,
      [schoolId, aaravStudentId],
    );
    if (msgRes.rows[0]) {
      const msgId = msgRes.rows[0].id;
      const readRes = await call(
        "POST",
        `/api/schools/${schoolId}/portal/messages/${msgId}/read`,
        {
          cookie: parentCookie,
        },
      );
      expect(readRes.status).toBe(200);
      expect(readRes.body.success).toBe(true);

      const checkMsg = await pool.query<{ is_read: boolean }>(
        `SELECT is_read FROM parent_student_messages WHERE id = $1`,
        [msgId],
      );
      expect(checkMsg.rows[0]?.is_read).toBe(true);
    }
  });
});
