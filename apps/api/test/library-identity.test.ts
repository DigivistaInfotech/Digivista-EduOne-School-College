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

describe("Class catalogue and central student identity", () => {
  it("saves audited year-specific subject offerings without inventing teaching assignments and rejects unauthorised or foreign references", async () => {
    const masters = await call("GET", "/subject-offerings");
    expect(masters.status).toBe(200);
    const academicYearId = masters.body.years.find(
      (y: any) => y.status === "active",
    ).id;
    const classIds = masters.body.classes
      .filter((c: any) => c.status === "active")
      .slice(0, 2)
      .map((c: any) => c.id);
    expect(classIds.length).toBe(2);
    const subjectId = (
      await pool.query(
        "INSERT INTO subjects(school_id,code,name) VALUES($1,'BIO-OFFERINGS','Biology offerings regression') RETURNING id",
        [schoolId],
      )
    ).rows[0].id;
    const path = `/subjects/${subjectId}/class-offerings`;
    const foreignSchool = (await pool.query("INSERT INTO schools(code,name) VALUES('FOREIGN-OFFERING','Foreign offering test school') RETURNING id")).rows[0].id;
    const foreignClass = (await pool.query("INSERT INTO classes(school_id,code,name) VALUES($1,'FOREIGN','Foreign class') RETURNING id",[foreignSchool])).rows[0].id;
    expect((await call("PUT",path,admin,{academicYearId,classIds:[foreignClass]})).status).toBe(404);
    expect(
      (await call("PUT", path, teacher, { academicYearId, classIds })).status,
    ).toBe(403);
    expect(
      (
        await call("PUT", path, admin, {
          academicYearId,
          classIds: ["00000000-0000-4000-8000-000000000099"],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("PUT", path, admin, {
          academicYearId: "00000000-0000-4000-8000-000000000099",
          classIds,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("PUT", path, admin, { academicYearId, classIds })).status,
    ).toBe(200);
    const lookup = (
      await call("GET", "/library/classifications")
    ).body.subjects.find((s: any) => s.id === subjectId);
    expect([...lookup.classIds].sort()).toEqual([...classIds].sort());
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM teaching_assignments WHERE school_id=$1 AND subject_id=$2",
          [schoolId, subjectId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await call("POST", "/library/books", admin, {
          title: "Explicit offering book",
          bookType: "academic",
          subjectId,
          classIds,
          copies: 0,
        })
      ).status,
    ).toBe(201);
    const audit = (
      await pool.query(
        "SELECT after_state FROM audit_events WHERE school_id=$1 AND entity_id=$2 AND action='subject.offerings.updated'",
        [schoolId, subjectId],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].after_state.academicYearId).toBe(academicYearId);
    expect(
      (await call("PUT", path, admin, { academicYearId, classIds: [] })).status,
    ).toBe(200);
    expect(
      (await call("GET", "/library/classifications")).body.subjects.find(
        (s: any) => s.id === subjectId,
      ).classIds,
    ).toEqual([]);
  });
  it("uses recorded subject-class assignments and rejects unrelated classes without guessing from subject names", async () => {
    const section = (
      await pool.query(
        `SELECT s.id,s.class_id,s.academic_year_id,y.starts_on FROM sections s JOIN academic_years y ON y.id=s.academic_year_id AND y.school_id=s.school_id WHERE s.school_id=$1 AND y.status='active' ORDER BY s.id LIMIT 1`,
        [schoolId],
      )
    ).rows[0];
    const unrelated = (
      await pool.query(
        `SELECT id FROM classes WHERE school_id=$1 AND status='active' AND id<>$2 LIMIT 1`,
        [schoolId, section.class_id],
      )
    ).rows[0].id;
    const subject = (
      await pool.query(
        `INSERT INTO subjects(school_id,code,name) VALUES($1,'LIB-BIO-MAP','Biology mapping test') RETURNING id`,
        [schoolId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO teaching_assignments(school_id,user_id,academic_year_id,section_id,subject_id,valid_from)
      SELECT $1,id,$2,$3,$4,$5 FROM users WHERE email='teacher@demo.test'`,
      [
        schoolId,
        section.academic_year_id,
        section.id,
        subject,
        section.starts_on,
      ],
    );
    const lookup = await call("GET", "/library/classifications");
    expect(
      lookup.body.subjects.find((s: any) => s.id === subject).classIds,
    ).toEqual([section.class_id]);
    const input = {
      title: "Mapped biology reference",
      bookType: "academic",
      subjectId: subject,
      classIds: [unrelated],
      copies: 0,
    };
    expect((await call("POST", "/library/books", admin, input)).status).toBe(
      400,
    );
    const saved = await call("POST", "/library/books", admin, {
      ...input,
      classIds: [section.class_id],
    });
    expect(saved.status).toBe(201);
    expect(
      (
        await call("PATCH", `/library/books/${saved.body.id}`, admin, {
          classIds: [unrelated],
        })
      ).status,
    ).toBe(400);
    await pool.query(
      "DELETE FROM teaching_assignments WHERE school_id=$1 AND subject_id=$2",
      [schoolId, subject],
    );
    expect(
      (
        await call("PATCH", `/library/books/${saved.body.id}`, admin, {
          edition: "Retain legacy mapping",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", "/library/books", admin, {
          ...input,
          classIds: [section.class_id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/library/books", admin, {
          ...input,
          title: "Shared biology reading",
          bookType: "non_academic",
          classIds: [],
        })
      ).status,
    ).toBe(201);
  });
  it("provides category masters and scoped classification lookups without inventing stock", async () => {
    const cats = await call("GET", "/library/categories");
    expect(cats.status).toBe(200);
    expect(
      cats.body.items.some((c: any) => c.code === "ACADEMIC_TEXTBOOKS"),
    ).toBe(true);
    expect(cats.body.items.some((c: any) => c.code === "STORIES_FICTION")).toBe(
      true,
    );
    const lookup = await call("GET", "/library/classifications", teacher);
    expect(lookup.status).toBe(200);
    expect(lookup.body.classes.length).toBeGreaterThan(0);
    expect((await call("GET", "/library/classifications", parent)).status).toBe(
      403,
    );
  });
  it("requires academic class mapping and filters academic plus shared reading correctly", async () => {
    const classes = (await call("GET", "/library/classifications")).body
      .classes;
    const c1 = classes[0].id,
      c2 = classes[1].id;
    expect(
      (
        await call("POST", "/library/books", admin, {
          title: "Unmapped academic test",
          bookType: "academic",
          copies: 0,
        })
      ).status,
    ).toBe(400);
    const a = await call("POST", "/library/books", admin, {
      title: "Mapped class academic",
      bookType: "academic",
      classIds: [c1],
      edition: "2026",
      sourceUrl: "https://ncert.nic.in/textbook.php",
      copies: 0,
    });
    expect(a.status).toBe(201);
    const b = await call("POST", "/library/books", admin, {
      title: "Another class academic",
      bookType: "academic",
      classIds: [c2],
      copies: 0,
    });
    expect(b.status).toBe(201);
    const shared = await call("POST", "/library/books", admin, {
      title: "Shared stories test",
      bookType: "non_academic",
      classIds: [],
      copies: 0,
    });
    expect(shared.status).toBe(201);
    const legacy = await call("POST", "/library/books", admin, {
      title: "Legacy unclassified test",
      copies: 0,
    });
    expect(legacy.status).toBe(201);
    const selected = (await call("GET", `/library/books?classId=${c1}`)).body
      .items;
    expect(selected.some((r: any) => r.id === a.body.id)).toBe(true);
    expect(selected.some((r: any) => r.id === shared.body.id)).toBe(true);
    expect(selected.some((r: any) => r.id === b.body.id)).toBe(false);
    expect(selected.some((r: any) => r.id === legacy.body.id)).toBe(false);
    const book = selected.find((r: any) => r.id === a.body.id);
    expect(book.totalCopies).toBe(0);
    expect(book.classIds).toEqual([c1]);
    expect(book.sourceUrl).toBe("https://ncert.nic.in/textbook.php");
    expect(
      (
        await call("PATCH", `/library/books/${a.body.id}`, admin, {
          edition: "2026 revised",
        })
      ).status,
    ).toBe(200);
    const retained = (await call("GET", "/library/books")).body.items.find(
      (r: any) => r.id === a.body.id,
    );
    expect(retained.classIds).toEqual([c1]);
    expect(retained.bookType).toBe("academic");
    expect(
      (
        await call("PATCH", `/library/books/${a.body.id}`, admin, {
          title: "Must roll back",
          classIds: [],
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("GET", "/library/books")).body.items.find(
        (r: any) => r.id === a.body.id,
      ).title,
    ).toBe("Mapped class academic");
    expect(
      (
        await call("PATCH", `/library/books/${a.body.id}`, admin, {
          categoryId: "00000000-0000-4000-8000-000000000001",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("POST", "/library/books", admin, {
          title: "Unsafe source",
          sourceUrl: "javascript:alert(1)",
          copies: 0,
        })
      ).status,
    ).toBe(400);
  });
  it("reuses central memberships and limits borrowing records to assigned sections", async () => {
    const teacherId = (
      await pool.query("SELECT id FROM users WHERE email='teacher@demo.test'")
    ).rows[0].id;
    const scope = (
      await pool.query(
        `SELECT scope_id FROM user_role_assignments WHERE school_id=$1 AND user_id=$2 AND scope_type='section' AND revoked_at IS NULL LIMIT 1`,
        [schoolId, teacherId],
      )
    ).rows[0].scope_id;
    const sections = (
      await pool.query(
        "SELECT id,class_id,academic_year_id FROM sections WHERE school_id=$1 ORDER BY id",
        [schoolId],
      )
    ).rows;
    const inside = sections.find((r: any) => r.id === scope),
      outside = sections.find((r: any) => r.id !== scope);
    async function pupil(code: string, section: any) {
      const id = (
        await pool.query(
          `INSERT INTO students(school_id,admission_number,first_name,status) VALUES($1,$2,$3,'active') RETURNING id`,
          [schoolId, code, code],
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrollment_status,starts_on) VALUES($1,$2,$3,$4,$5,'active','2026-04-01')`,
        [schoolId, id, section.academic_year_id, section.class_id, section.id],
      );
      return id;
    }
    const insideId = await pupil("LIB-INSIDE", inside),
      outsideId = await pupil("LIB-OUTSIDE", outside);
    const im = await call("POST", "/library/members", admin, {
        studentId: insideId,
        status: "active",
      }),
      om = await call("POST", "/library/members", admin, {
        studentId: outsideId,
        status: "active",
      });
    expect(im.status).toBe(201);
    expect(om.status).toBe(201);
    const duplicate = await call("POST", "/library/members", admin, {
      studentId: insideId,
      status: "active",
    });
    expect(duplicate.status).toBe(409);
    const listed = (await call("GET", "/library/members", teacher)).body.items;
    expect(listed.some((m: any) => m.id === im.body.id)).toBe(true);
    expect(listed.some((m: any) => m.id === om.body.id)).toBe(false);
    const search = (await call("GET", "/library/members?search=LIB-INSIDE"))
      .body.items;
    expect(search).toHaveLength(1);
    const book = await call("POST", "/library/books", admin, {
      title: "Scope circulation title",
      copies: 2,
    });
    expect(book.status).toBe(201);
    const copies = (await call("GET", `/library/books/${book.body.id}/copies`))
      .body.items;
    const il = await call("POST", "/library/loans", admin, {
        copyId: copies[0].id,
        memberId: im.body.id,
      }),
      ol = await call("POST", "/library/loans", admin, {
        copyId: copies[1].id,
        memberId: om.body.id,
      });
    expect(il.status).toBe(201);
    expect(ol.status).toBe(201);
    await call("POST", "/library/fines", admin, {
      loanId: il.body.id,
      amount: 5,
      reason: "damaged",
    });
    await call("POST", "/library/fines", admin, {
      loanId: ol.body.id,
      amount: 5,
      reason: "damaged",
    });
    await call("POST", "/library/reservations", admin, {
      bookId: book.body.id,
      memberId: im.body.id,
    });
    await call("POST", "/library/reservations", admin, {
      bookId: book.body.id,
      memberId: om.body.id,
    });
    expect(
      (await call("GET", "/library/loans", teacher)).body.items.some(
        (l: any) => l.id === ol.body.id,
      ),
    ).toBe(false);
    const fines = (await call("GET", "/library/fines", teacher)).body.items;
    expect(fines.some((f: any) => f.loanId === il.body.id)).toBe(true);
    expect(fines.some((f: any) => f.loanId === ol.body.id)).toBe(false);
    const reservations = (await call("GET", "/library/reservations", teacher))
      .body.items;
    expect(reservations.some((r: any) => r.memberId === im.body.id)).toBe(true);
    expect(reservations.some((r: any) => r.memberId === om.body.id)).toBe(
      false,
    );
    const libraryOnlyId = (
      await pool.query(
        `INSERT INTO users(email,display_name,password_hash,status) SELECT 'library-only@demo.test','Library only',password_hash,'active' FROM users WHERE email='teacher@demo.test' RETURNING id`,
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO user_role_assignments(user_id,role_id,school_id,scope_type) SELECT $1,id,$2,'school' FROM roles WHERE code='librarian'`,
      [libraryOnlyId, schoolId],
    );
    const libraryOnly = await login("library-only@demo.test", "Teacher@12345");
    expect((await call("GET", "/staff", libraryOnly)).status).toBe(403);
    expect(
      (
        await call(
          "GET",
          "/library/member-candidates?kind=staff&search=Anita",
          libraryOnly,
        )
      ).status,
    ).toBe(200);
    const candidates = await call(
      "GET",
      "/library/member-candidates?kind=staff&search=Anita",
    );
    expect(candidates.status).toBe(200);
    expect(candidates.body.items[0].name).toContain("Anita");
    expect(candidates.body.items[0].salary).toBeUndefined();
    // Grant the edit action to the existing valid section-scoped teacher role.
    // Arbitrary roles with a section assignment are deliberately not valid grants.
    await pool.query(
      `INSERT INTO role_permissions(role_id,permission_id)
       SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
       WHERE r.code='teacher' AND p.code='students.profile.edit' ON CONFLICT DO NOTHING`,
    );
    expect(
      (
        await call("PATCH", `/students/${outsideId}`, teacher, {
          bloodGroup: "A+",
        })
      ).status,
    ).toBe(404);
    const updated = await call("PATCH", `/students/${insideId}`, teacher, {
      bloodGroup: "B+",
      emergencyContact: "School emergency desk",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.bloodGroup).toBe("B+");
    expect(updated.body.admissionNumber).toBe("LIB-INSIDE");
    expect(
      (
        await call("PATCH", `/students/${insideId}`, admin, {
          status: "withdrawn",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PATCH", `/students/${insideId}`, admin, {
          status: "inactive",
        })
      ).status,
    ).toBe(400);
    const audit = (
      await pool.query(
        `SELECT before_state,after_state FROM audit_events WHERE school_id=$1 AND entity_id=$2 AND action='student.updated' ORDER BY occurred_at DESC LIMIT 1`,
        [schoolId, insideId],
      )
    ).rows[0];
    expect(audit.after_state.bloodGroup).toBe("B+");
    expect(audit.before_state.blood_group).toBeNull();
    const central = await call("GET", `/students/${insideId}`);
    expect(central.body.emergencyContact).toBe("School emergency desk");
    expect(central.body.id).toBe(insideId);
    expect(
      (
        await call("PATCH", `/students/${insideId}`, admin, {
          bloodGroup: "INVALID",
        })
      ).status,
    ).toBe(400);
  });
});
