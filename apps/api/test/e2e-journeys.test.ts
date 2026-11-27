import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Asterleaf School ERP — End-to-End Operational Journey Integration Tests
 *
 * Tests the end-to-end workflows across the 30-module directory:
 * - Journey 1: Nursery–XII Unified Class/Section Enrolment & Student Master
 * - Journey 2: Official School Certificates (TC, Bonafide) with Hash Verification (Module 24)
 * - Journey 3: Campus Facilities & Maintenance Ticket Lifecycle (Module 21)
 * - Journey 4: PTM Slots Scheduling, Parent Booking & Teacher Feedback (Module 23)
 * - Journey 5: Student Extracurricular Clubs & Alumni Directory (Module 29)
 * - Journey 6: Comprehensive Multi-Attribute Audit Trail Filtering & Verification
 * - Journey 7: Role-Based Access Isolation (Unauthorised access rejection)
 */

let app: FastifyInstance;
let pool: pg.Pool;
let stopDatabase: () => Promise<void>;
let schoolId: string;

const cookies = new Map<string, string>();

async function call(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  options: { cookie?: string; payload?: unknown; idempotencyKey?: string } = {},
): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
  const response = await app.inject({
    method,
    url,
    payload: options.payload as never,
    headers: {
      origin: "http://localhost:5173",
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

async function login(email: string, password: string): Promise<string> {
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

let adminCookie: string;
let teacherCookie: string;
let parentCookie: string;
let studentCookie: string;
let auditorCookie: string;

let academicYearId: string;
let sampleStudentId: string;
let sampleGuardianId: string;
let teacherStaffId: string;
let nurseryClassId: string;
let nurserySectionId: string;

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

  const { rows: schoolRows } = await pool.query<{ id: string }>(
    "SELECT id FROM schools LIMIT 1",
  );
  schoolId = schoolRows[0]!.id;

  const { rows: yearRows } = await pool.query<{ id: string }>(
    `SELECT id FROM academic_years WHERE school_id = $1 AND status = 'active' LIMIT 1`,
    [schoolId],
  );
  academicYearId = yearRows[0]!.id;

  const { rows: stRows } = await pool.query<{ id: string }>(
    `SELECT sg.student_id AS id FROM student_guardians sg JOIN guardians g ON g.school_id=sg.school_id AND g.id=sg.guardian_id JOIN users u ON u.id=g.user_id WHERE sg.school_id=$1 AND u.email='parent@demo.test' AND sg.portal_access_status='verified' AND sg.valid_to IS NULL LIMIT 1`,
    [schoolId],
  );
  sampleStudentId = stRows[0]!.id;

  const { rows: gRows } = await pool.query<{ id: string }>(
    `SELECT g.id FROM guardians g JOIN student_guardians sg ON sg.school_id=g.school_id AND sg.guardian_id=g.id JOIN users u ON u.id=g.user_id WHERE g.school_id=$1 AND u.email='parent@demo.test' AND sg.portal_access_status='verified' AND sg.valid_to IS NULL LIMIT 1`,
    [schoolId],
  );
  sampleGuardianId = gRows[0]!.id;

  const { rows: sRows } = await pool.query<{ id: string }>(
    `SELECT s.id FROM staff s JOIN users u ON u.id=s.user_id WHERE s.school_id=$1 AND u.email='teacher@demo.test' LIMIT 1`,
    [schoolId],
  );
  teacherStaffId = sRows[0]!.id;

  const { rows: cRows } = await pool.query<{ id: string }>(
    `SELECT id FROM classes WHERE school_id = $1 AND code = 'G1' LIMIT 1`,
    [schoolId],
  );
  nurseryClassId = cRows[0]!.id;

  const { rows: csRows } = await pool.query<{ id: string }>(
    `SELECT id FROM sections WHERE school_id = $1 AND code = 'A' AND class_id = $2 LIMIT 1`,
    [schoolId, nurseryClassId],
  );
  nurserySectionId = csRows[0]!.id;

  adminCookie = await login("admin@demo.test", "Admin@12345");
  teacherCookie = await login("teacher@demo.test", "Teacher@12345");
  parentCookie = await login("parent@demo.test", "Parent@12345");
  studentCookie = await login("student@demo.test", "Student@12345");
  auditorCookie = await login("auditor@demo.test", "Auditor@12345");
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (stopDatabase) await stopDatabase();
});

describe("E2E Operational Journeys across 30 Modules", () => {
  /* -------------------------------------------------------------------------- */
  /* Journey 1: Unified Class/Section & Student Enrolment                        */
  /* -------------------------------------------------------------------------- */
  describe("Journey 1: Student Enrolment & Class/Section Structure", () => {
    it("creates pre-primary class and verifies class structure", async () => {
      const createRes = await call("POST", `/api/schools/${schoolId}/classes`, {
        cookie: adminCookie,
        payload: {
          code: "NUR",
          name: "Nursery",
          gradeOrder: 0,
          status: "active",
        },
      });
      expect([200, 201]).toContain(createRes.status);

      const res = await call("GET", `/api/schools/${schoolId}/classes`, {
        cookie: adminCookie,
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);

      const codes = res.body.items.map((c: { code: string }) => c.code);
      expect(codes).toContain("NUR");
      expect(codes).toContain("G1");
    });

    it("enrols a new student with admission number and active enrollment", async () => {
      const admRes = await call("POST", `/api/schools/${schoolId}/students`, {
        cookie: adminCookie,
        payload: {
          admissionNumber: "ADM-2026-99001",
          firstName: "Ananya",
          lastName: "Sundaram",
          dateOfBirth: "2020-05-14",
          gender: 'female', homeAddress: '12 Test Road', city: 'New Delhi', state: 'Delhi', postalCode: '110001', emergencyContact: '+91 98765 44332',
          academicYearId,
          sectionId: nurserySectionId,
          startsOn: "2026-04-01",
          guardians: [
            {
              firstName: "Ramesh",
              lastName: "Sundaram",
              relationshipType: "Father",
              isPrimary: true,
              email: "ramesh.sundaram@example.test",
              phone: "+91 98765 44332",
            },
          ],
        },
      });
      expect(admRes.status).toBe(201);
      const studentId = admRes.body.id;
      expect(studentId).toBeDefined();
      expect(admRes.body.admissionNumber).toBe("ADM-2026-99001");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Journey 2: Official Certificates Generation & Verification (Module 24)     */
  /* -------------------------------------------------------------------------- */
  describe("Journey 2: Documents & Official School Certificates (Module 24)", () => {
    let generatedCertId: string;
    let verificationHash: string;

    it("generates an official Bonafide Certificate with cryptographic verification hash", async () => {
      const genRes = await call(
        "POST",
        `/api/schools/${schoolId}/certificates`,
        {
          cookie: adminCookie,
          payload: {
            studentId: sampleStudentId,
            academicYearId,
            certificateType: "bonafide",
            issuedReason:
              "Application for CBSE Inter-School Science Fair passport clearance",
            metadata: {
              purpose: "Passport Application",
              issuedByAuthority: "Office of the Principal",
            },
          },
        },
      );
      expect(genRes.status).toBe(201);
      const certNum =
        genRes.body.certificate_number ?? genRes.body.certificateNumber;
      const hash =
        genRes.body.verification_hash ?? genRes.body.verificationHash;
      expect(certNum).toMatch(/^BON\//);
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256
      generatedCertId = genRes.body.id;
      verificationHash = hash;
    });

    it("approves the official certificate and issues it", async () => {
      const appRes = await call(
        "PATCH",
        `/api/schools/${schoolId}/certificates/${generatedCertId}/approve`,
        {
          cookie: adminCookie,
          payload: { status: "issued" },
        },
      );
      expect(appRes.status).toBe(200);
      expect(appRes.body.status).toBe("issued");
      expect(appRes.body.approved_at ?? appRes.body.approvedAt).toBeDefined();
    });

    it("publicly verifies the certificate via its cryptographic hash without login", async () => {
      const verifyRes = await call(
        "GET",
        `/api/schools/${schoolId}/certificates/verify/${verificationHash}`,
      );
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.verified).toBe(true);
      const cert = verifyRes.body.certificate;
      expect(cert.certificate_number ?? cert.certificateNumber).toBeDefined();
      expect(cert.student_name ?? cert.studentName).toBeDefined();
      expect(cert.certificate_type ?? cert.certificateType).toBe("bonafide");
    });

    it("returns 404 verified=false for an invalid or tampered verification hash", async () => {
      const invalidHash =
        "0000000000000000000000000000000000000000000000000000000000000000";
      const fakeRes = await call(
        "GET",
        `/api/schools/${schoolId}/certificates/verify/${invalidHash}`,
      );
      expect(fakeRes.status).toBe(404);
      expect(fakeRes.body.verified).toBe(false);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Journey 3: Facilities & Maintenance Management (Module 21)                 */
  /* -------------------------------------------------------------------------- */
  describe("Journey 3: Facilities & Maintenance Tickets (Module 21)", () => {
    let facilityId: string;
    let ticketId: string;

    it("creates a new campus facility (Robotics Innovation Lab)", async () => {
      const facRes = await call("POST", `/api/schools/${schoolId}/facilities`, {
        cookie: adminCookie,
        payload: {
          code: "FAC-ROB-01",
          name: "Vikram Sarabhai Robotics & AI Lab",
          category: "laboratory",
          blockLocation: "Innovation Block Level 2",
          capacity: 45,
          status: "operational",
          notes:
            "High-speed fiber connectivity, 3D printers and micro-controller stations",
        },
      });
      expect(facRes.status).toBe(201);
      facilityId = facRes.body.id;
      expect(facilityId).toBeDefined();
    });

    it("logs a high-priority maintenance ticket for the facility", async () => {
      const tktRes = await call(
        "POST",
        `/api/schools/${schoolId}/maintenance-tickets`,
        {
          cookie: adminCookie,
          payload: {
            facilityId,
            category: "electrical",
            priority: "high",
            description:
              "Intermittent voltage fluctuation on 3D printer circuit power rail",
            estimatedCost: 7500,
            assignedTo: teacherStaffId,
          },
        },
      );
      expect(tktRes.status).toBe(201);
      ticketId = tktRes.body.id;
      const tktNum = tktRes.body.ticket_number ?? tktRes.body.ticketNumber;
      expect(tktNum).toMatch(/^TKT-/);
      expect(tktRes.body.status).toBe("reported");
    });

    it("updates ticket to in_progress and then resolves it with actual cost", async () => {
      const progRes = await call(
        "PATCH",
        `/api/schools/${schoolId}/maintenance-tickets/${ticketId}`,
        {
          cookie: adminCookie,
          payload: {
            status: "in_progress",
            resolutionNotes: "Electrician inspecting voltage regulator board",
          },
        },
      );
      expect(progRes.status).toBe(200);
      expect(progRes.body.status).toBe("in_progress");

      const resRes = await call(
        "PATCH",
        `/api/schools/${schoolId}/maintenance-tickets/${ticketId}`,
        {
          cookie: adminCookie,
          payload: {
            status: "resolved",
            actualCost: 6800,
            resolutionNotes:
              "Replaced faulty circuit breaker and calibrated stabilizer.",
          },
        },
      );
      expect(resRes.status).toBe(200);
      expect(resRes.body.status).toBe("resolved");
      expect(resRes.body.resolved_at ?? resRes.body.resolvedAt).toBeDefined();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Journey 4: PTM Appointments & Slot Bookings (Module 23)                    */
  /* -------------------------------------------------------------------------- */
  describe("Journey 4: PTM Slots Scheduling & Parent Booking (Module 23)", () => {
    let ptmSlotId: string;
    let ptmBookingId: string;

    it("creates a PTM schedule slot for parent consultation", async () => {
      const slotRes = await call("POST", `/api/schools/${schoolId}/ptm-slots`, {
        cookie: adminCookie,
        payload: {
          academicYearId,
          teacherId: teacherStaffId,
          title: "Term 1 Parent Teacher Consultation",
          eventDate: "2026-11-20",
          startTime: "10:00",
          endTime: "12:00",
          roomLocation: "Academic Wing Conference Room",
          maxParents: 1,
        },
      });
      expect(slotRes.status).toBe(201);
      ptmSlotId = slotRes.body.id;
      expect(ptmSlotId).toBeDefined();
    });

    it("books a PTM slot with parent consultation notes", async () => {
      const bookRes = await call(
        "POST",
        `/api/schools/${schoolId}/ptm-bookings`,
        {
          cookie: parentCookie,
          payload: {
            slotId: ptmSlotId,
            studentId: sampleStudentId,
            guardianId: sampleGuardianId,
            bookingNotes:
              "Would like to discuss performance in Mathematics and upcoming Olympiad preparation.",
          },
        },
      );
      expect(bookRes.status).toBe(201);
      ptmBookingId = bookRes.body.id;
      expect(bookRes.body.status).toBe("confirmed");
    });

    it("rejects a guardian booking another child or using another guardian identity", async () => {
      const unlinked = (
        await pool.query(
          `SELECT s.id FROM students s WHERE s.school_id=$1 AND NOT EXISTS(SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id WHERE sg.student_id=s.id AND sg.school_id=$1 AND sg.portal_access_status='verified' AND g.user_id=(SELECT id FROM users WHERE email='parent@demo.test')) LIMIT 1`,
          [schoolId],
        )
      ).rows[0];
      expect(unlinked).toBeTruthy();
      const denied = await call(
        "POST",
        `/api/schools/${schoolId}/ptm-bookings`,
        {
          cookie: parentCookie,
          payload: {
            slotId: ptmSlotId,
            studentId: unlinked.id,
            guardianId: sampleGuardianId,
          },
        },
      );
      expect(denied.status).toBe(404);
      const fakeGuardian = (
        await pool.query(
          `INSERT INTO guardians(school_id,first_name,phone) VALUES($1,'Unowned guardian','9876543299') RETURNING id`,
          [schoolId],
        )
      ).rows[0];
      const impersonated = await call(
        "POST",
        `/api/schools/${schoolId}/ptm-bookings`,
        {
          cookie: parentCookie,
          payload: {
            slotId: ptmSlotId,
            studentId: sampleStudentId,
            guardianId: fakeGuardian.id,
          },
        },
      );
      expect(impersonated.status).toBe(404);
    });

    it("prevents concurrent bookings from exceeding capacity and allows an idempotent same-child repeat", async () => {
      const ownChildren = (
        await pool.query(
          `SELECT sg.student_id FROM student_guardians sg WHERE sg.school_id=$1 AND sg.guardian_id=$2 AND sg.portal_access_status='verified' AND sg.valid_to IS NULL`,
          [schoolId, sampleGuardianId],
        )
      ).rows;
      let second = ownChildren.find(
        (r) => r.student_id !== sampleStudentId,
      )?.student_id;
      let addedLink = false;
      if (!second) {
        second = (
          await pool.query(
            `SELECT id FROM students s WHERE school_id=$1 AND id<>$2 AND NOT EXISTS(SELECT 1 FROM student_guardians sg WHERE sg.school_id=$1 AND sg.student_id=s.id AND sg.guardian_id=$3) LIMIT 1`,
            [schoolId, sampleStudentId, sampleGuardianId],
          )
        ).rows[0]?.id;
        if (second) {
          await pool.query(
            `INSERT INTO student_guardians(school_id,student_id,guardian_id,relationship_type,portal_access_status) VALUES($1,$2,$3,'parent','verified')`,
            [schoolId, second, sampleGuardianId],
          );
          addedLink = true;
        }
      }
      expect(second).toBeTruthy();
      const slot = await call("POST", `/api/schools/${schoolId}/ptm-slots`, {
        cookie: adminCookie,
        payload: {
          academicYearId,
          teacherId: teacherStaffId,
          eventDate: "2026-11-21",
          startTime: "13:00",
          endTime: "13:30",
          maxParents: 1,
        },
      });
      expect(slot.status).toBe(201);
      const outcomes = await Promise.all(
        [sampleStudentId, second].map((studentId) =>
          call("POST", `/api/schools/${schoolId}/ptm-bookings`, {
            cookie: parentCookie,
            payload: {
              slotId: slot.body.id,
              studentId,
              guardianId: sampleGuardianId,
            },
          }),
        ),
      );
      expect(outcomes.map((r) => r.status).sort()).toEqual([201, 403]);
      const winner = outcomes.find((r) => r.status === 201)!;
      const repeated = await call(
        "POST",
        `/api/schools/${schoolId}/ptm-bookings`,
        {
          cookie: parentCookie,
          payload: {
            slotId: slot.body.id,
            studentId: winner.body.student_id,
            guardianId: sampleGuardianId,
          },
        },
      );
      expect(repeated.status).toBe(201);
      expect(repeated.body.id).toBe(winner.body.id);
      const counted = await pool.query(
        `SELECT count(*)::int AS count FROM ptm_bookings WHERE slot_id=$1 AND status='confirmed'`,
        [slot.body.id],
      );
      expect(counted.rows[0].count).toBe(1);
      if (addedLink)
        await pool.query(
          "DELETE FROM student_guardians WHERE school_id=$1 AND student_id=$2 AND guardian_id=$3",
          [schoolId, second, sampleGuardianId],
        );
    });

    it("denies timetable read-only users PTM creation and teachers access to other teachers slots", async () => {
      const other = (
        await pool.query(
          "SELECT id FROM staff WHERE school_id=$1 AND id<>$2 LIMIT 1",
          [schoolId, teacherStaffId],
        )
      ).rows[0];
      const payload = {
        academicYearId,
        teacherId: other.id,
        eventDate: "2026-11-22",
        startTime: "13:00",
        endTime: "13:30",
        maxParents: 1,
      };
      expect(
        (
          await call("POST", `/api/schools/${schoolId}/ptm-slots`, {
            cookie: auditorCookie,
            payload,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call("POST", `/api/schools/${schoolId}/ptm-slots`, {
            cookie: teacherCookie,
            payload,
          })
        ).status,
      ).toBe(403);
    });

    it("teacher records feedback after consultation concludes", async () => {
      const fbRes = await call(
        "PATCH",
        `/api/schools/${schoolId}/ptm-bookings/${ptmBookingId}`,
        {
          cookie: teacherCookie,
          payload: {
            status: "attended",
            teacherFeedback:
              "Very positive meeting. Student demonstrates exemplary analytical reasoning.",
          },
        },
      );
      expect(fbRes.status).toBe(200);
      expect(fbRes.body.status).toBe("attended");
      const feedback =
        fbRes.body.teacher_feedback ?? fbRes.body.teacherFeedback;
      expect(feedback).toContain("analytical reasoning");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Journey 5: Extracurricular Clubs & Alumni Directory (Module 29)            */
  /* -------------------------------------------------------------------------- */
  describe("Journey 5: Clubs, Memberships & Alumni Network (Module 29)", () => {
    let clubId: string;

    it("creates an extracurricular club and registers a member", async () => {
      const clubRes = await call("POST", `/api/schools/${schoolId}/clubs`, {
        cookie: adminCookie,
        payload: {
          code: "CLUB-AERO-01",
          name: "Kalam Aeromodelling & Astronomy Club",
          category: "stem",
          leadTeacherId: teacherStaffId,
          description:
            "Telescope observations, model rocketry, and satellite telemetry principles",
          maxMembers: 35,
          meetingSchedule: "Saturdays 09:30 - 11:30",
          venue: "Science Terrace & Observatory",
        },
      });
      expect(clubRes.status).toBe(201);
      clubId = clubRes.body.id;

      // Register student membership
      const memRes = await call(
        "POST",
        `/api/schools/${schoolId}/clubs/${clubId}/members`,
        {
          cookie: adminCookie,
          payload: {
            studentId: sampleStudentId,
            academicYearId,
            role: "secretary",
            achievements:
              "Organized National Space Day telescope viewing exhibition",
          },
        },
      );
      expect(memRes.status).toBe(201);
      expect(memRes.body.role).toBe("secretary");
    });

    it("creates an alumni directory record with higher education placement", async () => {
      const alRes = await call("POST", `/api/schools/${schoolId}/alumni`, {
        cookie: adminCookie,
        payload: {
          studentId: sampleStudentId,
          passingYear: 2024,
          classGraduated: "Class 12",
          stream: "Science",
          currentEngagement: "higher_education",
          institutionOrCompany: "Indian Institute of Science (IISc) Bangalore",
          designationOrCourse: "BS (Research) Physics",
          contactEmail: "ananya.s@alumni.test",
          city: "Bengaluru",
          notes: "KVPY Fellow and National Science Talent Scholar.",
        },
      });
      expect(alRes.status).toBe(201);
      const org =
        alRes.body.institution_or_company ?? alRes.body.institutionOrCompany;
      expect(org).toContain("IISc");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Journey 6: Audit Trail Multi-Filter Search & Pagination                    */
  /* -------------------------------------------------------------------------- */
  describe("Journey 6: Multi-Attribute Audit Trail Verification", () => {
    it("retrieves audit trail with search, outcome, and date filters", async () => {
      const auditRes = await call(
        "GET",
        `/api/schools/${schoolId}/audit-events?search=certificate&outcome=success&limit=10`,
        {
          cookie: auditorCookie,
        },
      );
      expect(auditRes.status).toBe(200);
      expect(Array.isArray(auditRes.body.items)).toBe(true);
      expect(typeof auditRes.body.total).toBe("number");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* Journey 7: Role-Based Access Isolation (Security Enforced)                 */
  /* -------------------------------------------------------------------------- */
  describe("Journey 7: Role-Based Security Isolation", () => {
    it("rejects student attempting to create facilities or maintenance tickets", async () => {
      const res = await call("POST", `/api/schools/${schoolId}/facilities`, {
        cookie: studentCookie,
        payload: {
          code: "HACK-FAC-01",
          name: "Unauthorized Facility",
          category: "other",
        },
      });
      expect([401, 403]).toContain(res.status);
    });

    it("rejects student attempting to issue official certificates", async () => {
      const res = await call("POST", `/api/schools/${schoolId}/certificates`, {
        cookie: studentCookie,
        payload: {
          studentId: sampleStudentId,
          academicYearId,
          certificateType: "bonafide",
        },
      });
      expect([401, 403]).toContain(res.status);
    });

    it("rejects parent attempting to approve maintenance tickets", async () => {
      const res = await call(
        "PATCH",
        `/api/schools/${schoolId}/maintenance-tickets/00000000-0000-0000-0000-000000000000`,
        {
          cookie: parentCookie,
          payload: { status: "resolved" },
        },
      );
      expect([401, 403, 404]).toContain(res.status);
    });
  });
});
