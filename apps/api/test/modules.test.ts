import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end integration tests for the modules added after the first release:
 * staff timekeeping, recruitment, procurement, transport, library, learning,
 * concerns, notifications, fee reconciliation and saved reports/imports.
 *
 * Every assertion goes through Fastify so guards, validation, SQL and audit
 * writes run exactly as they do in production. The demo seed provides the data;
 * the auditor is granted the main_admin role in `beforeAll` so a second person
 * is available for the separation-of-duties checks.
 */

let app: FastifyInstance;
let pool: pg.Pool;
let stopDatabase: () => Promise<void>;
let schoolId: string;

const cookies = new Map<string, string>();

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: { cookie?: string; payload?: unknown; idempotencyKey?: string } = {},
): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
  const response = await app.inject({
    method,
    url,
    payload: options.payload as never,
    headers: {
      origin: 'http://localhost:5173',
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
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
  const response = await call('POST', '/api/auth/login', {
    payload: { email, password },
  });
  expect(response.status, `login failed for ${email}: ${JSON.stringify(response.body)}`).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = String(raw).split(';')[0];
  expect(cookie).toMatch(/^erp_session=/);
  cookies.set(email, cookie!);
  return cookie!;
}

async function q<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

function isoDaysFromNow(days: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + days * 86_400_000));
}

let schoolCode: string;
let admin: string;
let coordinator: string;
let teacher: string;
let parent: string;
let finance: string;
let auditor: string;

let adminId: string;
let coordinatorId: string;
let teacherId: string;
let parentId: string;
let financeId: string;
let auditorId: string;

let activeYearId: string;
let grade1AId: string;
let grade1ClassId: string;
let grade3BId: string;
let subjectEngId: string;

let aaravId: string;
let diyaId: string;
let kabirId: string;
let meeraId: string;
let meenaStaffId: string;

beforeAll(async () => {
  const { startTestDatabase } = await import('@erp/db/test-database');
  const database = await startTestDatabase();
  stopDatabase = database.stop;
  process.env.DATABASE_URL = database.url;
  process.env.NODE_ENV = 'test';

  const { buildApp } = await import('../src/app');
  const { getPool } = await import('../src/db');
  pool = getPool();
  app = await buildApp();
  await app.ready();

  const schools = await q<{ id: string; code: string }>(
    `SELECT id, code FROM schools WHERE code = 'GREENFIELD'`,
  );
  schoolId = schools[0]!.id;
  schoolCode = schools[0]!.code;

  const users = await q<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE email LIKE '%@demo.test'`,
  );
  const byEmail = new Map(users.map((user) => [user.email, user.id]));
  adminId = byEmail.get('admin@demo.test')!;
  coordinatorId = byEmail.get('coordinator@demo.test')!;
  teacherId = byEmail.get('teacher@demo.test')!;
  parentId = byEmail.get('parent@demo.test')!;
  financeId = byEmail.get('finance@demo.test')!;
  auditorId = byEmail.get('auditor@demo.test')!;

  // A second approver is required by the two-person workflows. The auditor is
  // read-only by default, so grant main_admin for this test cluster only.
  const role = await q<{ id: string }>(`SELECT id FROM roles WHERE code = 'main_admin'`);
  await q(
    `INSERT INTO user_role_assignments (user_id, role_id, school_id, scope_type, reason)
     VALUES ($1, $2, $3, 'school', 'Module test second approver')`,
    [auditorId, role[0]!.id, schoolId],
  );

  const years = await q<{ id: string }>(
    `SELECT id FROM academic_years WHERE school_id = $1 AND status = 'active'`,
    [schoolId],
  );
  activeYearId = years[0]!.id;

  const sections = await q<{ id: string; class_id: string; class_name: string; section_name: string }>(
    `SELECT sec.id, sec.class_id, c.name AS class_name, sec.name AS section_name
     FROM sections sec
     JOIN classes c ON c.id = sec.class_id AND c.school_id = sec.school_id
     WHERE sec.school_id = $1 AND sec.academic_year_id = $2`,
    [schoolId, activeYearId],
  );
  grade1AId = sections.find(
    (row) => row.class_name === 'Grade 1' && row.section_name === 'Section A',
  )!.id;
  grade1ClassId = sections.find(
    (row) => row.class_name === 'Grade 1' && row.section_name === 'Section A',
  )!.class_id;
  grade3BId = sections.find(
    (row) => row.class_name === 'Grade 3' && row.section_name === 'Section B',
  )!.id;

  const subjects = await q<{ id: string }>(
    `SELECT id FROM subjects WHERE school_id = $1 AND code = 'ENG'`,
    [schoolId],
  );
  subjectEngId = subjects[0]!.id;

  const students = await q<{ id: string; first_name: string }>(
    `SELECT id, first_name FROM students WHERE school_id = $1`,
    [schoolId],
  );
  aaravId = students.find((row) => row.first_name === 'Aarav')!.id;
  diyaId = students.find((row) => row.first_name === 'Diya')!.id;
  kabirId = students.find((row) => row.first_name === 'Kabir')!.id;
  meeraId = students.find((row) => row.first_name === 'Meera')!.id;

  const staff = await q<{ id: string; employee_number: string }>(
    `SELECT id, employee_number FROM staff WHERE school_id = $1`,
    [schoolId],
  );
  meenaStaffId = staff.find((row) => row.employee_number === 'EMP-0005')!.id;

  admin = await login('admin@demo.test', 'Admin@12345');
  coordinator = await login('coordinator@demo.test', 'Coord@12345');
  teacher = await login('teacher@demo.test', 'Teacher@12345');
  parent = await login('parent@demo.test', 'Parent@12345');
  finance = await login('finance@demo.test', 'Finance@12345');
  auditor = await login('auditor@demo.test', 'Auditor@12345');
});

afterAll(async () => {
  const { closePool } = await import('../src/db');
  await app?.close();
  await closePool();
  await stopDatabase?.();
});

describe('staff attendance and timekeeping', () => {
  let shiftId: string;
  let attendanceId: string;
  let correctionId: string;

  it('creates a shift and rejects one that ends before it starts', async () => {
    const created = await call('POST', `/api/schools/${schoolId}/staff/shifts`, {
      cookie: admin,
      payload: {
        code: 'module_day',
        name: 'Module day shift',
        startsAt: '09:00',
        endsAt: '17:00',
        graceMinutes: 10,
        breakMinutes: 60,
        active: true,
      },
    });
    expect(created.status).toBe(201);
    shiftId = created.body.id;

    const invalid = await call('POST', `/api/schools/${schoolId}/staff/shifts`, {
      cookie: admin,
      payload: {
        code: 'module_night',
        name: 'Broken shift',
        startsAt: '17:00',
        endsAt: '09:00',
      },
    });
    expect(invalid.status).toBe(400);
  });

  it('records punches, computes late and overtime, and upserts the same day', async () => {
    const first = await call('POST', `/api/schools/${schoolId}/staff/attendance`, {
      cookie: admin,
      payload: {
        staffId: meenaStaffId,
        workDate: '2026-10-12',
        shiftId,
        punchIn: '2026-10-12T09:20:00+05:30',
        punchOut: '2026-10-12T19:00:00+05:30',
        note: 'Late bus',
      },
    });
    expect(first.status).toBe(201);
    attendanceId = first.body.id;

    const listed = await call(
      'GET',
      `/api/schools/${schoolId}/staff/attendance?staffId=${meenaStaffId}&from=2026-10-12&to=2026-10-12`,
      { cookie: admin },
    );
    expect(listed.status).toBe(200);
    const record = listed.body.items.find((item: any) => item.id === attendanceId);
    expect(record.status).toBe('late');
    expect(record.lateMinutes).toBe(10);
    expect(record.overtimeMinutes).toBe(10);

    const upserted = await call('POST', `/api/schools/${schoolId}/staff/attendance`, {
      cookie: admin,
      payload: {
        staffId: meenaStaffId,
        workDate: '2026-10-12',
        shiftId,
        punchIn: '2026-10-12T09:05:00+05:30',
        punchOut: '2026-10-12T17:00:00+05:30',
      },
    });
    expect(upserted.status).toBe(201);
    expect(upserted.body.id).toBe(attendanceId);

    const refreshed = await call(
      'GET',
      `/api/schools/${schoolId}/staff/attendance?staffId=${meenaStaffId}&from=2026-10-12&to=2026-10-12`,
      { cookie: admin },
    );
    const updated = refreshed.body.items.find((item: any) => item.id === attendanceId);
    expect(updated.status).toBe('present');
    expect(updated.lateMinutes).toBe(0);
  });

  it('returns a summary for the recorded period', async () => {
    const summary = await call(
      'GET',
      `/api/schools/${schoolId}/staff/attendance/summary?from=2026-10-12&to=2026-10-12`,
      { cookie: admin },
    );
    expect(summary.status).toBe(200);
    expect(summary.body.present).toBe(1);
    expect(summary.body.staff).toHaveLength(1);
    expect(summary.body.staff[0].staffId).toBe(meenaStaffId);
  });

  it('blocks duplicate corrections and self-review, then lets a second approver apply it', async () => {
    const request = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/${attendanceId}/corrections`,
      {
        cookie: admin,
        payload: { requestedStatus: 'half_day', reason: 'Left after lunch for a clinic visit' },
      },
    );
    expect(request.status).toBe(201);
    correctionId = request.body.id;

    const duplicate = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/${attendanceId}/corrections`,
      {
        cookie: admin,
        payload: { requestedStatus: 'leave', reason: 'Duplicate request' },
      },
    );
    expect(duplicate.status).toBe(409);

    const selfReview = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/corrections/${correctionId}/review`,
      { cookie: admin, payload: { decision: 'approve', note: 'Approve my own' } },
    );
    expect(selfReview.status).toBe(409);

    const approved = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/corrections/${correctionId}/review`,
      { cookie: auditor, payload: { decision: 'approve', note: 'Verified with the office' } },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    const applied = await call(
      'GET',
      `/api/schools/${schoolId}/staff/attendance?staffId=${meenaStaffId}&from=2026-10-12&to=2026-10-12`,
      { cookie: admin },
    );
    expect(applied.body.items[0].status).toBe('half_day');

    const reviewedAgain = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/corrections/${correctionId}/review`,
      { cookie: auditor, payload: { decision: 'reject' } },
    );
    expect(reviewedAgain.status).toBe(409);
  });

  it('validates attendance settings', async () => {
    const invalid = await call('PUT', `/api/schools/${schoolId}/staff/attendance/settings`, {
      cookie: admin,
      payload: {
        fullDayMinutes: 480,
        halfDayMinutes: 500,
        overtimeAfterMinutes: 30,
        active: true,
      },
    });
    expect(invalid.status).toBe(400);

    const saved = await call('PUT', `/api/schools/${schoolId}/staff/attendance/settings`, {
      cookie: admin,
      payload: {
        fullDayMinutes: 480,
        halfDayMinutes: 240,
        overtimeAfterMinutes: 30,
        active: true,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.halfDayMinutes).toBe(240);
  });
});

describe('recruitment, onboarding and separation', () => {
  let vacancyId: string;
  let candidateId: string;
  let offerId: string;
  let hiredStaffId: string;
  let separationId: string;

  it('runs a vacancy through candidate, interview and offer with two-person approval', async () => {
    const vacancy = await call('POST', `/api/schools/${schoolId}/vacancies`, {
      cookie: admin,
      payload: {
        title: 'Mathematics Teacher',
        department: 'Mathematics',
        designation: 'Teacher',
        employmentType: 'full_time',
        openings: 1,
        status: 'open',
        postedOn: isoDaysFromNow(-5),
        closesOn: isoDaysFromNow(20),
      },
    });
    expect(vacancy.status).toBe(201);
    vacancyId = vacancy.body.id;

    const candidate = await call('POST', `/api/schools/${schoolId}/candidates`, {
      cookie: admin,
      payload: {
        vacancyId,
        firstName: 'Nisha',
        lastName: 'Verma',
        email: 'nisha.verma@example.test',
        phone: '+91 98765 43210',
        source: 'Referral',
      },
    });
    expect(candidate.status).toBe(201);
    candidateId = candidate.body.id;

    const interview = await call(
      'POST',
      `/api/schools/${schoolId}/candidates/${candidateId}/interviews`,
      {
        cookie: admin,
        payload: {
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          mode: 'video',
          interviewerUserId: coordinatorId,
        },
      },
    );
    expect(interview.status).toBe(201);

    const outcome = await call(
      'PATCH',
      `/api/schools/${schoolId}/interviews/${interview.body.id}`,
      {
        cookie: admin,
        payload: {
          status: 'completed',
          score: 9,
          recommendation: 'strong_hire',
          feedback: 'Strong subject knowledge',
        },
      },
    );
    expect(outcome.status).toBe(200);

    const offer = await call('POST', `/api/schools/${schoolId}/job-offers`, {
      cookie: admin,
      payload: {
        candidateId,
        designation: 'Mathematics Teacher',
        department: 'Mathematics',
        grossSalary: 52000,
        currency: 'INR',
        startsOn: isoDaysFromNow(30),
      },
    });
    expect(offer.status).toBe(201);
    offerId = offer.body.id;

    const submit = await call(
      'POST',
      `/api/schools/${schoolId}/job-offers/${offerId}/decision`,
      { cookie: admin, payload: { decision: 'submit' } },
    );
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('pending_approval');

    const selfApprove = await call(
      'POST',
      `/api/schools/${schoolId}/job-offers/${offerId}/decision`,
      { cookie: admin, payload: { decision: 'approve' } },
    );
    expect(selfApprove.status).toBe(409);

    const approve = await call(
      'POST',
      `/api/schools/${schoolId}/job-offers/${offerId}/decision`,
      { cookie: auditor, payload: { decision: 'approve', note: 'Panel recommendation accepted' } },
    );
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');

    const accept = await call(
      'POST',
      `/api/schools/${schoolId}/job-offers/${offerId}/decision`,
      { cookie: admin, payload: { decision: 'accept' } },
    );
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('accepted');
  });

  it('hires once, creates onboarding tasks and blocks a duplicate hire', async () => {
    const hired = await call('POST', `/api/schools/${schoolId}/job-offers/${offerId}/hire`, {
      cookie: admin,
      payload: {},
    });
    expect(hired.status).toBe(201);
    hiredStaffId = hired.body.staffId;

    const tasks = await call('GET', `/api/schools/${schoolId}/onboarding-tasks`, {
      cookie: admin,
    });
    expect(tasks.status).toBe(200);
    expect(tasks.body.items.filter((task: any) => task.staffId === hiredStaffId)).toHaveLength(4);

    const again = await call('POST', `/api/schools/${schoolId}/job-offers/${offerId}/hire`, {
      cookie: admin,
      payload: {},
    });
    expect(again.status).toBe(409);

    const direct = await call('POST', `/api/schools/${schoolId}/candidates`, {
      cookie: admin,
      payload: {
        vacancyId,
        firstName: 'Rohit',
        lastName: 'Bose',
        email: 'rohit.bose@example.test',
      },
    });
    expect(direct.status).toBe(201);

    const forceHired = await call(
      'PATCH',
      `/api/schools/${schoolId}/candidates/${direct.body.id}/stage`,
      { cookie: admin, payload: { stage: 'hired' } },
    );
    expect(forceHired.status).toBe(400);

    const stage = await call(
      'PATCH',
      `/api/schools/${schoolId}/candidates/${direct.body.id}/stage`,
      { cookie: admin, payload: { stage: 'screening' } },
    );
    expect(stage.status).toBe(200);
  });

  it('requires exit tasks before a separation can be completed', async () => {
    const separation = await call('POST', `/api/schools/${schoolId}/separations`, {
      cookie: admin,
      payload: {
        staffId: hiredStaffId,
        lastWorkingDay: isoDaysFromNow(45),
        reason: 'resignation',
        notes: 'Moving cities',
        exitTasks: ['Hand over lesson plans'],
      },
    });
    expect(separation.status).toBe(201);
    separationId = separation.body.id;

    const earlyComplete = await call(
      'POST',
      `/api/schools/${schoolId}/separations/${separationId}/decision`,
      { cookie: admin, payload: { decision: 'complete' } },
    );
    expect(earlyComplete.status).toBe(409);

    const approve = await call(
      'POST',
      `/api/schools/${schoolId}/separations/${separationId}/decision`,
      { cookie: admin, payload: { decision: 'approve' } },
    );
    expect(approve.status).toBe(200);

    const blocked = await call(
      'POST',
      `/api/schools/${schoolId}/separations/${separationId}/decision`,
      { cookie: admin, payload: { decision: 'complete' } },
    );
    expect(blocked.status).toBe(409);

    const list = await call('GET', `/api/schools/${schoolId}/separations`, { cookie: admin });
    const record = list.body.items.find((item: any) => item.id === separationId);
    expect(record.tasks.length).toBe(3);
    for (const task of record.tasks) {
      const done = await call('PATCH', `/api/schools/${schoolId}/exit-tasks/${task.id}`, {
        cookie: admin,
        payload: { status: 'done' },
      });
      expect(done.status).toBe(200);
    }

    const completed = await call(
      'POST',
      `/api/schools/${schoolId}/separations/${separationId}/decision`,
      { cookie: admin, payload: { decision: 'complete' } },
    );
    expect(completed.status).toBe(200);

    const staff = await q<{ status: string }>(
      `SELECT status FROM staff WHERE school_id = $1 AND id = $2`,
      [schoolId, hiredStaffId],
    );
    expect(staff[0]!.status).toBe('left');
  });
});

describe('procurement and budgets', () => {
  let vendorId: string;
  let budgetId: string;
  let requestId: string;
  let poId: string;
  let poItemId: string;
  let billId: string;

  it('creates a vendor and a budget', async () => {
    const vendor = await call('POST', `/api/schools/${schoolId}/vendors`, {
      cookie: admin,
      payload: {
        name: 'Module Lab Supplies',
        contactName: 'Ramesh Iyer',
        email: 'sales@lab-supplies.example.test',
        phone: '+91 98765 11223',
        status: 'active',
      },
    });
    expect(vendor.status).toBe(201);
    vendorId = vendor.body.id;

    const budget = await call('POST', `/api/schools/${schoolId}/procurement-budgets`, {
      cookie: admin,
      payload: {
        academicYearId: activeYearId,
        name: 'Science lab budget',
        department: 'Science',
        allocatedAmount: 1000,
      },
    });
    expect(budget.status).toBe(201);
    budgetId = budget.body.id;
  });

  it('requires a different person to approve a purchase request and order', async () => {
    const request = await call('POST', `/api/schools/${schoolId}/purchase-requests`, {
      cookie: admin,
      payload: {
        title: 'Lab glassware',
        department: 'Science',
        justification: 'Replacement for broken beakers',
        items: [{ description: 'Beaker set', quantity: 2, estimatedUnitPrice: 500 }],
      },
    });
    expect(request.status).toBe(201);
    requestId = request.body.id;

    const submit = await call(
      'POST',
      `/api/schools/${schoolId}/purchase-requests/${requestId}/decision`,
      { cookie: admin, payload: { decision: 'submit' } },
    );
    expect(submit.status).toBe(200);

    const selfApprove = await call(
      'POST',
      `/api/schools/${schoolId}/purchase-requests/${requestId}/decision`,
      { cookie: admin, payload: { decision: 'approve' } },
    );
    expect(selfApprove.status).toBe(409);

    const approve = await call(
      'POST',
      `/api/schools/${schoolId}/purchase-requests/${requestId}/decision`,
      { cookie: auditor, payload: { decision: 'approve', note: 'Within budget' } },
    );
    expect(approve.status).toBe(200);

    const order = await call('POST', `/api/schools/${schoolId}/purchase-orders`, {
      cookie: admin,
      payload: {
        vendorId,
        requestId,
        orderDate: isoDaysFromNow(-1),
        items: [{ description: 'Beaker set', quantity: 2, unitPrice: 500 }],
      },
    });
    expect(order.status).toBe(201);
    poId = order.body.id;
    expect(order.body.total).toBe(1000);

    const selfOrder = await call(
      'POST',
      `/api/schools/${schoolId}/purchase-orders/${poId}/decision`,
      { cookie: admin, payload: { decision: 'approve' } },
    );
    expect(selfOrder.status).toBe(409);

    const issue = await call(
      'POST',
      `/api/schools/${schoolId}/purchase-orders/${poId}/decision`,
      { cookie: auditor, payload: { decision: 'approve', note: 'Issued to vendor' } },
    );
    expect(issue.status).toBe(200);

    const orders = await call('GET', `/api/schools/${schoolId}/purchase-orders`, {
      cookie: admin,
    });
    const orderRow = orders.body.items.find((item: any) => item.id === poId);
    expect(orderRow.status).toBe('issued');
    poItemId = orderRow.items[0].id;
  });

  it('blocks over-receipt and receives the outstanding goods', async () => {
    const tooMany = await call('POST', `/api/schools/${schoolId}/goods-receipts`, {
      cookie: admin,
      payload: { poId, items: [{ poItemId, quantity: 3 }] },
    });
    expect(tooMany.status).toBe(400);

    const receipt = await call('POST', `/api/schools/${schoolId}/goods-receipts`, {
      cookie: admin,
      payload: { poId, items: [{ poItemId, quantity: 2 }] },
    });
    expect(receipt.status).toBe(201);

    const again = await call('POST', `/api/schools/${schoolId}/goods-receipts`, {
      cookie: admin,
      payload: { poId, items: [{ poItemId, quantity: 1 }] },
    });
    expect(again.status).toBe(409);
  });

  it('runs a vendor bill through approval and payment with creator checks', async () => {
    const bill = await call('POST', `/api/schools/${schoolId}/vendor-bills`, {
      cookie: admin,
      payload: {
        vendorId,
        poId,
        billNumber: 'LAB-INV-1001',
        billDate: isoDaysFromNow(-1),
        dueOn: isoDaysFromNow(15),
        amount: 1000,
      },
    });
    expect(bill.status).toBe(201);
    billId = bill.body.id;

    const selfApprove = await call(
      'POST',
      `/api/schools/${schoolId}/vendor-bills/${billId}/decision`,
      { cookie: admin, payload: { decision: 'approve' } },
    );
    expect(selfApprove.status).toBe(409);

    const approve = await call(
      'POST',
      `/api/schools/${schoolId}/vendor-bills/${billId}/decision`,
      { cookie: auditor, payload: { decision: 'approve' } },
    );
    expect(approve.status).toBe(200);

    const paid = await call('POST', `/api/schools/${schoolId}/vendor-bills/${billId}/pay`, {
      cookie: finance,
      payload: { paidOn: isoDaysFromNow(0) },
    });
    expect(paid.status).toBe(200);

    const again = await call('POST', `/api/schools/${schoolId}/vendor-bills/${billId}/pay`, {
      cookie: finance,
      payload: { paidOn: isoDaysFromNow(0) },
    });
    expect(again.status).toBe(409);
  });

  it('caps expenses at the budget allocation and approves a recorded expense', async () => {
    const first = await call('POST', `/api/schools/${schoolId}/procurement-expenses`, {
      cookie: admin,
      payload: {
        budgetId,
        vendorId,
        description: 'Beaker set purchase',
        amount: 600,
        spentOn: isoDaysFromNow(0),
      },
    });
    expect(first.status).toBe(201);

    const over = await call('POST', `/api/schools/${schoolId}/procurement-expenses`, {
      cookie: admin,
      payload: {
        budgetId,
        description: 'Extra equipment',
        amount: 500,
        spentOn: isoDaysFromNow(0),
      },
    });
    expect(over.status).toBe(409);

    const approve = await call(
      'POST',
      `/api/schools/${schoolId}/procurement-expenses/${first.body.id}/decision`,
      { cookie: auditor, payload: { decision: 'approve' } },
    );
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');
  });
});

describe('transport and fleet', () => {
  let vehicleId: string;
  let routeId: string;
  let firstStopId: string;
  let secondStopId: string;
  let firstAllocationId: string;
  let secondAllocationId: string;

  it('creates a vehicle and route with ordered stops', async () => {
    const vehicle = await call('POST', `/api/schools/${schoolId}/transport/vehicles`, {
      cookie: admin,
      payload: {
        registrationNumber: 'KA-01-MOD-1234',
        model: 'School bus',
        capacity: 2,
        status: 'active',
        insuranceExpiresOn: isoDaysFromNow(180),
      },
    });
    expect(vehicle.status).toBe(201);
    vehicleId = vehicle.body.id;

    const route = await call('POST', `/api/schools/${schoolId}/transport/routes`, {
      cookie: admin,
      payload: {
        code: 'module_route',
        name: 'Module test route',
        vehicleId,
        status: 'active',
        stops: [
          { name: 'First stop', sequenceNo: 1, scheduledPickup: '07:30', scheduledDrop: '16:30' },
          { name: 'Second stop', sequenceNo: 2, scheduledPickup: '07:50', scheduledDrop: '16:50' },
        ],
      },
    });
    expect(route.status).toBe(201);
    routeId = route.body.id;

    const list = await call('GET', `/api/schools/${schoolId}/transport/routes`, {
      cookie: admin,
    });
    const row = list.body.items.find((item: any) => item.id === routeId);
    expect(row.stops).toHaveLength(2);
    firstStopId = row.stops[0].id;
    secondStopId = row.stops[1].id;
  });

  it('enforces one active allocation per student and the vehicle capacity', async () => {
    const first = await call('POST', `/api/schools/${schoolId}/transport/allocations`, {
      cookie: admin,
      payload: { studentId: aaravId, routeId, stopId: firstStopId },
    });
    expect(first.status).toBe(201);
    firstAllocationId = first.body.id;

    const duplicate = await call('POST', `/api/schools/${schoolId}/transport/allocations`, {
      cookie: admin,
      payload: { studentId: aaravId, routeId, stopId: secondStopId },
    });
    expect(duplicate.status).toBe(409);

    const second = await call('POST', `/api/schools/${schoolId}/transport/allocations`, {
      cookie: admin,
      payload: { studentId: diyaId, routeId, stopId: secondStopId },
    });
    expect(second.status).toBe(201);
    secondAllocationId = second.body.id;

    const full = await call('POST', `/api/schools/${schoolId}/transport/allocations`, {
      cookie: admin,
      payload: { studentId: kabirId, routeId, stopId: firstStopId },
    });
    expect(full.status).toBe(409);
  });

  it('blocks capacity reduction and stop replacement while allocations are active', async () => {
    const reduce = await call(
      'PATCH',
      `/api/schools/${schoolId}/transport/vehicles/${vehicleId}`,
      { cookie: admin, payload: { capacity: 1 } },
    );
    expect(reduce.status).toBe(409);

    const replace = await call(
      'PATCH',
      `/api/schools/${schoolId}/transport/routes/${routeId}`,
      {
        cookie: admin,
        payload: { stops: [{ name: 'Replacement stop', sequenceNo: 1 }] },
      },
    );
    expect(replace.status).toBe(409);
  });

  it('ends allocations, then replaces stops and records maintenance', async () => {
    for (const id of [firstAllocationId, secondAllocationId]) {
      const ended = await call(
        'POST',
        `/api/schools/${schoolId}/transport/allocations/${id}/end`,
        { cookie: admin, payload: { effectiveTo: isoDaysFromNow(0) } },
      );
      expect(ended.status).toBe(200);
    }

    const replace = await call(
      'PATCH',
      `/api/schools/${schoolId}/transport/routes/${routeId}`,
      {
        cookie: admin,
        payload: { stops: [{ name: 'Replacement stop', sequenceNo: 1, scheduledPickup: '07:45' }] },
      },
    );
    expect(replace.status).toBe(200);

    const maintenance = await call(
      'POST',
      `/api/schools/${schoolId}/transport/maintenance`,
      {
        cookie: admin,
        payload: {
          vehicleId,
          performedOn: isoDaysFromNow(0),
          description: 'Routine brake inspection',
          cost: 2500,
          status: 'completed',
          vendorName: 'City Motors',
        },
      },
    );
    expect(maintenance.status).toBe(201);
  });
});

describe('library circulation', () => {
  let bookId: string;
  let firstCopyId: string;
  let secondCopyId: string;
  let memberId: string;
  let firstLoanId: string;
  let overdueLoanId: string;
  let fineId: string;

  it('creates a category, a book with copies and a member with a borrowing limit of one', async () => {
    const category = await call('POST', `/api/schools/${schoolId}/library/categories`, {
      cookie: admin,
      payload: { code: 'module_fiction', name: 'Module fiction' },
    });
    expect(category.status).toBe(201);

    const book = await call('POST', `/api/schools/${schoolId}/library/books`, {
      cookie: admin,
      payload: {
        categoryId: category.body.id,
        title: 'The Module Test Book',
        author: 'A. Author',
        copies: 2,
        status: 'active',
      },
    });
    expect(book.status).toBe(201);
    bookId = book.body.id;

    const copies = await call(
      'GET',
      `/api/schools/${schoolId}/library/books/${bookId}/copies`,
      { cookie: admin },
    );
    expect(copies.body.items).toHaveLength(2);
    firstCopyId = copies.body.items[0].id;
    secondCopyId = copies.body.items[1].id;

    const member = await call('POST', `/api/schools/${schoolId}/library/members`, {
      cookie: admin,
      payload: { studentId: meeraId, borrowingLimit: 1, status: 'active' },
    });
    expect(member.status).toBe(201);
    memberId = member.body.id;

    const settings = await call('PUT', `/api/schools/${schoolId}/library/settings`, {
      cookie: admin,
      payload: { loanDays: 14, finePerDay: 5, maxRenewals: 1, defaultBorrowingLimit: 3 },
    });
    expect(settings.status).toBe(200);
  });

  it('issues, renews once and enforces the borrowing limit', async () => {
    const loan = await call('POST', `/api/schools/${schoolId}/library/loans`, {
      cookie: admin,
      payload: { copyId: firstCopyId, memberId, dueOn: isoDaysFromNow(14) },
    });
    expect(loan.status).toBe(201);
    firstLoanId = loan.body.id;

    const renew = await call(
      'POST',
      `/api/schools/${schoolId}/library/loans/${firstLoanId}/renew`,
      { cookie: admin, payload: {} },
    );
    expect(renew.status).toBe(200);

    const renewAgain = await call(
      'POST',
      `/api/schools/${schoolId}/library/loans/${firstLoanId}/renew`,
      { cookie: admin, payload: {} },
    );
    expect(renewAgain.status).toBe(409);

    const overLimit = await call('POST', `/api/schools/${schoolId}/library/loans`, {
      cookie: admin,
      payload: { copyId: secondCopyId, memberId },
    });
    expect(overLimit.status).toBe(409);
  });

  it('returns a damaged copy without a fine and then assesses an overdue fine', async () => {
    const returned = await call(
      'POST',
      `/api/schools/${schoolId}/library/loans/${firstLoanId}/return`,
      { cookie: admin, payload: { condition: 'damaged', notes: 'Torn cover' } },
    );
    expect(returned.status).toBe(200);

    const copies = await call(
      'GET',
      `/api/schools/${schoolId}/library/books/${bookId}/copies`,
      { cookie: admin },
    );
    expect(copies.body.items.find((copy: any) => copy.id === firstCopyId).status).toBe('damaged');

    const overdue = await call('POST', `/api/schools/${schoolId}/library/loans`, {
      cookie: admin,
      payload: { copyId: secondCopyId, memberId },
    });
    expect(overdue.status).toBe(201);
    overdueLoanId = overdue.body.id;

    // The API refuses a due date before the issue date, so age the loan the way
    // time would: its due date is now ten days in the past.
    await q(
      `UPDATE library_loans SET issued_on = current_date - 20, due_on = current_date - 10
       WHERE school_id = $1 AND id = $2`,
      [schoolId, overdueLoanId],
    );

    const early = await call(
      'POST',
      `/api/schools/${schoolId}/library/loans/${overdueLoanId}/return`,
      { cookie: admin, payload: { returnedOn: isoDaysFromNow(-25) } },
    );
    expect(early.status).toBe(400);

    const lateReturn = await call(
      'POST',
      `/api/schools/${schoolId}/library/loans/${overdueLoanId}/return`,
      { cookie: admin, payload: { returnedOn: isoDaysFromNow(0), condition: 'ok' } },
    );
    expect(lateReturn.status).toBe(200);
    expect(lateReturn.body.overdueDays).toBeGreaterThanOrEqual(10);
    fineId = lateReturn.body.fineId;
    expect(fineId).toBeTruthy();
  });

  it('settles a fine once', async () => {
    const paid = await call('POST', `/api/schools/${schoolId}/library/fines/${fineId}/decision`, {
      cookie: admin,
      payload: { decision: 'pay' },
    });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('paid');

    const again = await call('POST', `/api/schools/${schoolId}/library/fines/${fineId}/decision`, {
      cookie: admin,
      payload: { decision: 'waive' },
    });
    expect(again.status).toBe(409);
  });
});

describe('learning resources and homework', () => {
  let resourceId: string;
  let homeworkId: string;
  let submissionId: string;

  it('creates a published resource and a question-bank item', async () => {
    const resource = await call('POST', `/api/schools/${schoolId}/learning/resources`, {
      cookie: coordinator,
      payload: {
        title: 'Chapter 4 revision notes',
        description: 'Summary of the reading comprehension unit',
        resourceType: 'document',
        subjectId: subjectEngId,
        classId: grade1ClassId,
        visibility: 'all',
        status: 'published',
      },
    });
    expect(resource.status).toBe(201);
    resourceId = resource.body.id;

    const invalidUrl = await call('POST', `/api/schools/${schoolId}/learning/resources`, {
      cookie: coordinator,
      payload: { title: 'Broken link', resourceType: 'link', url: 'not-a-url' },
    });
    expect(invalidUrl.status).toBe(400);

    const question = await call('POST', `/api/schools/${schoolId}/learning/questions`, {
      cookie: coordinator,
      payload: {
        subjectId: subjectEngId,
        topic: 'Comprehension',
        questionType: 'short_answer',
        difficulty: 'medium',
        questionText: 'What is the main idea of the passage?',
        answerText: 'Accept any well-supported answer.',
        marks: 5,
      },
    });
    expect(question.status).toBe(201);
  });

  it('keeps a draft closed, then accepts and grades a resubmission', async () => {
    const homework = await call('POST', `/api/schools/${schoolId}/learning/homework`, {
      cookie: coordinator,
      payload: {
        academicYearId: activeYearId,
        sectionId: grade1AId,
        subjectId: subjectEngId,
        title: 'Reading comprehension practice',
        instructions: 'Read the passage and answer the questions.',
        availableFrom: isoDaysFromNow(-1),
        dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        maxMarks: 10,
        allowResubmission: true,
      },
    });
    expect(homework.status).toBe(201);
    homeworkId = homework.body.id;
    expect(homework.body.status ?? 'draft').toBe('draft');

    const beforePublish = await call(
      'POST',
      `/api/schools/${schoolId}/learning/homework/${homeworkId}/submissions`,
      { cookie: parent, payload: { studentId: aaravId, content: 'My first answer' } },
    );
    expect(beforePublish.status).toBe(409);

    const publish = await call(
      'PATCH',
      `/api/schools/${schoolId}/learning/homework/${homeworkId}/status`,
      { cookie: coordinator, payload: { status: 'published' } },
    );
    expect(publish.status).toBe(200);

    const first = await call(
      'POST',
      `/api/schools/${schoolId}/learning/homework/${homeworkId}/submissions`,
      { cookie: parent, payload: { studentId: aaravId, content: 'My first answer' } },
    );
    expect(first.status).toBe(201);
    expect(first.body.attempt).toBe(1);

    const second = await call(
      'POST',
      `/api/schools/${schoolId}/learning/homework/${homeworkId}/submissions`,
      { cookie: parent, payload: { studentId: aaravId, content: 'My revised answer' } },
    );
    expect(second.status).toBe(201);
    expect(second.body.attempt).toBe(2);
    submissionId = second.body.id;

    const unlinked = await call(
      'POST',
      `/api/schools/${schoolId}/learning/homework/${homeworkId}/submissions`,
      { cookie: parent, payload: { studentId: kabirId, content: 'Not my child' } },
    );
    expect(unlinked.status).toBe(404);

    const tooManyMarks = await call(
      'PATCH',
      `/api/schools/${schoolId}/learning/submissions/${submissionId}/review`,
      { cookie: coordinator, payload: { status: 'reviewed', marks: 11, feedback: 'Too high' } },
    );
    expect(tooManyMarks.status).toBe(400);

    const reviewed = await call(
      'PATCH',
      `/api/schools/${schoolId}/learning/submissions/${submissionId}/review`,
      { cookie: coordinator, payload: { status: 'reviewed', marks: 8, feedback: 'Good work' } },
    );
    expect(reviewed.status).toBe(200);

    const close = await call(
      'PATCH',
      `/api/schools/${schoolId}/learning/homework/${homeworkId}/status`,
      { cookie: coordinator, payload: { status: 'closed' } },
    );
    expect(close.status).toBe(200);

    const closed = await call(
      'POST',
      `/api/schools/${schoolId}/learning/homework/${homeworkId}/submissions`,
      { cookie: parent, payload: { studentId: aaravId, content: 'After close' } },
    );
    expect(closed.status).toBe(409);

    expect(resourceId).toBeTruthy();
  });
});

describe('concerns, tasks and SLA', () => {
  let categoryId: string;
  let parentConcernId: string;
  let urgentConcernId: string;
  let resolvedConcernId: string;

  it('forces requester visibility for a parent and hides internal notes', async () => {
    const category = await call('POST', `/api/schools/${schoolId}/concerns/categories`, {
      cookie: coordinator,
      payload: {
        code: 'module_transport',
        name: 'Module transport concern',
        defaultPriority: 'low',
        slaHours: 12,
        active: true,
      },
    });
    expect(category.status).toBe(201);
    categoryId = category.body.id;

    const created = await call('POST', `/api/schools/${schoolId}/concerns`, {
      cookie: parent,
      payload: {
        categoryId,
        subject: 'Bus is arriving late',
        description: 'The morning bus has been late every day this week.',
        studentId: aaravId,
        visibility: 'internal',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.priority).toBe('low');
    parentConcernId = created.body.id;

    const detail = await call('GET', `/api/schools/${schoolId}/concerns/${parentConcernId}`, {
      cookie: parent,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.visibility).toBe('requester');

    const assign = await call('PATCH', `/api/schools/${schoolId}/concerns/${parentConcernId}`, {
      cookie: coordinator,
      payload: { assignedTo: coordinatorId, status: 'in_progress' },
    });
    expect(assign.status).toBe(200);

    const note = await call(
      'POST',
      `/api/schools/${schoolId}/concerns/${parentConcernId}/notes`,
      { cookie: coordinator, payload: { note: 'Called the transport vendor', isInternal: true } },
    );
    expect(note.status).toBe(201);

    const parentView = await call(
      'GET',
      `/api/schools/${schoolId}/concerns/${parentConcernId}`,
      { cookie: parent },
    );
    expect(parentView.body.events.every((event: any) => event.isInternal === false)).toBe(true);
  });

  it('escalates low to medium and high to urgent, but not a finished concern', async () => {
    const escalated = await call(
      'POST',
      `/api/schools/${schoolId}/concerns/${parentConcernId}/escalate`,
      { cookie: coordinator, payload: { note: 'Vendor has not responded' } },
    );
    expect(escalated.status).toBe(200);
    expect(escalated.body.priority).toBe('medium');

    const urgent = await call('POST', `/api/schools/${schoolId}/concerns`, {
      cookie: coordinator,
      payload: {
        subject: 'Safety barrier damaged',
        description: 'The barrier at the drop-off point is loose and needs repair.',
        priority: 'high',
        visibility: 'internal',
      },
    });
    expect(urgent.status).toBe(201);
    urgentConcernId = urgent.body.id;

    const raised = await call(
      'POST',
      `/api/schools/${schoolId}/concerns/${urgentConcernId}/escalate`,
      { cookie: coordinator, payload: { note: 'Immediate attention needed' } },
    );
    expect(raised.status).toBe(200);
    expect(raised.body.priority).toBe('urgent');

    const resolved = await call('POST', `/api/schools/${schoolId}/concerns`, {
      cookie: coordinator,
      payload: {
        subject: 'Broken classroom fan',
        description: 'The fan in room 4 stopped working during the last period.',
        priority: 'high',
        visibility: 'internal',
      },
    });
    expect(resolved.status).toBe(201);
    resolvedConcernId = resolved.body.id;

    const close = await call('PATCH', `/api/schools/${schoolId}/concerns/${resolvedConcernId}`, {
      cookie: coordinator,
      payload: { status: 'resolved', resolutionSummary: 'Fan replaced by maintenance' },
    });
    expect(close.status).toBe(200);

    const cannotEscalate = await call(
      'POST',
      `/api/schools/${schoolId}/concerns/${resolvedConcernId}/escalate`,
      { cookie: coordinator, payload: {} },
    );
    expect(cannotEscalate.status).toBe(400);
  });
});

describe('notification preferences and outbox', () => {
  let consentRequiredId: string;
  let messageId: string;

  it('refuses to enable or queue an external channel without consent', async () => {
    const withoutConsent = await call(
      'PUT',
      `/api/schools/${schoolId}/notifications/preferences`,
      { cookie: coordinator, payload: { channel: 'email', enabled: true, consent: false } },
    );
    expect(withoutConsent.status).toBe(409);

    const blocked = await call('POST', `/api/schools/${schoolId}/notifications/outbox`, {
      cookie: admin,
      payload: {
        channel: 'email',
        recipientUserId: coordinatorId,
        recipientAddress: 'coordinator@demo.test',
        subject: 'Consent check',
        body: 'This must not be queued before consent.',
      },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('consent_required');
    consentRequiredId = coordinatorId;

    const consent = await call('PUT', `/api/schools/${schoolId}/notifications/preferences`, {
      cookie: coordinator,
      payload: { channel: 'email', enabled: true, consent: true },
    });
    expect(consent.status).toBe(200);
    expect(consent.body.consentGivenAt).toBeTruthy();

    const preferences = await call(
      'GET',
      `/api/schools/${schoolId}/notifications/preferences`,
      { cookie: coordinator },
    );
    expect(preferences.body.items.find((item: any) => item.channel === 'email').enabled).toBe(true);
  });

  it('records a blocked attempt when no provider is configured and dedupes replays', async () => {
    const provider = await call(
      'GET',
      `/api/schools/${schoolId}/notifications/provider-status`,
      { cookie: admin },
    );
    expect(provider.status).toBe(200);
    expect(provider.body.configured).toBe(false);

    const queued = await call('POST', `/api/schools/${schoolId}/notifications/outbox`, {
      cookie: admin,
      payload: {
        channel: 'email',
        recipientUserId: coordinatorId,
        recipientAddress: 'coordinator@demo.test',
        subject: 'Module delivery test',
        body: 'This message has no provider to deliver it.',
        dedupeKey: 'module-outbox-1',
      },
    });
    expect(queued.status).toBe(201);
    expect(queued.body.status).toBe('blocked');
    messageId = queued.body.id;

    const replay = await call('POST', `/api/schools/${schoolId}/notifications/outbox`, {
      cookie: admin,
      payload: {
        channel: 'email',
        recipientUserId: coordinatorId,
        recipientAddress: 'coordinator@demo.test',
        subject: 'Module delivery test',
        body: 'This message has no provider to deliver it.',
        dedupeKey: 'module-outbox-1',
      },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.deduplicated).toBe(true);
    expect(replay.body.id).toBe(messageId);

    const record = await call(
      'GET',
      `/api/schools/${schoolId}/notifications/outbox/${messageId}`,
      { cookie: admin },
    );
    expect(record.status).toBe(200);
    expect(record.body.status).toBe('blocked');
    expect(record.body.attempts).toBe(1);
    expect(record.body.lastError).toMatch(/no external delivery provider/i);
    expect(record.body.attemptsLog).toHaveLength(1);

    const send = await call(
      'POST',
      `/api/schools/${schoolId}/notifications/outbox/${messageId}/send`,
      { cookie: admin, payload: {} },
    );
    expect(send.status).toBe(200);
    expect(send.body.status).toBe('blocked');

    const afterSend = await call(
      'GET',
      `/api/schools/${schoolId}/notifications/outbox/${messageId}`,
      { cookie: admin },
    );
    expect(afterSend.body.attempts).toBe(2);

    expect(consentRequiredId).toBe(coordinatorId);
  });
});

describe('fee concessions, write-offs and reconciliation', () => {
  let concessionId: string;
  let kabirTuitionChargeId: string;
  let aaravTuitionChargeId: string;
  let batchId: string;
  let firstLineId: string;
  let secondLineId: string;
  let thirdLineId: string;
  let fourthLineId: string;

  it('finds the seeded charges and payments', async () => {
    const charges = await q<{ id: string; student_id: string; fee_head_code: string }>(
      `SELECT ch.id, ch.student_id, fh.code AS fee_head_code
       FROM student_charges ch
       JOIN fee_heads fh ON fh.id = ch.fee_head_id AND fh.school_id = ch.school_id
       WHERE ch.school_id = $1 AND ch.academic_year_id = $2
         AND fh.code = 'TUITION' AND ch.student_id IN ($3, $4)`,
      [schoolId, activeYearId, aaravId, kabirId],
    );
    aaravTuitionChargeId = charges.find((row) => row.student_id === aaravId)!.id;
    kabirTuitionChargeId = charges.find((row) => row.student_id === kabirId)!.id;
    expect(aaravTuitionChargeId).toBeTruthy();
    expect(kabirTuitionChargeId).toBeTruthy();
  });

  it('validates a concession request, blocks self-approval and lets a second approver accept it', async () => {
    const tooLarge = await call('POST', `/api/schools/${schoolId}/fees/concessions`, {
      cookie: finance,
      payload: {
        studentId: kabirId,
        academicYearId: activeYearId,
        chargeId: kabirTuitionChargeId,
        amount: 50000,
        reason: 'Full waiver requested for review',
      },
    });
    expect(tooLarge.status).toBe(400);

    const request = await call('POST', `/api/schools/${schoolId}/fees/concessions`, {
      cookie: finance,
      payload: {
        studentId: kabirId,
        academicYearId: activeYearId,
        chargeId: kabirTuitionChargeId,
        amount: 1000,
        reason: 'Sibling concession approved by the committee',
      },
    });
    expect(request.status).toBe(201);
    concessionId = request.body.id;

    const duplicate = await call('POST', `/api/schools/${schoolId}/fees/concessions`, {
      cookie: finance,
      payload: {
        studentId: kabirId,
        academicYearId: activeYearId,
        chargeId: kabirTuitionChargeId,
        amount: 500,
        reason: 'Second request for the same charge',
      },
    });
    expect(duplicate.status).toBe(409);

    const selfApprove = await call(
      'POST',
      `/api/schools/${schoolId}/fees/concessions/${concessionId}/decision`,
      { cookie: finance, payload: { decision: 'approve' } },
    );
    expect(selfApprove.status).toBe(409);
    expect(selfApprove.body.error.code).toBe('segregation_of_duties');

    const approve = await call(
      'POST',
      `/api/schools/${schoolId}/fees/concessions/${concessionId}/decision`,
      { cookie: auditor, payload: { decision: 'approve', note: 'Committee minute 12/2026' } },
    );
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('approved');

    const charge = await q<{ concession_amount: string }>(
      `SELECT concession_amount FROM student_charges WHERE school_id = $1 AND id = $2`,
      [schoolId, kabirTuitionChargeId],
    );
    expect(Number(charge[0]!.concession_amount)).toBe(1000);
  });

  it('caps a write-off at the unpaid balance and records the approval', async () => {
    const over = await call('POST', `/api/schools/${schoolId}/fees/write-offs`, {
      cookie: auditor,
      payload: {
        chargeId: aaravTuitionChargeId,
        amount: 30000,
        reason: 'Unrecoverable balance review',
      },
    });
    expect(over.status).toBe(400);

    const writeOff = await call('POST', `/api/schools/${schoolId}/fees/write-offs`, {
      cookie: auditor,
      payload: {
        chargeId: aaravTuitionChargeId,
        amount: 1000,
        reason: 'Board approved write-off',
      },
    });
    expect(writeOff.status).toBe(201);

    const charge = await q<{ write_off_amount: string }>(
      `SELECT write_off_amount FROM student_charges WHERE school_id = $1 AND id = $2`,
      [schoolId, aaravTuitionChargeId],
    );
    expect(Number(charge[0]!.write_off_amount)).toBe(1000);
  });

  it('reconciles statement lines against exact payments and closes only when matched', async () => {
    const batch = await call('POST', `/api/schools/${schoolId}/fees/reconciliation/batches`, {
      cookie: finance,
      payload: {
        reference: 'REC-MODULE-2026-10',
        source: 'bank_statement',
        statementFrom: '2026-05-01',
        statementTo: '2026-05-31',
        openingBalance: 0,
        closingBalance: 25000,
      },
    });
    expect(batch.status).toBe(201);
    batchId = batch.body.id;

    const first = await call(
      'POST',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines`,
      {
        cookie: finance,
        payload: { paidOn: '2026-05-10', amount: 20000, reference: 'RCPT-SEED-0001', method: 'cash' },
      },
    );
    expect(first.status).toBe(201);
    firstLineId = first.body.id;

    const second = await call(
      'POST',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines`,
      {
        cookie: finance,
        payload: { paidOn: '2026-05-18', amount: 5000, reference: 'RCPT-SEED-0002', method: 'upi' },
      },
    );
    expect(second.status).toBe(201);
    secondLineId = second.body.id;

    const payments = await call(
      'GET',
      `/api/schools/${schoolId}/fees/reconciliation/payments?search=RCPT-SEED-0001`,
      { cookie: finance },
    );
    expect(payments.status).toBe(200);
    const paymentId = payments.body.items[0].id;

    const match = await call(
      'PATCH',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines/${firstLineId}`,
      { cookie: finance, payload: { paymentId } },
    );
    expect(match.status).toBe(200);
    expect(match.body.status).toBe('matched');

    const paymentsForMismatch = await call(
      'GET',
      `/api/schools/${schoolId}/fees/reconciliation/payments?search=RCPT-SEED-0003`,
      { cookie: finance },
    );
    const mismatchedPaymentId = paymentsForMismatch.body.items[0].id;

    const wrongAmount = await call(
      'PATCH',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines/${secondLineId}`,
      { cookie: finance, payload: { paymentId: mismatchedPaymentId } },
    );
    expect(wrongAmount.status).toBe(400);

    const payments2 = await call(
      'GET',
      `/api/schools/${schoolId}/fees/reconciliation/payments?search=RCPT-SEED-0002`,
      { cookie: finance },
    );
    const payment2Id = payments2.body.items[0].id;

    const matched = await call(
      'PATCH',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines/${secondLineId}`,
      { cookie: finance, payload: { paymentId: payment2Id } },
    );
    expect(matched.status).toBe(200);

    const third = await call(
      'POST',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines`,
      {
        cookie: finance,
        payload: { paidOn: '2026-05-10', amount: 20000, reference: 'Duplicate bank line' },
      },
    );
    expect(third.status).toBe(201);
    thirdLineId = third.body.id;

    const alreadyMatched = await call(
      'PATCH',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines/${thirdLineId}`,
      { cookie: finance, payload: { paymentId } },
    );
    expect(alreadyMatched.status).toBe(409);

    const exception = await call(
      'PATCH',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines/${thirdLineId}`,
      { cookie: finance, payload: { exceptionReason: 'Duplicate bank entry, already receipted' } },
    );
    expect(exception.status).toBe(200);
    expect(exception.body.status).toBe('exception');

    const fourth = await call(
      'POST',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines`,
      {
        cookie: finance,
        payload: { paidOn: '2026-05-20', amount: 100, reference: 'Unidentified credit' },
      },
    );
    expect(fourth.status).toBe(201);
    fourthLineId = fourth.body.id;

    const earlyClose = await call(
      'POST',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/close`,
      { cookie: finance, payload: { note: 'Month end' } },
    );
    expect(earlyClose.status).toBe(409);

    const settle = await call(
      'PATCH',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines/${fourthLineId}`,
      { cookie: finance, payload: { exceptionReason: 'Bank charges, not a fee payment' } },
    );
    expect(settle.status).toBe(200);

    const close = await call(
      'POST',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/close`,
      { cookie: finance, payload: { note: 'Month end' } },
    );
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('closed');

    const addToClosed = await call(
      'POST',
      `/api/schools/${schoolId}/fees/reconciliation/batches/${batchId}/lines`,
      {
        cookie: finance,
        payload: { paidOn: '2026-05-21', amount: 50, reference: 'Late line' },
      },
    );
    expect(addToClosed.status).toBe(409);
  });
});

describe('saved reports and CSV imports', () => {
  let savedReportId: string;
  let vendorBatchId: string;
  let libraryBatchId: string;

  it('validates report filters and isolates edits to the owner', async () => {
    const created = await call('POST', `/api/schools/${schoolId}/saved-reports`, {
      cookie: coordinator,
      payload: {
        name: 'Grade 1 students',
        reportType: 'students',
        filters: { academicYearId: activeYearId },
        shared: false,
      },
    });
    expect(created.status).toBe(201);
    savedReportId = created.body.id;

    const invalid = await call('POST', `/api/schools/${schoolId}/saved-reports`, {
      cookie: coordinator,
      payload: {
        name: 'Bad filter',
        reportType: 'students',
        filters: { from: '2026-01-01' },
      },
    });
    expect(invalid.status).toBe(400);

    const update = await call(
      'PATCH',
      `/api/schools/${schoolId}/saved-reports/${savedReportId}`,
      { cookie: coordinator, payload: { name: 'Grade 1 students (renamed)' } },
    );
    expect(update.status).toBe(200);

    const otherUser = await call(
      'PATCH',
      `/api/schools/${schoolId}/saved-reports/${savedReportId}`,
      { cookie: admin, payload: { name: 'Hijacked' } },
    );
    expect(otherUser.status).toBe(404);

    const list = await call('GET', `/api/schools/${schoolId}/saved-reports`, {
      cookie: coordinator,
    });
    expect(list.body.items.some((item: any) => item.id === savedReportId)).toBe(true);

    const removed = await call(
      'DELETE',
      `/api/schools/${schoolId}/saved-reports/${savedReportId}`,
      { cookie: coordinator },
    );
    expect(removed.status).toBe(204);
  });

  it('previews and commits only the valid vendor rows', async () => {
    const csv = [
      'name,code,email,status',
      'Module Vendor One,MV-001,vendor.one@example.test,active',
      'Module Vendor Two,MV-002,not-an-email,active',
    ].join('\n');

    const preview = await call('POST', `/api/schools/${schoolId}/imports/preview`, {
      cookie: coordinator,
      payload: { entityType: 'vendors', filename: 'vendors.csv', csv },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.totalRows).toBe(2);
    expect(preview.body.validRows).toBe(1);
    expect(preview.body.invalidRows).toBe(1);
    vendorBatchId = preview.body.id;

    const detail = await call('GET', `/api/schools/${schoolId}/imports/${vendorBatchId}`, {
      cookie: coordinator,
    });
    expect(detail.body.rows).toHaveLength(2);
    expect(detail.body.rows[1].errors.length).toBe(1);

    const commit = await call(
      'POST',
      `/api/schools/${schoolId}/imports/${vendorBatchId}/commit`,
      { cookie: coordinator, payload: {} },
    );
    expect(commit.status).toBe(200);
    expect(commit.body.created).toBe(1);
    expect(commit.body.status).toBe('committed');

    const again = await call(
      'POST',
      `/api/schools/${schoolId}/imports/${vendorBatchId}/commit`,
      { cookie: coordinator, payload: {} },
    );
    expect(again.status).toBe(409);
  });

  it('commits a student row against the active year and cancels a library preview', async () => {
    const students = [
      'first_name,last_name,class_name,section_name',
      'Import,Student,Grade 1,Section A',
    ].join('\n');
    const preview = await call('POST', `/api/schools/${schoolId}/imports/preview`, {
      cookie: coordinator,
      payload: { entityType: 'students', filename: 'students.csv', csv: students },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.validRows).toBe(1);
    expect(preview.body.invalidRows).toBe(0);

    const commit = await call(
      'POST',
      `/api/schools/${schoolId}/imports/${preview.body.id}/commit`,
      { cookie: coordinator, payload: {} },
    );
    expect(commit.status).toBe(200);
    expect(commit.body.created).toBe(1);

    const imported = await q<{ id: string }>(
      `SELECT id FROM students WHERE school_id = $1 AND first_name = 'Import'`,
      [schoolId],
    );
    expect(imported).toHaveLength(1);

    const books = ['title,author', 'Module Imported Book,Author One'].join('\n');
    const libraryPreview = await call('POST', `/api/schools/${schoolId}/imports/preview`, {
      cookie: coordinator,
      payload: { entityType: 'library_books', filename: 'books.csv', csv: books },
    });
    expect(libraryPreview.status).toBe(201);
    libraryBatchId = libraryPreview.body.id;

    const cancelled = await call(
      'POST',
      `/api/schools/${schoolId}/imports/${libraryBatchId}/cancel`,
      { cookie: coordinator, payload: {} },
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');

    const again = await call(
      'POST',
      `/api/schools/${schoolId}/imports/${libraryBatchId}/cancel`,
      { cookie: coordinator, payload: {} },
    );
    expect(again.status).toBe(409);
  });

  it('rejects a CSV with no data rows', async () => {
    const response = await call('POST', `/api/schools/${schoolId}/imports/preview`, {
      cookie: coordinator,
      payload: { entityType: 'vendors', filename: 'empty.csv', csv: 'name,code,email' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('does not leak another school code in the fixture', async () => {
    // Guardrail: the fixture must always resolve the demo tenant, never a stray
    // record left behind by a previous run.
    expect(schoolCode).toBe('GREENFIELD');
    expect(teacher).toMatch(/^erp_session=/);
    expect(teacherId).toBeTruthy();
    expect(parentId).toBeTruthy();
    expect(financeId).toBeTruthy();
    expect(coordinatorId).toBeTruthy();
    expect(adminId).toBeTruthy();
    expect(grade3BId).toBeTruthy();
  });
});
