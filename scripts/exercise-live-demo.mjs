import assert from 'node:assert/strict';

const origin = 'https://schoolerp.digivistainfotech.in';
const credentials = JSON.parse(process.env.SCHOOLERP_LIVE_DEMO_PASSWORDS ?? '{}');
const sessions = new Map();
const results = [];
const requestedJourneys = new Set(process.argv.slice(2));
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const items = (result) => Array.isArray(result) ? result : result.items;

async function login(role) {
  if (sessions.has(role)) return sessions.get(role);
  assert.ok(credentials[role], `Missing demo credential for ${role}`);
  const response = await fetch(origin + '/api/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${role}@erp-live-demo.test`, password: credentials[role] }),
    signal: AbortSignal.timeout(25_000),
  });
  assert.ok(response.ok, `Login for ${role} returned HTTP ${response.status}`);
  const { user, memberships } = await response.json();
  assert.equal(memberships.length, 1, 'Demo user must have one institution membership');
  assert.equal(memberships[0].schoolCode, 'DIGIVISTA_DEMO', 'Unexpected institution');
  const cookie = response.headers.getSetCookie().find((entry) => entry.startsWith('erp_session='))?.split(';')[0];
  assert.ok(cookie, 'Missing demo session');
  const session = { schoolId: memberships[0].schoolId, userId: user.id, cookie };
  sessions.set(role, session);
  return session;
}

async function call(role, method, path, body, expected = 200, key) {
  const session = await login(role);
  const headers = { Origin: origin, Cookie: session.cookie };
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}/api/schools/${session.schoolId}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status !== expected) {
    const failure = await response.json().catch(() => null);
    throw new Error(`${method} ${path.replaceAll(/[a-f0-9-]{36}/gi, ':id')} returned HTTP ${response.status}: ${failure?.error?.message ?? 'unexpected response'}`);
  }
  return response.headers.get('content-type')?.includes('json') ? response.json() : response.text();
}

async function journey(name, run) {
  if (requestedJourneys.size && !requestedJourneys.has(name)) return;
  try {
    const detail = await run();
    results.push({ name, passed: true, detail });
    console.log(`PASS ${name}: ${detail}`);
  } catch (error) {
    results.push({ name, passed: false, detail: error.message });
    console.error(`CHECK ${name}: ${error.message}`);
  }
}

try {
  const admin = await login('admin');
  const academicYears = items(await call('admin', 'GET', '/academic-years'));
  const academicYearId = academicYears.find((year) => year.status === 'active')?.id;
  assert.ok(academicYearId, 'Missing active demo academic year');
  const sections = items(await call('admin', 'GET', `/sections?academicYearId=${academicYearId}`));
  assert.ok(sections.length > 0, 'Missing demo sections');
  const roster = await call('admin', 'GET', '/students');
  assert.ok(roster.total >= 100, 'Expected at least 100 synthetic students');
  console.log(`Verified ${roster.total} students and ${sections.length} sections in the live demo institution.`);

  const other = process.env.SCHOOLERP_EXISTING_SCHOOL_ID;
  if (other && other !== admin.schoolId) {
    const attempt = await fetch(`${origin}/api/schools/${other}/students`, { headers: { Cookie: admin.cookie } });
    assert.ok([403, 404].includes(attempt.status), 'Demo user could access another institution');
    console.log('Demo administrator denied access to the existing institution.');
  }

  let demonstrationStudent;
  await journey('Admissions and fee receipt', async () => {
    const admissionNumber = 'DEMO-JOURNEY-001';
    const found = items(await call('admin', 'GET', `/students?search=${admissionNumber}`))
      .find((student) => student.admissionNumber === admissionNumber);
    demonstrationStudent = found ?? await call('admin', 'POST', '/students', {
      admissionNumber, firstName: 'Mira', lastName: 'Demo', dateOfBirth: '2015-08-12',
      academicYearId, sectionId: (sections.find((section) => section.className === 'Class 6') ?? sections[0]).id,
      startsOn: '2026-04-01',
      guardians: [{ firstName: 'Anika', lastName: 'Demo', relationshipType: 'Mother', isPrimary: true, email: 'anika.demo@erp-live-demo.test' }],
    }, 201, 'digivista-demo-admission-001');
    const studentId = demonstrationStudent.id;
    const ledgerPath = `/fees/students/${studentId}/ledger`;
    let ledger = await call('finance', 'GET', ledgerPath);
    const existingCharge = ledger.charges.find((charge) => charge.description === 'Demo term tuition');
    if (!existingCharge) {
      const head = items(await call('finance', 'GET', '/fee-heads')).find((entry) => entry.code === 'TUITION');
      assert.ok(head, 'Missing tuition fee head');
      await call('finance', 'POST', '/fees/charges', {
        studentId, academicYearId, feeHeadId: head.id, description: 'Demo term tuition',
        amount: 5000, concessionAmount: 0, dueOn: day(14),
      }, 201);
    }
    ledger = await call('finance', 'GET', ledgerPath);
    const existingPayment = ledger.payments.find((payment) => payment.reference === 'DEMO-CASH-001');
    const payment = existingPayment ?? await call('finance', 'POST', '/fees/payments', {
      studentId, academicYearId, amount: 2000, method: 'cash', reference: 'DEMO-CASH-001', paidOn: day(),
    }, 201, 'digivista-demo-fee-001');
    const receipt = await call('finance', 'GET', `/fees/payments/${payment.id}/receipt`);
    assert.match(receipt, /Fee receipt/i);
    const updated = await call('finance', 'GET', ledgerPath);
    assert.ok(updated.charges.some((charge) => Number(charge.amount) === 5000 && Number(charge.balance) === 3000),
      'Expected the demo charge to have an outstanding balance of 3,000');
    return `admitted ${admissionNumber}, recorded ₹2,000 cash, verified printable receipt ${payment.receiptNumber} and ₹3,000 balance`;
  });

  await journey('Library circulation', async () => {
    const studentId = demonstrationStudent?.id ?? items(roster)[0].id;
    const book = await call('librarian', 'POST', '/library/books', {
      title: 'Demo Library: Exploring the Night Sky', author: 'Digivista Teaching Team', copies: 2, status: 'active',
    }, 201);
    const [first, second] = items(await call('librarian', 'GET', `/library/books/${book.id}/copies`));
    const member = await call('librarian', 'POST', '/library/members', { studentId, borrowingLimit: 3, status: 'active' }, 201);
    const loan = await call('librarian', 'POST', '/library/loans', { copyId: first.id, memberId: member.id, dueOn: day(14) }, 201);
    await call('librarian', 'POST', `/library/loans/${loan.id}/return`, { condition: 'ok', notes: 'Synthetic demo return' });
    await call('librarian', 'POST', '/library/loans', { copyId: second.id, memberId: member.id, dueOn: day(14) }, 201);
    return 'created a member, issued and returned one copy, and left a second copy on loan for the demo';
  });

  await journey('Purchase request to vendor bill', async () => {
    const vendor = items(await call('finance', 'GET', '/vendors')).find((item) => item.name === 'Demo Science Supply Company');
    assert.ok(vendor, 'Missing demo supplier');
    const request = await call('finance', 'POST', '/purchase-requests', {
      title: 'Demo classroom consumables', department: 'Science', justification: 'Synthetic replenishment example',
      items: [{ description: 'Beaker set', quantity: 2, estimatedUnitPrice: 500 }],
    }, 201);
    await call('finance', 'POST', `/purchase-requests/${request.id}/decision`, { decision: 'submit' });
    await call('admin', 'POST', `/purchase-requests/${request.id}/decision`, { decision: 'approve', note: 'Synthetic second-person review' });
    const order = await call('finance', 'POST', '/purchase-orders', {
      vendorId: vendor.id, requestId: request.id, orderDate: day(),
      items: [{ description: 'Beaker set', quantity: 2, unitPrice: 500 }],
    }, 201);
    await call('admin', 'POST', `/purchase-orders/${order.id}/decision`, { decision: 'approve' });
    const orders = items(await call('admin', 'GET', '/purchase-orders'));
    const orderItem = orders.find((entry) => entry.id === order.id).items[0];
    await call('admin', 'POST', '/goods-receipts', { poId: order.id, items: [{ poItemId: orderItem.id, quantity: 2 }] }, 201);
    const bill = await call('finance', 'POST', '/vendor-bills', {
      vendorId: vendor.id, poId: order.id, billNumber: 'DEMO-INV-001', billDate: day(), dueOn: day(15), amount: 1000,
    }, 201);
    await call('admin', 'POST', `/vendor-bills/${bill.id}/decision`, { decision: 'approve' });
    await call('finance', 'POST', `/vendor-bills/${bill.id}/pay`, { paidOn: day() });
    return 'verified second-person approval, purchase order, goods receipt, and recorded synthetic bill payment';
  });

  await journey('Recruitment and onboarding', async () => {
    const vacancy = items(await call('hr', 'GET', '/vacancies')).find((item) => item.title === 'Demo Mathematics Teacher');
    assert.ok(vacancy, 'Missing demo vacancy');
    const candidate = items(await call('hr', 'GET', `/candidates?vacancyId=${vacancy.id}`))
      .find((item) => item.email === 'nisha@erp-live-demo.test');
    assert.ok(candidate, 'Missing demo candidate');
    const coordinator = await login('coordinator');
    const interview = await call('hr', 'POST', `/candidates/${candidate.id}/interviews`, {
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), mode: 'video', interviewerUserId: coordinator.userId,
    }, 201);
    await call('hr', 'PATCH', `/interviews/${interview.id}`, {
      status: 'completed', score: 9, recommendation: 'strong_hire', feedback: 'Synthetic panel assessment',
    });
    const offer = await call('hr', 'POST', '/job-offers', {
      candidateId: candidate.id, designation: 'Mathematics Teacher', department: 'Mathematics',
      grossSalary: 52000, currency: 'INR', startsOn: day(30),
    }, 201);
    await call('hr', 'POST', `/job-offers/${offer.id}/decision`, { decision: 'submit' });
    await call('admin', 'POST', `/job-offers/${offer.id}/decision`, { decision: 'approve' });
    await call('hr', 'POST', `/job-offers/${offer.id}/decision`, { decision: 'accept' });
    const hired = await call('hr', 'POST', `/job-offers/${offer.id}/hire`, {}, 201);
    const tasks = items(await call('hr', 'GET', '/onboarding-tasks'));
    assert.ok(tasks.some((task) => task.staffId === hired.staffId), 'No onboarding tasks were generated');
    return 'opened a vacancy, reviewed an interview, approved an offer, hired the candidate, and checked onboarding tasks';
  });
} finally {
  await Promise.allSettled([...sessions.values()].map(({ cookie }) =>
    fetch(origin + '/api/auth/logout', { method: 'POST', headers: { Origin: origin, Cookie: cookie }, signal: AbortSignal.timeout(10_000) }),
  ));
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
