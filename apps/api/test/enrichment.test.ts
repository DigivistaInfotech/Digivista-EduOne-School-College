import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INDIA_STATES, defaultStudentPolicy } from "@erp/shared";

let app: FastifyInstance;
let pool: pg.Pool;
let stop: () => Promise<void>;
let schoolId: string;
let studentId: string;
let otherStudentId: string;
let admin: string;
let teacher: string;
let student: string;
let parent: string;
async function call(
  method: "GET" | "POST" | "PUT",
  path: string,
  cookie = admin,
  payload?: unknown,
) {
  const res = await app.inject({
    method,
    url: `/api/schools/${schoolId}${path}`,
    headers: { cookie, origin: "http://localhost:5173" },
    payload: payload as never,
  });
  let body: any;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
}
async function login(email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return String(res.headers["set-cookie"]).split(";")[0]!;
}
beforeAll(async () => {
  const { startTestDatabase } = await import("@erp/db/test-database");
  const db = await startTestDatabase();
  stop = db.stop;
  process.env.DATABASE_URL = db.url;
  process.env.NODE_ENV = "test";
  const { buildApp } = await import("../src/app");
  const { getPool } = await import("../src/db");
  pool = getPool();
  app = await buildApp();
  await app.ready();
  schoolId = (await pool.query(`SELECT id FROM schools LIMIT 1`)).rows[0].id;
  studentId = (
    await pool.query(
      `SELECT id FROM students WHERE school_id=$1 AND first_name='Aarav'`,
      [schoolId],
    )
  ).rows[0].id;
  otherStudentId = (
    await pool.query(
      `SELECT id FROM students WHERE school_id=$1 AND first_name='Meera'`,
      [schoolId],
    )
  ).rows[0].id;
  await pool.query(
    `UPDATE students SET user_id=(SELECT id FROM users WHERE email='student@demo.test') WHERE id=$1`,
    [studentId],
  );
  admin = await login("admin@demo.test", "Admin@12345");
  teacher = await login("teacher@demo.test", "Teacher@12345");
  student = await login("student@demo.test", "Student@12345");
  parent = await login("parent@demo.test", "Parent@12345");
});
afterAll(async () => {
  await app?.close();
  const { closePool } = await import("../src/db");
  await closePool();
  await stop?.();
});

describe("India setup", () => {
  it("offers 36 unique states and territories with an India-only saved profile", async () => {
    expect(INDIA_STATES).toHaveLength(36);
    expect(new Set(INDIA_STATES.map((state) => state.code)).size).toBe(36);
    const initial = await call("GET", "/regional-settings");
    expect(initial.body.settings).toEqual({
      countryCode: "IN",
      stateCode: null,
      defaultLanguage: "en",
    });
    for (const stateCode of ["UP", "MP", "DL", "KA"]) {
      const saved = await call("PUT", "/config/regional_settings", admin, {
        value: { countryCode: "IN", stateCode, defaultLanguage: "hi" },
        status: "published",
      });
      expect(saved.status).toBe(200);
      expect(
        (await call("GET", "/regional-settings")).body.settings.stateCode,
      ).toBe(stateCode);
    }
  });
  it("rejects foreign countries, invalid states, unsupported languages and unauthorised changes", async () => {
    for (const value of [
      { countryCode: "US", stateCode: "UP", defaultLanguage: "en" },
      { countryCode: "IN", stateCode: "XX", defaultLanguage: "en" },
      { countryCode: "IN", stateCode: "UP", defaultLanguage: "fr" },
    ])
      expect(
        (
          await call("PUT", "/config/regional_settings", admin, {
            value,
            status: "published",
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await call("PUT", "/config/regional_settings", teacher, {
          value: { countryCode: "IN", stateCode: "UP", defaultLanguage: "en" },
        })
      ).status,
    ).toBe(403);
  });
  it("keeps regional history and can restore an earlier selection", async () => {
    expect(
      (
        await call("POST", "/config/regional_settings/rollback", admin, {
          targetVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("GET", "/regional-settings")).body.settings.stateCode,
    ).toBe("UP");
  });
});

describe("Permission-specific learning scope", () => {
  it("does not widen assigned teaching classes through an unrelated school-wide finance role", async () => {
    const grant = await pool.query(
      `INSERT INTO user_role_assignments(user_id,role_id,school_id,scope_type,reason)
       SELECT u.id,r.id,$1,'school','Mixed-role scope regression' FROM users u CROSS JOIN roles r
       WHERE u.email='teacher@demo.test' AND r.code='finance' RETURNING id`,
      [schoolId],
    );
    expect(grant.rowCount).toBe(1);
    try {
      expect((await call("GET", "/discovery/questions?grade=2", teacher)).status).toBe(403);
      const studentLookup = await call("GET", "/activities/students", teacher);
      expect(studentLookup.status).toBe(200);
      expect(studentLookup.body.items.some((s: any) => s.id === otherStudentId)).toBe(false);
    } finally {
      await pool.query("DELETE FROM user_role_assignments WHERE id=$1", [grant.rows[0].id]);
    }
  });
});

describe("Activity calendar, enrolment and certificates", () => {
  let clubId: string;
  let sessionId: string;
  let participationId: string;
  let certificateId: string;
  it("creates a club and enrols a scoped student, with duplicate/capacity and scope guards", async () => {
    const club = await call("POST", "/activities/clubs", teacher, {
      code: "CRICKET-TEST",
      name: "Cricket Club",
      category: "sports",
      maxMembers: 1,
    });
    expect(club.status).toBe(201);
    clubId = club.body.id;
    expect(
      (
        await call("POST", `/activities/clubs/${clubId}/members`, teacher, {
          studentId,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call("POST", `/activities/clubs/${clubId}/members`, teacher, {
          studentId,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("POST", `/activities/clubs/${clubId}/members`, teacher, {
          studentId: otherStudentId,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("POST", `/activities/clubs/${clubId}/members`, admin, {
          studentId: otherStudentId,
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("GET", `/activities/clubs/${clubId}/members`, student))
        .status,
    ).toBe(403);
  });
  it("validates event times, then records a competition attendance and house result", async () => {
    const startsAt = new Date(Date.now() - 7200000).toISOString(),
      endsAt = new Date(Date.now() - 3600000).toISOString();
    expect(
      (
        await call("POST", "/activities/sessions", teacher, {
          clubId,
          title: "Invalid dates",
          kind: "session",
          startsAt: endsAt,
          endsAt: startsAt,
        })
      ).status,
    ).toBe(400);
    const result = await call("POST", "/activities/sessions", teacher, {
      clubId,
      title: "Inter-house cricket",
      kind: "competition",
      startsAt,
      endsAt,
      venue: "School ground",
    });
    expect(result.status).toBe(201);
    sessionId = result.body.id;
    expect(
      (
        await call(
          "PUT",
          `/activities/sessions/${sessionId}/participation`,
          teacher,
          { studentId: otherStudentId, status: "present" },
        )
      ).status,
    ).toBe(404);
    const record = await call(
      "PUT",
      `/activities/sessions/${sessionId}/participation`,
      teacher,
      {
        studentId,
        status: "present",
        house: "Blue",
        score: 25,
        rank: 1,
        achievement: "Team player <script>alert(1)</script>",
      },
    );
    expect(record.status).toBe(200);
    participationId = record.body.id;
    const roster = await call(
      "GET",
      `/activities/sessions/${sessionId}/participation`,
      teacher,
    );
    expect(roster.body.items[0].score).toBe(25);
  });
  it("issues an idempotent certificate, escapes output and locks certified attendance", async () => {
    const issued = await call(
      "POST",
      `/activities/participation/${participationId}/certificate`,
      teacher,
      {},
    );
    expect(issued.status).toBe(200);
    certificateId = issued.body.id;
    expect(
      (
        await call(
          "POST",
          `/activities/participation/${participationId}/certificate`,
          teacher,
          {},
        )
      ).body.id,
    ).toBe(certificateId);
    const print = await call(
      "GET",
      `/activities/certificates/${certificateId}/print`,
      student,
    );
    expect(print.status).toBe(200);
    expect(print.body).toContain("Aarav");
    expect(print.body).not.toContain("<script>alert(1)</script>");
    expect(
      (
        await call(
          "GET",
          `/activities/certificates/${certificateId}/print`,
          parent,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "PUT",
          `/activities/sessions/${sessionId}/participation`,
          teacher,
          { studentId, status: "absent" },
        )
      ).status,
    ).toBe(409);
  });
  it("rejects awards for absent participants and prevents unlinked student access", async () => {
    expect(
      (
        await call(
          "PUT",
          `/activities/sessions/${sessionId}/participation`,
          teacher,
          { studentId, status: "absent", score: 4 },
        )
      ).status,
    ).toBe(400);
    await pool.query(`UPDATE students SET user_id=NULL WHERE id=$1`, [
      studentId,
    ]);
    await pool.query(
      `UPDATE students SET user_id=(SELECT id FROM users WHERE email='student@demo.test') WHERE id=$1`,
      [otherStudentId],
    );
    expect(
      (
        await call(
          "GET",
          `/activities/certificates/${certificateId}/print`,
          student,
        )
      ).status,
    ).toBe(404);
    await pool.query(`UPDATE students SET user_id=NULL WHERE id=$1`, [
      otherStudentId,
    ]);
    await pool.query(
      `UPDATE students SET user_id=(SELECT id FROM users WHERE email='student@demo.test') WHERE id=$1`,
      [studentId],
    );
  });
});

describe("Class-wise practice and question paper generation", () => {
  let objectiveId: string;
  let descriptiveId: string;
  let paperId: string;
  const question = (kind = "objective", grade = 1) => ({
    grade,
    subject: "GK",
    chapter: "Our world",
    topic: "Practice",
    kind,
    question:
      kind === "objective"
        ? "Which planet is known as the Red Planet?"
        : `Explain the topic in a ${kind} answer.`,
    answer: kind === "objective" ? "Mars" : "Teacher-reviewed model answer",
    options: kind === "objective" ? ["Earth", "Mars", "Venus", "Jupiter"] : [],
    sourceTitle: "Teacher-authored practice",
    status: "draft",
  });
  it("keeps drafts private, validates choices and restricts teachers to their assigned grades", async () => {
    expect(
      (
        await call(
          "POST",
          "/discovery/questions",
          teacher,
          question("short", 2),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("POST", "/discovery/questions", teacher, {
          ...question(),
          answer: "not an option",
        })
      ).status,
    ).toBe(400);
    const created = await call(
      "POST",
      "/discovery/questions",
      teacher,
      question(),
    );
    expect(created.status).toBe(201);
    objectiveId = created.body.id;
    expect(
      (await call("GET", "/discovery/questions?grade=1", student)).body.items,
    ).toHaveLength(0);
    expect(
      (
        await call(
          "POST",
          `/discovery/questions/${objectiveId}/publish`,
          student,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          `/discovery/questions/${objectiveId}/publish`,
          teacher,
          {},
        )
      ).status,
    ).toBe(200);
  });
  it("filters by enrolled class and reveals model answers only after an attempt", async () => {
    const list = await call("GET", "/discovery/questions?grade=1", student);
    expect(list.status).toBe(200);
    expect(list.body.grades).toEqual([1]);
    expect(list.body.items[0]).not.toHaveProperty("answer");
    expect(
      (await call("GET", "/discovery/questions?grade=2", student)).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          `/discovery/questions/${objectiveId}/practice`,
          student,
          { response: "invalid" },
        )
      ).status,
    ).toBe(400);
    const attempt = await call(
      "POST",
      `/discovery/questions/${objectiveId}/practice`,
      student,
      { response: "Mars" },
    );
    expect(attempt.body.correct).toBe(true);
    expect(attempt.body.modelAnswer).toBe("Mars");
  });
  it("supports all four types and leaves descriptive grading to review", async () => {
    for (const kind of ["short", "long", "very_long"]) {
      const created = await call(
        "POST",
        "/discovery/questions",
        teacher,
        question(kind),
      );
      expect(created.status).toBe(201);
      descriptiveId = created.body.id;
      expect(
        (
          await call(
            "POST",
            `/discovery/questions/${descriptiveId}/publish`,
            teacher,
            {},
          )
        ).status,
      ).toBe(200);
    }
    const result = await call(
      "POST",
      `/discovery/questions/${descriptiveId}/practice`,
      student,
      { response: "My own written explanation" },
    );
    expect(result.body.correct).toBeNull();
    expect(result.body.modelAnswer).toBe("Teacher-reviewed model answer");
  });
  it("requires a dated source for current affairs and excludes expired news from student practice", async () => {
    expect(
      (
        await call("POST", "/discovery/questions", teacher, {
          ...question(),
          currentAffairs: true,
        })
      ).status,
    ).toBe(400);
    const asOf = new Date(Date.now() - 40 * 86400000)
      .toISOString()
      .slice(0, 10);
    const created = await call("POST", "/discovery/questions", teacher, {
      ...question(),
      currentAffairs: true,
      asOf,
      sourceUrl: "https://www.pib.gov.in/",
    });
    expect(created.status).toBe(201);
    await call(
      "POST",
      `/discovery/questions/${created.body.id}/publish`,
      teacher,
      {},
    );
    const list = await call("GET", "/discovery/questions?grade=1", student);
    expect(
      list.body.items.some((item: any) => item.id === created.body.id),
    ).toBe(false);
    expect(
      (
        await call(
          "POST",
          `/discovery/questions/${created.body.id}/practice`,
          student,
          { response: "Mars" },
        )
      ).status,
    ).toBe(404);
  });
  it("generates distinct staff-only sets with exact marks and separate answer keys", async () => {
    const sections = [
      { kind: "objective", count: 1, marksEach: 1 },
      { kind: "short", count: 1, marksEach: 2 },
      { kind: "long", count: 1, marksEach: 5 },
      { kind: "very_long", count: 1, marksEach: 8 },
    ];
    const result = await call("POST", "/discovery/papers", teacher, {
      title: "GK practice paper",
      grade: 1,
      subject: "GK",
      variantCount: 2,
      sections,
    });
    expect(result.status).toBe(201);
    expect(result.body.items).toHaveLength(2);
    expect(result.body.items[0].totalMarks).toBe(16);
    expect(result.body.items[0].questions).toHaveLength(4);
    expect(result.body.items[0].questions).not.toEqual(
      result.body.items[1].questions,
    );
    paperId = result.body.items[0].id;
    expect(
      (await call("GET", `/discovery/papers/${paperId}/print`, student)).status,
    ).toBe(403);
    const printable = await call(
      "GET",
      `/discovery/papers/${paperId}/print`,
      teacher,
    );
    expect(printable.status).toBe(200);
    expect(printable.body).not.toContain("Teacher-reviewed model answer");
    expect(
      (
        await call(
          "GET",
          `/discovery/papers/${paperId}/print?answers=true`,
          teacher,
        )
      ).body,
    ).toContain("Teacher-reviewed model answer");
  });
  it("fails clearly on insufficient bank content or wrong chapters without saving partial sets", async () => {
    const before = (await call("GET", "/discovery/papers", teacher)).body.items
      .length;
    const response = await call("POST", "/discovery/papers", teacher, {
      title: "Missing content",
      grade: 1,
      subject: "GK",
      chapters: ["Unknown chapter"],
      sections: [{ kind: "short", count: 3, marksEach: 2 }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("Not enough");
    expect(
      (await call("GET", "/discovery/papers", teacher)).body.items,
    ).toHaveLength(before);
  });
  it("does not leak content through another school URL", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/schools/00000000-0000-4000-8000-000000000099/discovery/questions?grade=1",
      headers: { cookie: student },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("Administrator student policies and readmission", () => {
  let seniorSection: string;
  let yearId: string;
  let seniorCase: string;
  let elementaryCase: string;
  let reviewer: string;
  it("saves and applies school-defined heads and late fees without altering historic charges", async () => {
    const original = (
      await pool.query(
        `SELECT count(*)::int AS count FROM student_charges WHERE school_id=$1`,
        [schoolId],
      )
    ).rows[0].count;
    const policy = {
      ...defaultStudentPolicy("UP"),
      policyReference: "School management policy 2026",
      feeHeads: [
        {
          code: "TEST-EXTRA",
          name: "School activity fund",
          description: "Administrator-defined, not government verified",
        },
      ],
      admissionRequirements: [
        "Previous school record",
        "Guardian contact details",
      ],
      reviewAfterDays: 30,
      lateFee: {
        enabled: true,
        graceDays: 7,
        percentPerMonth: 1,
        maxAmount: 100,
      },
      readmissionInstructions:
        "Review previous enrollment and retain admission number.",
    };
    expect(
      (await call("PUT", "/student-policies/UP", teacher, policy)).status,
    ).toBe(403);
    expect(
      (await call("PUT", "/student-policies/UP", admin, policy)).status,
    ).toBe(200);
    expect(
      (await call("GET", "/admission-policy", teacher)).body.requirements,
    ).toHaveLength(2);
    const first = await call("POST", "/student-policies/UP/apply", admin, {});
    expect(first.status).toBe(200);
    expect(first.body.headsApplied).toBe(1);
    expect(first.body.lateRuleId).toBeTruthy();
    const again = await call("POST", "/student-policies/UP/apply", admin, {});
    expect(again.body.lateRuleId).toBe(first.body.lateRuleId);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM student_charges WHERE school_id=$1`,
          [schoolId],
        )
      ).rows[0].count,
    ).toBe(original);
    expect(
      (await call("POST", "/student-policies/MP/apply", admin, {})).status,
    ).toBe(400);
  });
  it("creates overdue review cases idempotently without automatically withdrawing anyone", async () => {
    yearId = (
      await pool.query(
        `SELECT id FROM academic_years WHERE school_id=$1 AND status='active'`,
        [schoolId],
      )
    ).rows[0].id;
    const classId = (
      await pool.query(
        `INSERT INTO classes(school_id,code,name,grade_order) VALUES($1,'TEST-G9','Test Class 9',9) RETURNING id`,
        [schoolId],
      )
    ).rows[0].id;
    seniorSection = (
      await pool.query(
        `INSERT INTO sections(school_id,academic_year_id,class_id,code,name) VALUES($1,$2,$3,'A','Section A') RETURNING id`,
        [schoolId, yearId, classId],
      )
    ).rows[0].id;
    await pool.query(
      `UPDATE enrollments SET class_id=$3,section_id=$4 WHERE school_id=$1 AND student_id=$2 AND enrollment_status='active'`,
      [schoolId, otherStudentId, classId, seniorSection],
    );
    const headId = (
      await pool.query(
        `SELECT id FROM fee_heads WHERE school_id=$1 AND code='TEST-EXTRA'`,
        [schoolId],
      )
    ).rows[0].id;
    for (const target of [studentId, otherStudentId])
      await pool.query(
        `INSERT INTO student_charges(school_id,student_id,academic_year_id,fee_head_id,description,amount,due_on) VALUES($1,$2,$3,$4,'Overdue test fee',100,current_date-90)`,
        [schoolId, target, yearId, headId],
      );
    expect(
      (await call("POST", "/student-policies/UP/review-overdue", admin, {}))
        .status,
    ).toBe(200);
    const reviews = await call("GET", "/student-policy-reviews");
    seniorCase = reviews.body.items.find(
      (row: any) => row.studentId === otherStudentId,
    ).id;
    elementaryCase = reviews.body.items.find(
      (row: any) => row.studentId === studentId,
    ).id;
    expect(
      (await call("POST", "/student-policies/UP/review-overdue", admin, {}))
        .body.created,
    ).toBe(0);
    expect(
      (
        await pool.query(`SELECT status FROM students WHERE id=$1`, [
          otherStudentId,
        ])
      ).rows[0].status,
    ).toBe("active");
    expect((await call("GET", "/student-policy-reviews", parent)).status).toBe(
      403,
    );
  });
  it("protects elementary enrolment and requires independent approval for a senior withdrawal", async () => {
    const decision = {
      decision: "withdraw",
      note: "Reviewed the applicable notices and school records.",
      authorityReference: "School approval and notice test reference",
    };
    expect(
      (
        await call(
          "POST",
          `/student-policy-reviews/${elementaryCase}/decide`,
          admin,
          decision,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "POST",
          `/student-policy-reviews/${seniorCase}/decide`,
          admin,
          decision,
        )
      ).status,
    ).toBe(403);
    const userId = (
      await pool.query(
        `INSERT INTO users(email,display_name,password_hash,status) SELECT 'reviewer@demo.test','Independent reviewer',password_hash,'active' FROM users WHERE email='admin@demo.test' RETURNING id`,
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,role_id,school_id,scope_type,reason) SELECT $1,id,$2,'school','Independent review fixture' FROM roles WHERE code='main_admin'`,
      [userId, schoolId],
    );
    reviewer = await login("reviewer@demo.test", "Admin@12345");
    expect(
      (
        await call(
          "POST",
          `/student-policy-reviews/${seniorCase}/decide`,
          reviewer,
          { ...decision, authorityReference: "" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "POST",
          `/student-policy-reviews/${seniorCase}/decide`,
          reviewer,
          decision,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await pool.query(`SELECT status FROM students WHERE id=$1`, [
          otherStudentId,
        ])
      ).rows[0].status,
    ).toBe("withdrawn");
  });
  it("readmits the same student with a new enrollment while retaining the admission number and ledger", async () => {
    const prior = (
      await pool.query(`SELECT admission_number FROM students WHERE id=$1`, [
        otherStudentId,
      ])
    ).rows[0].admission_number;
    const chargeCount = (
      await pool.query(
        `SELECT count(*)::int AS count FROM student_charges WHERE student_id=$1`,
        [otherStudentId],
      )
    ).rows[0].count;
    const startsOn = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const body = {
      sectionId: seniorSection,
      startsOn,
      note: "Readmission approved after checking school requirements.",
    };
    expect(
      (
        await call(
          "POST",
          `/student-policy-reviews/${seniorCase}/readmit`,
          admin,
          body,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "POST",
          `/student-policy-reviews/${seniorCase}/readmit`,
          admin,
          body,
        )
      ).status,
    ).toBe(409);
    const row = (
      await pool.query(
        `SELECT admission_number,status FROM students WHERE id=$1`,
        [otherStudentId],
      )
    ).rows[0];
    expect(row.admission_number).toBe(prior);
    expect(row.status).toBe("active");
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM enrollments WHERE student_id=$1 AND academic_year_id=$2`,
          [otherStudentId, yearId],
        )
      ).rows[0].count,
    ).toBe(2);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM student_charges WHERE student_id=$1`,
          [otherStudentId],
        )
      ).rows[0].count,
    ).toBe(chargeCount);
  });
});
