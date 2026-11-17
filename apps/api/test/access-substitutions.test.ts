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

describe("Access inspection and teacher replacement", () => {
  it("reports live grants and blocks parent and teacher access inspection", async () => {
    const id = (
      await pool.query("SELECT id FROM users WHERE email='teacher@demo.test'")
    ).rows[0].id;
    const report = await call("GET", `/users/${id}/access`);
    expect(report.status).toBe(200);
    expect(
      report.body.permissions.find(
        (p: any) => p.code === "attendance.student.record",
      ).granted,
    ).toBe(true);
    expect(
      report.body.permissions.find((p: any) => p.code === "access.roles.manage")
        .granted,
    ).toBe(false);
    expect((await call("GET", `/users/${id}/access`, parent)).status).toBe(403);
    expect((await call("GET", `/users/${id}/access`, teacher)).status).toBe(
      403,
    );
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [id]);
    const disabled = await call("GET", `/users/${id}/access`);
    expect(disabled.body.loginEnabled).toBe(false);
    expect(disabled.body.permissions.every((p: any) => !p.granted)).toBe(true);
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [id]);
  });
  it("validates eligibility, leave, workload and date before assigning a replacement", async () => {
    const slot = (
      await pool.query(
        `SELECT ts.*, (y.starts_on + ((ts.day_of_week-extract(isodow FROM y.starts_on)::int+7)%7))::text AS date
   FROM timetable_slots ts JOIN academic_years y ON y.id=ts.academic_year_id WHERE ts.school_id=$1 LIMIT 1`,
        [schoolId],
      )
    ).rows[0];
    expect(slot).toBeTruthy();
    const uid = (
      await pool.query(
        `INSERT INTO users(email,display_name,password_hash,status) SELECT 'replacement@demo.test','Replacement Teacher',password_hash,'active' FROM users LIMIT 1 RETURNING id`,
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,school_id,role_id,scope_type) SELECT $1,$2,id,'school' FROM roles WHERE code='teacher'`,
      [uid, schoolId],
    );
    const staff = (
      await pool.query(
        `INSERT INTO staff(school_id,user_id,employee_number,first_name,designation) VALUES($1,$2,'REPLACE-1','Replacement','Teacher') RETURNING id`,
        [schoolId, uid],
      )
    ).rows[0].id;
    const path = `/timetable/substitution-candidates?slotId=${slot.id}&date=${slot.date}`;
    let report = await call("GET", path);
    expect(report.status).toBe(200);
    expect(report.body.items.find((c: any) => c.userId === uid).eligible).toBe(
      false,
    );
    await pool.query(
      `INSERT INTO teacher_eligibility_profiles(school_id,staff_id,subject_id,min_grade_order,max_grade_order,qualification,max_weekly_periods) VALUES($1,$2,$3,0,99,'Verified test credential',30)`,
      [schoolId, staff, slot.subject_id],
    );
    report = await call("GET", path);
    expect(report.body.items.find((c: any) => c.userId === uid).eligible).toBe(
      true,
    );
    const payload = {
      slotId: slot.id,
      substitutionDate: slot.date,
      substituteTeacherUserId: uid,
      reason: "Original teacher absent",
    };
    expect(
      (await call("POST", "/timetable/substitutions", parent, payload)).status,
    ).toBe(403);
    expect(
      (await call("POST", "/timetable/substitutions", admin, payload)).status,
    ).toBe(201);
    await pool.query(
      `INSERT INTO staff_attendance(school_id,staff_id,work_date,status) VALUES($1,$2,$3,'absent')`,
      [schoolId, staff, slot.date],
    );
    expect(
      (await call("POST", "/timetable/substitutions", admin, payload)).status,
    ).toBe(400);
    await pool.query(
      `DELETE FROM staff_attendance WHERE school_id=$1 AND staff_id=$2`,
      [schoolId, staff],
    );
    await pool.query(
      `INSERT INTO leave_requests(school_id,staff_id,leave_type,starts_on,ends_on,reason,status,requested_by,reviewed_by,reviewed_at)
      VALUES($1,$2,'casual',$3,$3,'Approved absence','approved',$4,$4,now())`,
      [schoolId, staff, slot.date, uid],
    );
    expect(
      (await call("POST", "/timetable/substitutions", admin, payload)).status,
    ).toBe(400);
    await pool.query("DELETE FROM leave_requests WHERE staff_id=$1", [staff]);
    const section = (
      await pool.query(
        `INSERT INTO sections(school_id,academic_year_id,class_id,code,name)
      SELECT school_id,academic_year_id,class_id,'CLASH-TEST','Clash test' FROM sections WHERE id=$1 RETURNING id`,
        [slot.section_id],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO timetable_slots(school_id,academic_year_id,section_id,period_id,day_of_week,subject_id,teacher_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        schoolId,
        slot.academic_year_id,
        section,
        slot.period_id,
        slot.day_of_week,
        slot.subject_id,
        uid,
      ],
    );
    const outOfScope = await call(
      "POST",
      `/sections/${section}/period-attendance`,
      teacher,
      {
        date: slot.date,
        periodId: slot.period_id,
        subjectId: slot.subject_id,
        records: [],
      },
    );
    expect(outOfScope.status).toBe(404);
    const clash = await call(
      "POST",
      "/timetable/substitutions",
      admin,
      payload,
    );
    expect(clash.status).toBe(400);
    expect(JSON.stringify(clash.body)).toContain("Timetable clash");
    await pool.query("DELETE FROM timetable_slots WHERE teacher_user_id=$1", [
      uid,
    ]);
    await pool.query(
      `UPDATE teacher_eligibility_profiles SET max_weekly_periods=0 WHERE staff_id=$1`,
      [staff],
    );
    expect(
      (await call("POST", "/timetable/substitutions", admin, payload)).status,
    ).toBe(400);
    expect(
      (
        await call(
          "GET",
          `/timetable/substitution-candidates?slotId=${slot.id}&date=2020-01-01`,
        )
      ).status,
    ).toBe(400);
    expect((await call("GET", "/timetable/substitutions", parent)).status).toBe(
      403,
    );
  });
});
