import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: FastifyInstance;
let pool: pg.Pool;
let stop: () => Promise<void>;
let schoolId: string;
let admin: string;
let teacher: string;
let parent: string;
async function call(
  method: "GET" | "POST" | "PUT" | "PATCH",
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
  admin = await login("admin@demo.test", "Admin@12345");
  teacher = await login("teacher@demo.test", "Teacher@12345");
  parent = await login("parent@demo.test", "Parent@12345");
});
afterAll(async () => {
  await app?.close();
  const { closePool } = await import("../src/db");
  await closePool();
  await stop?.();
});

describe("Supplemental academic planning", () => {
  let classId: string,
    targetClassId: string,
    sectionId: string,
    otherSchool: string,
    otherMaster: string;
  let lookups: any, teacherId: string;
  it("preloads academic references for existing and future institutions and protects staff lookups", async () => {
    lookups = (await call("GET", "/academic/profile-lookups")).body;
    expect(lookups.masters.some((m: any) => m.kind === "academic_stage")).toBe(
      true,
    );
    expect(lookups.masters.some((m: any) => m.kind === "language_medium")).toBe(
      true,
    );
    expect(
      (await call("GET", "/academic/profile-lookups", parent)).status,
    ).toBe(403);
    teacherId = (
      await pool.query("SELECT id FROM users WHERE email='teacher@demo.test'")
    ).rows[0].id;
    sectionId = (
      await pool.query(
        `SELECT scope_id FROM user_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.school_id=$1 AND a.user_id=$2 AND r.code='teacher' AND a.scope_type='section' AND a.revoked_at IS NULL LIMIT 1`,
        [schoolId, teacherId],
      )
    ).rows[0].scope_id;
    classId = (
      await pool.query("SELECT class_id FROM sections WHERE id=$1", [sectionId])
    ).rows[0].class_id;
    targetClassId = (
      await pool.query(
        `INSERT INTO classes(school_id,code,name,grade_order) VALUES($1,'PROFILE-NEXT','Profile next class',2) RETURNING id`,
        [schoolId],
      )
    ).rows[0].id;
    otherSchool = (
      await pool.query(
        `INSERT INTO schools(code,name) VALUES('PROFILE-OTHER','Other institution') RETURNING id`,
      )
    ).rows[0].id;
    otherMaster = (
      await pool.query(
        `SELECT id FROM institution_masters WHERE school_id=$1 AND kind='academic_stage' LIMIT 1`,
        [otherSchool],
      )
    ).rows[0].id;
    expect(
      Number(
        (
          await pool.query(
            `SELECT count(*) FROM library_categories WHERE school_id=$1`,
            [otherSchool],
          )
        ).rows[0].count,
      ),
    ).toBeGreaterThan(0);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM fee_heads WHERE school_id=$1 AND code='TRANSPORT'`,
          [otherSchool],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("saves optional class metadata without granting roles and rejects cross-tenant masters and promotion cycles", async () => {
    const stageId = lookups.masters.find(
      (m: any) => m.kind === "academic_stage",
    ).id;
    const mediumId = lookups.masters.find(
      (m: any) => m.kind === "language_medium",
    ).id;
    const before = Number(
      (
        await pool.query(
          "SELECT count(*) FROM user_role_assignments WHERE user_id=$1",
          [teacherId],
        )
      ).rows[0].count,
    );
    const body = {
      stageId,
      mediumId,
      stream: "General",
      coordinatorUserId: teacherId,
      nextClassId: targetClassId,
    };
    expect(
      (await call("PUT", `/classes/${classId}/profile`, teacher, body)).status,
    ).toBe(403);
    expect(
      (await call("PUT", `/classes/${classId}/profile`, admin, body)).status,
    ).toBe(200);
    const profile = (await call("GET", `/classes/${classId}/profile`)).body;
    expect(profile.nextClassId).toBe(targetClassId);
    expect(Array.isArray(profile.capacitySummary)).toBe(true);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM user_role_assignments WHERE user_id=$1",
            [teacherId],
          )
        ).rows[0].count,
      ),
    ).toBe(before);
    expect(
      (
        await call("PUT", `/classes/${targetClassId}/profile`, admin, {
          nextClassId: classId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PUT", `/classes/${targetClassId}/profile`, admin, {
          stageId: otherMaster,
        })
      ).status,
    ).toBe(400);
    const foreign = (
      await pool.query(
        `INSERT INTO classes(school_id,code,name) VALUES($1,'FOREIGN','Foreign class') RETURNING id`,
        [otherSchool],
      )
    ).rows[0].id;
    expect(
      (
        await call("PUT", `/classes/${targetClassId}/profile`, admin, {
          nextClassId: foreign,
        })
      ).status,
    ).toBe(404);
  });
  it("maps teacher/location details and future sections while deriving seats from central enrollments", async () => {
    const source = (
      await pool.query(
        `SELECT s.academic_year_id,y.ends_on::text AS ends_on FROM sections s JOIN academic_years y ON y.id=s.academic_year_id WHERE s.id=$1`,
        [sectionId],
      )
    ).rows[0];
    const nextYear = (
      await pool.query(
        `INSERT INTO academic_years(school_id,code,name,starts_on,ends_on) VALUES($1,'PROFILE-FUTURE','Profile future',($2::date+1),($2::date+365)) RETURNING id,starts_on::text`,
        [schoolId, source.ends_on],
      )
    ).rows[0];
    const nextSection = (
      await pool.query(
        `INSERT INTO sections(school_id,academic_year_id,class_id,code,name,capacity) VALUES($1,$2,$3,'PLAN-A','Plan A',20) RETURNING id`,
        [schoolId, nextYear.id, targetClassId],
      )
    ).rows[0].id;
    const body = {
      classTeacherUserId: teacherId,
      shiftId: lookups.masters.find((m: any) => m.kind === "academic_shift").id,
      roomId: lookups.rooms[0]?.id ?? null,
      nextSectionId: nextSection,
    };
    expect(
      (await call("PUT", `/sections/${sectionId}/profile`, admin, body)).status,
    ).toBe(200);
    expect(
      (
        await call("PUT", `/sections/${sectionId}/profile`, admin, {
          ...body,
          coTeacherUserId: teacherId,
        })
      ).status,
    ).toBe(400);
    const initial = (
      await call("GET", `/sections/${sectionId}/profile`, teacher)
    ).body;
    const added = (
      await pool.query(
        `INSERT INTO students(school_id,admission_number,first_name,status) VALUES($1,'PROFILE-ADD','Additional pupil','active') RETURNING id`,
        [schoolId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,starts_on) SELECT $1,$2,academic_year_id,class_id,id,'2026-04-01' FROM sections WHERE id=$3`,
      [schoolId, added, sectionId],
    );
    const changed = (
      await call("GET", `/sections/${sectionId}/profile`, teacher)
    ).body;
    expect(changed.enrolled).toBe(initial.enrolled + 1);
    expect(changed.availableSeats).toBe(
      changed.capacity === null
        ? null
        : Math.max(0, changed.capacity - changed.enrolled),
    );
    expect(
      (await call("GET", `/sections/${nextSection}/profile`, teacher)).status,
    ).toBe(404);
    expect(
      (
        await call("PUT", `/sections/${sectionId}/profile`, admin, {
          ...body,
          nextSectionId: sectionId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "PATCH",
          `/academic-years/${source.academic_year_id}`,
          admin,
          { endsOn: nextYear.starts_on },
        )
      ).status,
    ).toBe(400);
  });
  it("keeps class-scoped managers within their class and makes year-wide plans read-only", async () => {
    // Exercise a permission-bearing teacher/class scope without granting a
    // school-wide coordinator role. These grants exist only in this test DB.
    await pool.query(
      `INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN('academic.class.manage','academic.year.manage') WHERE r.code='teacher' ON CONFLICT DO NOTHING`,
    );
    const legacy = (
      await pool.query(
        `INSERT INTO users(email,display_name,password_hash,status) SELECT 'academic-scoped@demo.test','Scoped academic teacher',password_hash,'active' FROM users WHERE email='teacher@demo.test' RETURNING id`,
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,school_id,role_id,scope_type,scope_id) SELECT $1,$2,id,'class',$3 FROM roles WHERE code='teacher'`,
      [legacy.id, schoolId, classId],
    );
    const scoped = await login("academic-scoped@demo.test", "Teacher@12345");
    const current = (await call("GET", `/classes/${classId}/profile`, scoped))
      .body;
    expect(current.canEdit).toBe(true);
    expect(
      (
        await call("PUT", `/classes/${classId}/profile`, scoped, {
          stageId: current.stageId,
          mediumId: current.mediumId,
          coordinatorUserId: current.coordinatorUserId,
          nextClassId: current.nextClassId,
          stream: "Scoped plan",
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("GET", `/classes/${targetClassId}/profile`, scoped)).body
        .canEdit,
    ).toBe(false);
    expect(
      (
        await call("PUT", `/classes/${targetClassId}/profile`, scoped, {
          stream: "Outside scope",
        })
      ).status,
    ).toBe(404);
    const y = (
      await pool.query(
        `SELECT id,starts_on::text,ends_on::text FROM academic_years WHERE school_id=$1 AND status='active'`,
        [schoolId],
      )
    ).rows[0];
    const plan = await call("GET", `/academic-years/${y.id}/plan`, scoped);
    expect(plan.body.canManageYearPlan).toBe(false);
    expect(plan.body.readiness).toEqual([]);
    expect(
      (
        await call("POST", `/academic-years/${y.id}/terms`, scoped, {
          code: "DENY",
          name: "Denied term",
          sequenceNo: 10,
          startsOn: y.starts_on,
          endsOn: y.ends_on,
        })
      ).status,
    ).toBe(404);
    await pool.query(
      `DELETE FROM role_permissions rp USING roles r,permissions p WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.code='teacher' AND p.code IN('academic.class.manage','academic.year.manage')`,
    );
  });

  it("uses real terms and shared holidays with date checks and read-only closure counts", async () => {
    const year = (
      await pool.query(
        `INSERT INTO academic_years(school_id,code,name,starts_on,ends_on) VALUES($1,'PROFILE-CALENDAR','Profile calendar','2030-04-01','2031-03-31') RETURNING id`,
        [schoolId],
      )
    ).rows[0].id;
    const term = {
      code: "T1",
      name: "Term One",
      startsOn: "2030-04-01",
      endsOn: "2030-09-30",
      sequenceNo: 1,
    };
    const first = await call(
      "POST",
      `/academic-years/${year}/terms`,
      admin,
      term,
    );
    expect(first.status).toBe(201);
    expect(
      (
        await call("POST", `/academic-years/${year}/terms`, teacher, {
          ...term,
          code: "T2",
          sequenceNo: 2,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("POST", `/academic-years/${year}/terms`, admin, {
          ...term,
          code: "T2",
          sequenceNo: 2,
          startsOn: "2030-09-29",
          endsOn: "2031-03-31",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", `/academic-years/${year}/terms`, admin, {
          ...term,
          code: "OUT",
          sequenceNo: 3,
          startsOn: "2029-09-01",
        })
      ).status,
    ).toBe(400);
    const holiday = await call(
      "POST",
      `/academic-years/${year}/holidays`,
      admin,
      { name: "Calendar planning day", holidayOn: "2030-08-15" },
    );
    expect(holiday.status).toBe(201);
    expect(
      (
        await call("POST", `/academic-years/${year}/holidays`, admin, {
          name: "Outside year",
          holidayOn: "2032-01-01",
        })
      ).status,
    ).toBe(400);
    const shared = await call("GET", "/holidays?year=2030", teacher);
    expect(shared.body.items.some((h: any) => h.id === holiday.body.id)).toBe(
      true,
    );
    const plan = await call("GET", `/academic-years/${year}/plan`);
    expect(plan.status).toBe(200);
    expect(plan.body.terms).toHaveLength(1);
    expect(plan.body.holidays.some((h: any) => h.id === holiday.body.id)).toBe(
      true,
    );
    expect(
      plan.body.readiness.every(
        (c: any) => c.count === null || Number.isInteger(c.count),
      ),
    ).toBe(true);
    const teacherPlan = await call(
      "GET",
      `/academic-years/${year}/plan`,
      teacher,
    );
    expect(teacherPlan.body.readiness).toEqual([]);
    expect(
      (
        await call("PATCH", `/academic-years/${year}`, admin, {
          startsOn: "2030-05-01",
        })
      ).status,
    ).toBe(400);
    await pool.query(
      `UPDATE academic_years SET status='archived' WHERE id=$1`,
      [year],
    );
    expect(
      (
        await call(
          "PUT",
          `/academic-years/${year}/terms/${first.body.id}`,
          admin,
          term,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM audit_events WHERE school_id=$1 AND action='academic.term_created'`,
          [schoolId],
        )
      ).rowCount,
    ).toBeGreaterThan(0);
  });
});
