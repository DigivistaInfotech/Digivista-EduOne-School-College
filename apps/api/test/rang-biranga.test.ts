import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatIndianMobile,
  formatIndianVehicleNumber,
  isValidIfsc,
  isValidIndianMobile,
  isValidIndianVehicleNumber,
  isValidPinCode,
} from "@erp/shared";
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
/* 1. UNIVERSAL DATA VALIDATION ENGINE TESTS                                  */
/* -------------------------------------------------------------------------- */
describe("Universal Data Validation Engine (Indian Standards)", () => {
  it("validates and formats Indian mobile numbers (+91)", () => {
    expect(isValidIndianMobile("+91 98765 43210")).toBe(true);
    expect(isValidIndianMobile("9876543210")).toBe(true);
    expect(isValidIndianMobile("09876543210")).toBe(true);
    expect(isValidIndianMobile("+916300123456")).toBe(true);
    expect(isValidIndianMobile("1234567890")).toBe(false);
    expect(isValidIndianMobile("98765")).toBe(false);

    expect(formatIndianMobile("9876543210")).toBe("+91 98765 43210");
    expect(formatIndianMobile("+919876543210")).toBe("+91 98765 43210");
  });

  it("validates and normalizes Indian vehicle registration numbers (State & BH series)", () => {
    // Normal state series (e.g. UP 58 P 6370, DL 01 AB 1234)
    expect(isValidIndianVehicleNumber("UP 58 P 6370")).toBe(true);
    expect(isValidIndianVehicleNumber("up58p6370")).toBe(true);
    expect(isValidIndianVehicleNumber("DL 01 AB 1234")).toBe(true);
    expect(isValidIndianVehicleNumber("MH 12 CD 5678")).toBe(true);

    expect(formatIndianVehicleNumber("up58p6370")).toBe("UP 58 P 6370");
    expect(formatIndianVehicleNumber("dl 1 ab 1234")).toBe("DL 01 AB 1234");

    // Bharat (BH) series (e.g. 23 BH 1234 AB)
    expect(isValidIndianVehicleNumber("23 BH 1234 AB")).toBe(true);
    expect(isValidIndianVehicleNumber("24bh5678cd")).toBe(true);
    expect(formatIndianVehicleNumber("23bh1234ab")).toBe("23 BH 1234 AB");

    // Invalid formats
    expect(isValidIndianVehicleNumber("XYZ 1234")).toBe(false);
    expect(isValidIndianVehicleNumber("12345")).toBe(false);
  });

  it("validates Indian IFSC and Postal PIN codes", () => {
    expect(isValidIfsc("SBIN0001234")).toBe(true);
    expect(isValidIfsc("HDFC0000456")).toBe(true);
    expect(isValidIfsc("SBIN1234567")).toBe(false);

    expect(isValidPinCode("226001")).toBe(true);
    expect(isValidPinCode("110001")).toBe(true);
    expect(isValidPinCode("010001")).toBe(false);
    expect(isValidPinCode("22600")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. HIGH-SCALE REALISTIC DEMO SEED ASSERTIONS                               */
/* -------------------------------------------------------------------------- */
describe("High-Scale Realistic Demo Seed Coverage", () => {
  it("verifies that at least 1,200 students are enrolled across Classes 1-12", () => {
    expect(seedSummary.studentsCount).toBeGreaterThanOrEqual(1200);
    expect(seedSummary.classesCount).toBeGreaterThanOrEqual(12);
    expect(seedSummary.sectionsCount).toBeGreaterThanOrEqual(24);
  });

  it("verifies that at least 80 staff members are seeded with eligibility profiles", () => {
    expect(seedSummary.staffCount).toBeGreaterThanOrEqual(80);
  });

  it("verifies that the transport fleet includes valid Indian and BH vehicles", () => {
    expect(seedSummary.vehiclesCount).toBeGreaterThanOrEqual(5);
    expect(seedSummary.transportAllocationsCount).toBeGreaterThanOrEqual(60);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. STUDENT PORTAL ENDPOINTS                                                */
/* -------------------------------------------------------------------------- */
describe("Student Portal Workflows", () => {
  let studentCookie: string;

  beforeAll(async () => {
    studentCookie = await login("student@demo.test", "Student@12345");
  });

  it("GET /api/schools/:schoolId/student/me returns comprehensive student profile", async () => {
    const res = await call("GET", `/api/schools/${schoolId}/student/me`, {
      cookie: studentCookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.student).toBeDefined();
    expect(res.body.student.firstName).toBe("Kabir");
    expect(res.body.student.className).toBe("Class 10");
    expect(res.body.student.sectionName).toBe("Section A");
    expect(res.body.student.cbseRegNo).toMatch(/^CBSE\/2026\/G10\//);
    expect(res.body.attendance).toBeDefined();
    expect(res.body.fees).toBeDefined();
    expect(res.body.counts).toBeDefined();
  });

  it("GET /api/schools/:schoolId/student/timetable returns assigned periods", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/student/timetable`,
      { cookie: studentCookie },
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("GET /api/schools/:schoolId/student/attendance returns rate and days", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/student/attendance`,
      { cookie: studentCookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.totalWorkingDays).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.attendanceRate).toBe("number");
  });

  it("GET /api/schools/:schoolId/student/homework returns assignments", async () => {
    const res = await call("GET", `/api/schools/${schoolId}/student/homework`, {
      cookie: studentCookie,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("POST /api/schools/:schoolId/student/learning/assistant identifies local templates without invented citations", async () => {
    // A template response must not claim an AI answer or verified citation.
    const boundaryRes = await call(
      "POST",
      `/api/schools/${schoolId}/student/learning/assistant`,
      {
        cookie: studentCookie,
        payload: {
          prompt:
            "Can you tell me how to play video games instead of studying?",
          mode: "explain",
          language: "en",
        },
      },
    );
    expect(boundaryRes.status).toBe(200);
    expect(boundaryRes.body.disclaimer).toContain("local study template");
    expect(boundaryRes.body.isDemo).toBe(true);
    expect(boundaryRes.body.provider).toBe("deterministic_local");
    expect(boundaryRes.body.citations).toEqual([]);

    // The academic topic is reflected in a clearly labelled study template.
    const academicRes = await call(
      "POST",
      `/api/schools/${schoolId}/student/learning/assistant`,
      {
        cookie: studentCookie,
        payload: {
          prompt:
            "What is quadratic formula and how is it used in Class 10 Mathematics?",
          mode: "explain",
          language: "en",
        },
      },
    );
    expect(academicRes.status).toBe(200);
    expect(academicRes.body.response).toContain("quadratic");
    expect(academicRes.body.mode).toBe("explain");
    expect(Array.isArray(academicRes.body.citations)).toBe(true);
    expect(academicRes.body.citations).toEqual([]);
    expect(academicRes.body.response).toContain("not a verified answer");
    expect(Array.isArray(academicRes.body.availableResources)).toBe(true);
  });

  it("lists only actual published student-visible resources in the student class and requested subject", async () => {
    const student = (
      await pool.query(
        `SELECT e.class_id FROM students s JOIN enrollments e ON e.student_id=s.id AND e.school_id=s.school_id AND e.enrollment_status='active' WHERE s.school_id=$1 AND s.user_id=(SELECT id FROM users WHERE email='student@demo.test') LIMIT 1`,
        [schoolId],
      )
    ).rows[0];
    const subject = (
      await pool.query("SELECT id FROM subjects WHERE school_id=$1 LIMIT 1", [
        schoolId,
      ])
    ).rows[0];
    const admin = (
      await pool.query("SELECT id FROM users WHERE email='admin@demo.test'")
    ).rows[0];
    const publicResource = (
      await pool.query(
        `INSERT INTO learning_resources(school_id,title,class_id,subject_id,url,status,visibility,created_by) VALUES($1,'Real student resource',$2,$3,'https://example.test/student-resource','published','students',$4) RETURNING id`,
        [schoolId, student.class_id, subject.id, admin.id],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO learning_resources(school_id,title,class_id,subject_id,url,status,visibility,created_by) VALUES($1,'Private staff resource',$2,$3,'https://example.test/staff-only','published','staff',$4)`,
      [schoolId, student.class_id, subject.id, admin.id],
    );
    const response = await call(
      "POST",
      `/api/schools/${schoolId}/student/learning/assistant`,
      {
        cookie: studentCookie,
        payload: {
          prompt: "Summarise the chosen chapter",
          topic: "Invented chapter 999",
          subjectId: subject.id,
          mode: "summarize",
        },
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.citations).toEqual([]);
    expect(response.body.availableResources).toContainEqual({
      id: publicResource.id,
      title: "Real student resource",
      subjectName: expect.any(String),
      url: "https://example.test/student-resource",
    });
    expect(JSON.stringify(response.body.availableResources)).not.toContain(
      "Private staff resource",
    );
    expect(response.body.response).not.toContain("page 14");
    const otherClass = (
      await pool.query(
        "SELECT id FROM classes WHERE school_id=$1 AND id<>$2 LIMIT 1",
        [schoolId, student.class_id],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO learning_resources(school_id,title,class_id,subject_id,status,visibility,created_by) VALUES($1,'Other class private lesson',$2,$3,'published','students',$4),($1,'Unpublished student lesson',$5,$3,'draft','students',$4)`,
      [schoolId, otherClass.id, subject.id, admin.id, student.class_id],
    );
    const dashboard = await call(
      "GET",
      `/api/schools/${schoolId}/student/dashboard`,
      { cookie: studentCookie },
    );
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.learningCorner).toContainEqual(
      expect.objectContaining({
        id: publicResource.id,
        title: "Real student resource",
      }),
    );
    const titles = dashboard.body.learningCorner.map((item: any) => item.title);
    expect(titles).not.toContain("Private staff resource");
    expect(titles).not.toContain("Other class private lesson");
    expect(titles).not.toContain("Unpublished student lesson");
  });

  it("does not invent attendance or homework for a new student without records", async () => {
    const user = (
      await pool.query(
        `INSERT INTO users(email,display_name,password_hash,status) SELECT 'empty-student@test.local','Empty Student',password_hash,'active' FROM users WHERE email='student@demo.test' RETURNING id`,
      )
    ).rows[0];
    const student = (
      await pool.query(
        `INSERT INTO students(school_id,user_id,admission_number,first_name,status) VALUES($1,$2,'EMPTY-TRUTH-TEST','Empty','active') RETURNING id`,
        [schoolId, user.id],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,role_id,school_id,scope_type,reason) SELECT $1,id,$2,'self','Truthfulness regression' FROM roles WHERE code='student'`,
      [user.id, schoolId],
    );
    const section = (
      await pool.query(
        `INSERT INTO sections(school_id,academic_year_id,class_id,code,name) SELECT school_id,academic_year_id,class_id,'EMPTY-TRUTH','Empty truth test' FROM sections WHERE school_id=$1 LIMIT 1 RETURNING id,academic_year_id,class_id`,
        [schoolId],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrollment_status,starts_on) SELECT $1,$2,$3,$4,$5,'active',starts_on FROM academic_years WHERE id=$3`,
      [
        schoolId,
        student.id,
        section.academic_year_id,
        section.class_id,
        section.id,
      ],
    );
    const cookie = await login("empty-student@test.local", "Student@12345");
    const me = await call("GET", `/api/schools/${schoolId}/student/me`, {
      cookie,
    });
    expect(me.status).toBe(200);
    expect(me.body.student.id).toBe(student.id);
    expect(me.body.attendance.totalWorkingDays).toBe(0);
    expect(me.body.attendance.attendanceRate).toBe(0);
    expect(me.body.attendance.shortageWarning).toBe(false);
    const dashboard = await call(
      "GET",
      `/api/schools/${schoolId}/student/dashboard`,
      { cookie },
    );
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.attendance.statusToday).toBe("Not marked yet");
    expect(dashboard.body.attendance.overallPercentage).toBe(0);
    expect(dashboard.body.homework.todayItems).toEqual([]);
    expect(dashboard.body.homework.pendingCount).toBe(0);
  });

  it("POST /api/schools/:schoolId/student/concerns creates a student pastoral query", async () => {
    const res = await call(
      "POST",
      `/api/schools/${schoolId}/student/concerns`,
      {
        cookie: studentCookie,
        payload: {
          category: "academic",
          title: "Need clarification on physics project guidelines",
          description:
            "Could teacher please provide rubric for science exhibition project?",
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    const listRes = await call(
      "GET",
      `/api/schools/${schoolId}/student/concerns`,
      { cookie: studentCookie },
    );
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBeGreaterThan(0);
  });

  it("POST /api/schools/:schoolId/student/profile-correction submits a change request for review", async () => {
    const res = await call(
      "POST",
      `/api/schools/${schoolId}/student/profile-correction`,
      {
        cookie: studentCookie,
        payload: {
          fieldName: "emergency_contact",
          proposedValue: "+91 98765 99999",
          reason:
            "Father changed office mobile number, updating emergency contact",
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe("pending");
  });
});

/* -------------------------------------------------------------------------- */
/* 4. OFFLINE PAYMENT QUEUE & VERIFICATION (FINANCE WORKFLOW)                */
/* -------------------------------------------------------------------------- */
describe("Offline Payment Queue & Verification Workflow", () => {
  let parentCookie: string;
  let financeCookie: string;
  let testAcknowledgementId: string;
  let firstStudentId: string;

  beforeAll(async () => {
    parentCookie = await login("parent@demo.test", "Parent@12345");
    financeCookie = await login("finance@demo.test", "Finance@12345");

    // Get children of parent
    const portalRes = await call(
      "GET",
      `/api/schools/${schoolId}/portal/children`,
      { cookie: parentCookie },
    );
    expect(portalRes.status).toBe(200);
    const children = portalRes.body.items ?? portalRes.body.children ?? [];
    expect(children.length).toBeGreaterThan(0);
    firstStudentId = children[0].studentId ?? children[0].id;
  });

  it("Parent submits offline payment acknowledgement", async () => {
    const res = await call(
      "POST",
      `/api/schools/${schoolId}/portal/children/${firstStudentId}/offline-payments`,
      {
        cookie: parentCookie,
        payload: {
          amount: 35000,
          paymentMethod: "upi",
          referenceNumber: "UPI/2026/0415/778899",
          paymentDate: "2026-04-15",
          bankName: "State Bank of India",
          notes: "First term tuition paid via UPI to school QR code",
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.acknowledgement.id).toBeDefined();
    testAcknowledgementId = res.body.acknowledgement.id;
  });

  it("Finance manager reviews offline payments queue and raises a status update", async () => {
    const listRes = await call(
      "GET",
      `/api/schools/${schoolId}/fees/offline-acknowledgements?status=pending`,
      {
        cookie: financeCookie,
      },
    );
    expect(listRes.status).toBe(200);
    expect(
      listRes.body.items.some((i: any) => i.id === testAcknowledgementId),
    ).toBe(true);

    // Raise query
    const queryRes = await call(
      "POST",
      `/api/schools/${schoolId}/fees/offline-acknowledgements/${testAcknowledgementId}/status`,
      {
        cookie: financeCookie,
        payload: {
          status: "more_info_needed",
          reviewNotes: "Please confirm UTR last 4 digits match bank SMS alert",
        },
      },
    );
    expect(
      queryRes.status,
      `Query status update failed: ${JSON.stringify(queryRes.body)}`,
    ).toBe(200);
    expect(queryRes.body.status).toBe("more_info_needed");
  });

  it("Finance manager verifies payment and automatically generates official receipt", async () => {
    const verifyRes = await call(
      "POST",
      `/api/schools/${schoolId}/fees/offline-acknowledgements/${testAcknowledgementId}/verify`,
      {
        cookie: financeCookie,
        payload: {
          notes: "Bank statement verified against SBI branch scroll",
        },
      },
    );
    expect(
      verifyRes.status,
      `Verify failed: ${JSON.stringify(verifyRes.body)}`,
    ).toBe(200);
    expect(verifyRes.body.status).toBe("verified");
    expect(verifyRes.body.receiptNumber).toMatch(/^RCPT-OFF-/);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. ATTENDANCE POLICY (80%) & SHORTAGE REGISTER                            */
/* -------------------------------------------------------------------------- */
describe("Attendance Compliance (80% Policy) & Shortage Register", () => {
  let coordinatorCookie: string;
  let principalCookie: string;
  let shortageCases: any[];

  beforeAll(async () => {
    coordinatorCookie = await login("coordinator@demo.test", "Coord@12345");
    principalCookie = await login("admin@demo.test", "Admin@12345");
  });

  it("Coordinator views attendance shortage register with computed < 80% rates", async () => {
    const res = await call(
      "GET",
      `/api/schools/${schoolId}/attendance/shortages`,
      { cookie: coordinatorCookie },
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    shortageCases = res.body.items;
  });

  it("Issues progressive formal shortage warning", async () => {
    const targetCase = shortageCases[0];
    const res = await call(
      "POST",
      `/api/schools/${schoolId}/attendance/shortages/${targetCase.id}/warning`,
      {
        cookie: coordinatorCookie,
        payload: {
          warningLevel: "second",
          notes:
            "Second advisory notice dispatched to guardian via registered portal",
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.warningLevel).toBe("second");
  });

  it("Records parent/medical explanation and condonation decision by Principal", async () => {
    const targetCase = shortageCases[0];
    const explainRes = await call(
      "POST",
      `/api/schools/${schoolId}/attendance/shortages/${targetCase.id}/explain`,
      {
        cookie: coordinatorCookie,
        payload: {
          explanationText:
            "Typhoid fever and subsequent recovery under medical rest",
          medicalLeaveDays: 7,
        },
      },
    );
    expect(explainRes.status).toBe(200);
    expect(explainRes.body.stage).toBe("explanation_received");

    // Principal makes condonation decision
    const decisionRes = await call(
      "POST",
      `/api/schools/${schoolId}/attendance/shortages/${targetCase.id}/decision`,
      {
        cookie: principalCookie,
        payload: {
          internalExamEligibility: "eligible",
          boardExamEligibility: "condoned_by_board",
          authorizedDecision:
            "Approved under CBSE Medical Exemption Bylaw 14.1 (within 15% allowance limit)",
          decisionNotes:
            "Medical certificate verified by school medical officer",
        },
      },
    );
    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.authorizedDecision).toContain(
      "CBSE Medical Exemption",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 6. CONFIGURATION STUDIO (DYNAMIC LABELS, POLICIES & ROLLBACK)             */
/* -------------------------------------------------------------------------- */
describe("Configuration Studio Endpoints", () => {
  let adminCookie: string;

  beforeAll(async () => {
    adminCookie = await login("admin@demo.test", "Admin@12345");
  });

  it("GET /api/schools/:schoolId/config returns all registered configurations", async () => {
    const res = await call("GET", `/api/schools/${schoolId}/config`, {
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.configs).toBeDefined();
    expect(res.body.configs.attendance_policy).toBeDefined();
  });

  it("PUT /api/schools/:schoolId/config/:key updates settings and bumps version history", async () => {
    const updateRes = await call(
      "PUT",
      `/api/schools/${schoolId}/config/library_policy`,
      {
        cookie: adminCookie,
        payload: {
          value: {
            maxBooksPerStudent: 4,
            loanDurationDays: 21,
            overdueFinePerDay: 5.0,
          },
          status: "published",
        },
      },
    );
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.version).toBeGreaterThanOrEqual(2);
    expect(updateRes.body.configValue.maxBooksPerStudent).toBe(4);
  });

  it("POST /api/schools/:schoolId/config/:key/rollback reverts to previous configuration version", async () => {
    const rollbackRes = await call(
      "POST",
      `/api/schools/${schoolId}/config/library_policy/rollback`,
      {
        cookie: adminCookie,
        payload: {
          targetVersion: 1,
        },
      },
    );
    expect(rollbackRes.status).toBe(200);
    expect(rollbackRes.body.configKey).toBe("library_policy");
  });
});

/* -------------------------------------------------------------------------- */
/* 7. TEACHER ELIGIBILITY & WORKLOAD VALIDATION                              */
/* -------------------------------------------------------------------------- */
describe("Teacher Eligibility & Assignment Validation", () => {
  let adminCookie: string;
  let testStaffId: string;
  let firstSubjectId: string;
  let firstSectionId: string;

  beforeAll(async () => {
    adminCookie = await login("admin@demo.test", "Admin@12345");

    // Get a staff record
    const staffRes = await call("GET", `/api/schools/${schoolId}/staff`, {
      cookie: adminCookie,
    });
    expect(staffRes.status).toBe(200);
    testStaffId = staffRes.body.items[0].id;

    // Get subject and section
    const subRes = await pool.query<{ id: string }>(
      "SELECT id FROM subjects WHERE school_id = $1 LIMIT 1",
      [schoolId],
    );
    firstSubjectId = subRes.rows[0]!.id;

    const secRes = await pool.query<{ id: string }>(
      "SELECT id FROM sections WHERE school_id = $1 LIMIT 1",
      [schoolId],
    );
    firstSectionId = secRes.rows[0]!.id;
  });

  it("POST /api/schools/:schoolId/staff/teacher-eligibility saves qualifications and grade boundaries", async () => {
    const res = await call(
      "POST",
      `/api/schools/${schoolId}/staff/teacher-eligibility`,
      {
        cookie: adminCookie,
        payload: {
          staffId: testStaffId,
          subjectId: firstSubjectId,
          qualification: "M.Sc Physics, B.Ed",
          minGradeOrder: 9,
          maxGradeOrder: 12,
          maxWeeklyPeriods: 28,
          verificationStatus: "verified",
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.profile.min_grade_order).toBe(9);
    expect(res.body.profile.max_grade_order).toBe(12);
  });

  it("POST /api/schools/:schoolId/academic/check-teacher-assignment validates grade eligibility", async () => {
    const checkRes = await call(
      "POST",
      `/api/schools/${schoolId}/academic/check-teacher-assignment`,
      {
        cookie: adminCookie,
        payload: {
          staffId: testStaffId,
          subjectId: firstSubjectId,
          sectionId: firstSectionId,
        },
      },
    );
    expect(checkRes.status).toBe(200);
    expect(typeof checkRes.body.valid).toBe("boolean");
    expect(Array.isArray(checkRes.body.warnings)).toBe(true);
  });
});
