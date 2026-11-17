import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { libraryMemberCode } from "@erp/shared/library-identity";

let app: FastifyInstance,
  pool: pg.Pool,
  stop: () => Promise<void>,
  schoolId: string,
  admin: string;
async function login(email: string, password: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(r.statusCode).toBe(200);
  return String(r.headers["set-cookie"]).split(";")[0]!;
}
async function call(
  method: "GET" | "POST" | "PATCH",
  path: string,
  payload?: unknown,
  cookie = admin,
) {
  const r = await app.inject({
    method,
    url: `/api/schools/${schoolId}/library${path}`,
    headers: { cookie, origin: "http://localhost:5173" },
    payload: payload as never,
  });
  return { status: r.statusCode, body: JSON.parse(r.body) };
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
  schoolId = (await pool.query("SELECT id FROM schools LIMIT 1")).rows[0].id;
  admin = await login("admin@demo.test", "Admin@12345");
});
afterAll(async () => {
  await app?.close();
  const { closePool } = await import("../src/db");
  await closePool();
  await stop?.();
});
async function student(number: string) {
  return (
    await pool.query(
      "INSERT INTO students(school_id,admission_number,first_name,status) VALUES($1,$2,'Circulation test','active') RETURNING id",
      [schoolId, number],
    )
  ).rows[0].id as string;
}
async function membership(id: string, kind: "student" | "staff" = "student") {
  const old = (
    await pool.query(
      `SELECT id,member_code FROM library_members WHERE school_id=$1 AND ${kind === "student" ? "student_id" : "staff_id"}=$2`,
      [schoolId, id],
    )
  ).rows[0];
  if (old) return { id: old.id, memberCode: old.member_code };
  const r = await call("POST", "/members", {
    [kind === "student" ? "studentId" : "staffId"]: id,
  });
  expect(r.status).toBe(201);
  return r.body;
}
async function copy(title: string, status = "active") {
  const b = await call("POST", "/books", {
    title,
    status,
    copies: 1,
    bookType: "non_academic",
  });
  expect(b.status).toBe(201);
  const c = await call("GET", `/books/${b.body.id}/copies`);
  expect(c.status).toBe(200);
  return c.body.items[0].id as string;
}
describe("Central member identity and physical copy mapping", () => {
  it("derives student/staff codes from central records, keeps links unique and preserves existing codes", async () => {
    const id = await student("CENTRAL-STUDENT-1");
    const m = await membership(id);
    expect(m.memberCode).toBe("STU-CENTRAL-STUDENT-1");
    const staff = (
      await pool.query(
        "SELECT id,employee_number FROM staff WHERE school_id=$1 LIMIT 1",
        [schoolId],
      )
    ).rows[0];
    const sm = await membership(staff.id, "staff");
    expect(sm.memberCode).toBe(
      libraryMemberCode("staff", staff.employee_number, staff.id),
    );
    expect((await call("POST", "/members", { studentId: id })).status).toBe(
      409,
    );
    await pool.query(
      "UPDATE library_members SET member_code='LEGACY-KEEP' WHERE id=$1",
      [m.id],
    );
    expect(
      (
        await call("PATCH", `/members/${m.id}`, {
          borrowingLimit: 3,
          status: "active",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT member_code FROM library_members WHERE id=$1",
          [m.id],
        )
      ).rows[0].member_code,
    ).toBe("LEGACY-KEEP");
    const longId = await student("A".repeat(60));
    const long = await membership(longId);
    expect(long.memberCode).toBe(`STU-${longId.replaceAll("-", "")}`);
    expect(long.memberCode.length).toBeLessThanOrEqual(40);
  });
  it("issues only active physical copies to active linked people, rejects past dates and prevents duplicate checkout", async () => {
    const s1 = await student("ISSUE-ONE"),
      s2 = await student("ISSUE-TWO");
    const m1 = await membership(s1),
      m2 = await membership(s2);
    const physical = await copy("Physical circulation mapping");
    expect(
      (
        await call("POST", "/loans", {
          copyId: physical,
          memberId: m1.id,
          dueOn: "2000-01-01",
        })
      ).status,
    ).toBe(400);
    const results = await Promise.all([
      call("POST", "/loans", { copyId: physical, memberId: m1.id }),
      call("POST", "/loans", { copyId: physical, memberId: m2.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM library_loans WHERE copy_id=$1 AND returned_on IS NULL",
            [physical],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    const inactiveBook = await copy("Inactive catalogue title", "inactive");
    expect(
      (await call("POST", "/loans", { copyId: inactiveBook, memberId: m2.id }))
        .status,
    ).toBe(409);
    const second = await copy("Active title for inactive central student");
    await pool.query("UPDATE students SET status='inactive' WHERE id=$1", [s2]);
    expect(
      (await call("POST", "/loans", { copyId: second, memberId: m2.id }))
        .status,
    ).toBe(409);
    expect(
      (
        await call("POST", "/loans", {
          copyId: second,
          memberId: "00000000-0000-4000-8000-000000000099",
        })
      ).status,
    ).toBe(404);
  });
  it("enforces the circulation permission section scope when a teacher is delegated checkout", async () => {
    await pool.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='teacher' AND p.code='library.circulation.manage' ON CONFLICT DO NOTHING",
    );
    const assigned = (
      await pool.query(
        "SELECT ura.scope_id FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id WHERE r.code='teacher' AND ura.school_id=$1 AND ura.scope_type='section' LIMIT 1",
        [schoolId],
      )
    ).rows[0].scope_id;
    const own = (
      await pool.query(
        "SELECT student_id FROM enrollments WHERE school_id=$1 AND section_id=$2 AND enrollment_status='active' LIMIT 1",
        [schoolId, assigned],
      )
    ).rows[0].student_id;
    const other = (
      await pool.query(
        "SELECT student_id FROM enrollments WHERE school_id=$1 AND section_id<>$2 AND enrollment_status='active' LIMIT 1",
        [schoolId, assigned],
      )
    ).rows[0].student_id;
    const ownMember = await membership(own),
      otherMember = await membership(other);
    const available = await copy("Scoped checkout regression");
    const teacher = await login("teacher@demo.test", "Teacher@12345");
    expect(
      (
        await call(
          "POST",
          "/loans",
          { copyId: available, memberId: otherMember.id },
          teacher,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "POST",
          "/loans",
          { copyId: available, memberId: ownMember.id },
          teacher,
        )
      ).status,
    ).toBe(201);
  });
});
