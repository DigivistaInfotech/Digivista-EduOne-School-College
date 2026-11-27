import { randomBytes } from "node:crypto";
import { attendanceFromSpeech } from "../../web/src/lib/voiceAttendance";
import { studentStage } from "@erp/shared/student-stage";
import {
  encryptBiometricTemplate,
  decryptBiometricTemplate,
} from "../src/lib/biometrics";
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

describe("Institution masters, policy, scoped collection and truthful input", () => {
  it("preloads masters and persists staff IDs with canonical labels", async () => {
    const all = await call("GET", "/institution-masters");
    expect(all.status).toBe(200);
    const designation = all.body.items.find(
      (i: any) => i.kind === "designation" && i.code === "professor",
    );
    const department = all.body.items.find(
      (i: any) => i.kind === "department" && i.code === "academics",
    );
    expect(designation).toBeTruthy();
    const created = await call("POST", "/staff", admin, {
      firstName: "Master mapped",
      designation: "Client text must not override master",
      institutionType: "university",
      designationId: designation.id,
      departmentId: department.id,
      status: "active",
    });
    expect(created.status).toBe(201);
    expect(created.body.designation).toBe(designation.label);
    expect(created.body.designationId).toBe(designation.id);
    expect(created.body.departmentId).toBe(department.id);
    const invalid = await call("POST", "/staff", admin, {
      firstName: "Wrong mapping",
      designation: "Teacher",
      designationId: department.id,
    });
    expect(invalid.status).toBe(400);
    const principal = all.body.items.find(
      (i: any) => i.kind === "designation" && i.institutionType === "school",
    );
    expect(
      (
        await call("POST", "/staff", admin, {
          firstName: "Wrong institution",
          designation: "Teacher",
          institutionType: "university",
          designationId: principal.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/institution-masters", teacher, {
          kind: "designation",
          code: "custom_teacher",
          label: "Custom teacher",
        })
      ).status,
    ).toBe(403);
    const custom = await call("POST", "/institution-masters", admin, {
      kind: "designation",
      code: "custom_dean",
      label: "Custom Faculty Dean",
      institutionType: "university",
    });
    expect(custom.status).toBe(201);
    expect(
      (
        await call("POST", "/institution-masters", admin, {
          kind: "designation",
          code: "custom_dean",
          label: "Duplicate",
          institutionType: "university",
        })
      ).status,
    ).toBe(409);
  });
  it("keeps new leadership presets separate from account grants", async () => {
    const roles = await call("GET", "/roles");
    const principal = roles.body.items.find((r: any) => r.code === "principal");
    expect(principal.permissions).toContain("access.roles.inspect");
    expect(principal.permissions).not.toContain("access.roles.manage");
    const management = roles.body.items.find(
      (r: any) => r.code === "management",
    );
    expect(management.permissions).not.toContain(
      "hr.employee.salary.view_sensitive",
    );
    expect(
      roles.body.items.find((r: any) => r.code === "teacher_fee_collector")
        .defaultScopeType,
    ).toBe("section");
  });
  it('rejects scopes that lack record-level implementation',async()=>{
    const uid=(await pool.query("SELECT id FROM users WHERE email='teacher@demo.test'")).rows[0].id;
    const section=(await pool.query('SELECT id FROM sections WHERE school_id=$1 LIMIT 1',[schoolId])).rows[0].id;
    expect((await call('POST',`/users/${uid}/roles`,admin,{roleCode:'finance',scopeType:'section',scopeId:section,reason:'Synthetic boundary test'})).status).toBe(400);
    expect((await call('POST',`/users/${uid}/roles`,admin,{roleCode:'teacher',scopeType:'custom',scopeId:section,reason:'Synthetic boundary test'})).status).toBe(400);
  });
  it('does not let an unrelated school-wide role widen teacher section access',async()=>{
    const uid=(await pool.query("SELECT id FROM users WHERE email='teacher@demo.test'")).rows[0].id;
    const own=(await pool.query(`SELECT scope_id FROM user_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.user_id=$1 AND a.school_id=$2 AND r.code='teacher' AND a.scope_type='section' LIMIT 1`,[uid,schoolId])).rows[0].scope_id;
    const other=(await pool.query('SELECT id FROM sections WHERE school_id=$1 AND id<>$2 LIMIT 1',[schoolId,own])).rows[0].id;
    const granted=await call('POST',`/users/${uid}/roles`,admin,{roleCode:'hr',scopeType:'school',reason:'Synthetic combined role boundary test'});expect(granted.status).toBe(201);
    const today=new Date().toISOString().slice(0,10);
    expect((await call('GET',`/attendance/register?sectionId=${other}&date=${today}`,teacher)).status).toBe(404);
    const inspection=await call('GET',`/users/${uid}/access`);expect(inspection.body.permissions.find((p:any)=>p.code==='attendance.student.record').scopeTypes).toEqual(['section']);expect(inspection.body.permissions.find((p:any)=>p.code==='hr.employee.view').scopeTypes).toEqual(['school']);
  });
  it("validates policy authority and refuses penalty or termination automation", async () => {
    const baseline = (await call("GET", "/operating-policy")).body.policy;
    expect(
      (
        await call("PUT", "/operating-policy", admin, {
          ...baseline,
          automaticTermination: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PUT", "/operating-policy", admin, {
          ...baseline,
          collectionEnabled: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PUT", "/operating-policy", admin, {
          ...baseline,
          management: "private",
          feeCollectionMode: "assigned_teacher",
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("PUT", "/operating-policy", parent, baseline)).status,
    ).toBe(403);
  });
  it("scopes teacher collection, protects government elementary students and reuses the finance ledger", async () => {
    const uid = (
      await pool.query("SELECT id FROM users WHERE email='teacher@demo.test'")
    ).rows[0].id;
    const enrollment = (
      await pool.query(
        `SELECT e.* FROM enrollments e JOIN user_role_assignments a ON a.scope_id=e.section_id AND a.user_id=$2 WHERE e.school_id=$1 AND e.enrollment_status='active' LIMIT 1`,
        [schoolId, uid],
      )
    ).rows[0];
    expect(enrollment).toBeTruthy();
    expect((await call("GET", "/fee-collection", teacher)).status).toBe(403);
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,school_id,role_id,scope_type,scope_id) SELECT $1,$2,id,'section',$3 FROM roles WHERE code='teacher_fee_collector'`,
      [uid, schoolId, enrollment.section_id],
    );
    expect((await call("GET", "/fee-collection", teacher)).status).toBe(403);
    const baseline = (await call("GET", "/operating-policy")).body.policy;
    const date = new Date().toISOString().slice(0, 10);
    const effective = (
      await pool.query(
        "SELECT starts_on::text AS d FROM academic_years WHERE id=$1",
        [enrollment.academic_year_id],
      )
    ).rows[0].d;
    const policy = {
      ...baseline,
      management: "government",
      feeCollectionMode: "assigned_teacher",
      collectionEnabled: true,
      effectiveFrom: effective,
      authorityReference: "Synthetic school-authorised policy for testing only",
    };
    expect((await call("PUT", "/operating-policy", admin, policy)).status).toBe(
      200,
    );
    const list = await call("GET", "/fee-collection", teacher);
    expect(list.status).toBe(200);
    expect(
      list.body.students.every(
        (i: any) => i.sectionId === enrollment.section_id,
      ),
    ).toBe(true);
    const payload = {
      studentId: enrollment.student_id,
      amount: 1,
      reference: "TEST-COLLECTION-01",
      date,
      method: "cash",
    };
    expect(
      (await call("POST", "/fee-collection", teacher, payload)).status,
    ).toBe(400);
    await pool.query("UPDATE classes SET grade_order=9 WHERE id=$1", [
      enrollment.class_id,
    ]);
    const head = (
      await pool.query(
        `INSERT INTO fee_heads(school_id,code,name) VALUES($1,'TEST_COLLECTION','Synthetic collection charge') RETURNING id`,
        [schoolId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO student_charges(school_id,student_id,academic_year_id,fee_head_id,description,amount,due_on) VALUES($1,$2,$3,$4,'Synthetic approved upper-school charge',100,$5)`,
      [
        schoolId,
        enrollment.student_id,
        enrollment.academic_year_id,
        head,
        effective,
      ],
    );

    const before = (
      await call(
        "GET",
        `/fee-collection/${enrollment.student_id}/ledger`,
        teacher,
      )
    ).body;
    expect(before.balance).toBeGreaterThan(0);
    const recorded = await call("POST", "/fee-collection", teacher, payload);
    expect(recorded.status).toBe(201);
    expect(recorded.body.status).toBe("pending");
    const after = (
      await call(
        "GET",
        `/fee-collection/${enrollment.student_id}/ledger`,
        teacher,
      )
    ).body;
    expect(after.totalPaid).toBe(before.totalPaid);
    const pending = (
      await call("GET", "/fee-collection", teacher)
    ).body.entries.find((e: any) => e.id === recorded.body.id);
    expect(pending.reference).toBe(payload.reference);
    expect(
      (await call("POST", "/fee-collection", teacher, payload)).status,
    ).toBe(409);
    const outsider = (
      await pool.query(
        `SELECT student_id FROM enrollments WHERE school_id=$1 AND section_id<>$2 LIMIT 1`,
        [schoolId, enrollment.section_id],
      )
    ).rows[0];
    if (outsider)
      expect(
        (
          await call(
            "GET",
            `/fee-collection/${outsider.student_id}/ledger`,
            teacher,
          )
        ).status,
      ).toBe(404);
    await call("PUT", "/operating-policy", admin, {
      ...policy,
      management: "private",
      feeCollectionMode: "central",
    });
    expect(
      (
        await call(
          "GET",
          `/fee-collection/${enrollment.student_id}/ledger`,
          teacher,
        )
      ).status,
    ).toBe(403);
  });
  it('uses original due dates, cumulative deltas and caps without fining elementary government students',async()=>{
    const finance=await login('finance@demo.test','Finance@12345');
    const enrollment=(await pool.query(`SELECT e.* FROM enrollments e JOIN academic_years y ON y.id=e.academic_year_id AND y.status='active' WHERE e.school_id=$1 AND e.enrollment_status='active' LIMIT 1`,[schoolId])).rows[0];
    const head=(await pool.query(`INSERT INTO fee_heads(school_id,code,name) VALUES($1,'LATE_TEST_BASE','Synthetic late assessment base') RETURNING id`,[schoolId])).rows[0].id;
    const charge=(await pool.query(`INSERT INTO student_charges(school_id,student_id,academic_year_id,fee_head_id,description,amount,due_on) VALUES($1,$2,$3,$4,'Synthetic due-date test',100,'2026-06-01') RETURNING id`,[schoolId,enrollment.student_id,enrollment.academic_year_id,head])).rows[0].id;
    const rule=(await call('POST','/fee-late-rules',finance,{name:'Synthetic cumulative late policy',graceDays:0,percentPerMonth:1,maxAmount:2.5,active:true}));expect(rule.status).toBe(201);
    const run=async(date:string)=>{const result=await call('POST','/fees/late-fees/run',finance,{ruleId:rule.body.id,asOf:date,academicYearId:enrollment.academic_year_id});expect(result.status).toBe(200);return Number((await pool.query(`SELECT coalesce(sum(fee_amount),0) AS amount FROM late_fee_assessments WHERE school_id=$1 AND charge_id=$2`,[schoolId,charge])).rows[0].amount);};
    expect(await run('2026-06-16')).toBe(1);expect(await run('2026-06-17')).toBe(1);expect(await run('2026-07-02')).toBe(2);expect(await run('2026-08-05')).toBe(2.5);expect(await run('2026-09-10')).toBe(2.5);
    const baseline=(await call('GET','/operating-policy')).body.policy;
    await call('PUT','/operating-policy',admin,{...baseline,management:'government',feeCollectionMode:'central'});
    await pool.query('UPDATE classes SET grade_order=1 WHERE id=$1',[enrollment.class_id]);
    expect(await run('2026-10-10')).toBe(2.5);
    const central=(await call('GET','/student-policies/UP')).body;
    expect(central.managementManagedCentrally).toBe(true);expect(central.policy.management).toBe('government');
    expect((await call('PUT','/student-policies/UP',admin,{...central.policy,management:'private'})).status).toBe(400);
    await call('PUT','/operating-policy',admin,baseline);
  });
  it("parses only unambiguous voice drafts and never invents a student stage", () => {
    expect(attendanceFromSpeech("yes")).toBe("present");
    expect(attendanceFromSpeech("हाँ")).toBe("present");
    expect(attendanceFromSpeech("नहीं")).toBe("absent");
    expect(attendanceFromSpeech("no")).toBe("absent");
    expect(attendanceFromSpeech("yes no")).toBeNull();
    expect(attendanceFromSpeech("maybe")).toBeNull();
    expect(attendanceFromSpeech("not present")).toBeNull();
    expect(studentStage(2)).toBe("primary_nursery_g2");
    expect(studentStage(5)).toBe("elementary_g3_g5");
    expect(studentStage(8)).toBe("middle_g6_g8");
    expect(studentStage(12)).toBe("senior_g9_g12");
    expect(studentStage(null)).toBe("unclassified");
  });
  it("requires a configured biometric key and rejects ciphertext tampering", () => {
    const previous = process.env.BIOMETRIC_ENCRYPTION_KEY;
    try {
      delete process.env.BIOMETRIC_ENCRYPTION_KEY;
      expect(() => encryptBiometricTemplate("synthetic")).toThrow(
        "BIOMETRIC_ENCRYPTION_KEY",
      );
      const key = randomBytes(32).toString("hex");
      const ciphertext = encryptBiometricTemplate("synthetic", key);
      expect(decryptBiometricTemplate(ciphertext, key)).toBe("synthetic");
      expect(() =>
        decryptBiometricTemplate(ciphertext, randomBytes(32).toString("hex")),
      ).toThrow();
    } finally {
      if (previous) process.env.BIOMETRIC_ENCRYPTION_KEY = previous;
    }
  });
});
