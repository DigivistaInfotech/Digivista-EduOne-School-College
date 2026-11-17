import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoSeedSummary } from '@erp/db';
import { generateSyntheticBiometricEmbedding } from '../src/lib/biometrics';

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
  headers?: Record<string, string>;
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  options: InjectOptions = {},
): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
  const response = await app.inject({
    method,
    url,
    payload: options.payload as never,
    headers: {
      origin: options.origin ?? 'http://localhost:5173',
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      ...(options.headers ? options.headers : {}),
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

async function login(email: string, password = 'Admin@12345'): Promise<string> {
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
    const { runHighScaleDemoSeed } = await import('@erp/db');
    seedSummary = await runHighScaleDemoSeed(client);
  } finally {
    client.release();
  }

  schoolId = seedSummary.schoolId;
});

afterAll(async () => {
  const { closePool } = await import('../src/db');
  await app?.close();
  await closePool();
  await stopDatabase?.();
});

/* -------------------------------------------------------------------------- */
/* 1. GEOFENCES CONFIGURATION & BOUNDARY AUDITS                               */
/* -------------------------------------------------------------------------- */
describe('Section 1: School Geofences Configuration & Boundary Audits', () => {
  let adminCookie: string;
  let teacherCookie: string;
  let createdGeofenceId: string;

  beforeAll(async () => {
    adminCookie = await login('admin@demo.test', 'Admin@12345');
    teacherCookie = await login('teacher@demo.test', 'Teacher@12345');
  });

  it('lists active school geofences with campus perimeter details', async () => {
    const res = await call('GET', `/api/schools/${schoolId}/staff/attendance/geofences`, {
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items.length).toBeGreaterThanOrEqual(4);

    const mainCampus = res.body.items.find((g: any) => g.name === 'Main Academic Block');
    expect(mainCampus).toBeDefined();
    expect(mainCampus.latitude).toBeCloseTo(26.853245, 4);
    expect(mainCampus.longitude).toBeCloseTo(80.946123, 4);
    expect(mainCampus.radiusMeters).toBe(150);
    expect(mainCampus.isActive).toBe(true);
  });

  it('allows administrator to create a new geofence perimeter', async () => {
    const res = await call('POST', `/api/schools/${schoolId}/staff/attendance/geofences`, {
      cookie: adminCookie,
      payload: {
        name: 'East Gate Athletic Pavilion',
        locationType: 'sports_ground',
        latitude: 26.85612,
        longitude: 80.94915,
        radiusMeters: 140,
        maxAccuracyThresholdMeters: 45,
        isActive: true,
        notes: 'Covers track & field bleachers and athletic changing rooms',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    createdGeofenceId = res.body.id;
  });

  it('allows administrator to update geofence radius and attributes', async () => {
    const res = await call(
      'PUT',
      `/api/schools/${schoolId}/staff/attendance/geofences/${createdGeofenceId}`,
      {
        cookie: adminCookie,
        payload: {
          name: 'East Gate Athletic Pavilion (Extended)',
          locationType: 'sports_ground',
          latitude: 26.85612,
          longitude: 80.94915,
          radiusMeters: 180,
          maxAccuracyThresholdMeters: 50,
          isActive: true,
          notes: 'Extended radius for annual athletics meet',
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const checkRes = await call('GET', `/api/schools/${schoolId}/staff/attendance/geofences`, {
      cookie: adminCookie,
    });
    const updated = checkRes.body.items.find((g: any) => g.id === createdGeofenceId);
    expect(updated).toBeDefined();
    expect(updated.radiusMeters).toBe(180);
    expect(updated.name).toBe('East Gate Athletic Pavilion (Extended)');
  });

  it('forbids unauthorized staff from creating school geofences', async () => {
    const res = await call('POST', `/api/schools/${schoolId}/staff/attendance/geofences`, {
      cookie: teacherCookie,
      payload: {
        name: 'Unauthorized Boundary',
        latitude: 26.85,
        longitude: 80.94,
      },
    });
    expect(res.status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. STAFF BIOMETRIC ENROLMENT & DPDPA 2023 CONSENT TRACKING                  */
/* -------------------------------------------------------------------------- */
describe('Section 2: Staff Biometric Enrolment & DPDPA 2023 Consent', () => {
  let adminCookie: string;
  let testStaffId: string;

  beforeAll(async () => {
    adminCookie = await login('admin@demo.test', 'Admin@12345');

    // Retrieve staff record for Rahul Menon (EMP-0002)
    const staffRes = await pool.query(
      `SELECT id FROM staff WHERE school_id = $1 AND employee_number = 'EMP-0002'`,
      [schoolId],
    );
    expect(staffRes.rows.length).toBe(1);
    testStaffId = staffRes.rows[0].id;
  });

  it('retrieves biometric profile status for unenrolled staff member', async () => {
    const res = await call(
      'GET',
      `/api/schools/${schoolId}/staff/${testStaffId}/biometrics`,
      { cookie: adminCookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.enrolled).toBe(false);
    expect(res.body.status).toBe('pending');
  });

  it('rejects enrolment without explicit DPDPA consent', async () => {
    const vector = generateSyntheticBiometricEmbedding('EMP-0002_SEED');
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/${testStaffId}/biometrics/enroll`,
      {
        cookie: adminCookie,
        payload: {
          consentGiven: false,
          embeddingVector: vector,
        },
      },
    );
    expect(res.status).toBe(400);
    const msg = res.body.error?.details?.consentGiven?.[0] || res.body.error?.message || '';
    expect(msg).toMatch(/Explicit consent is required/i);
  });

  it('successfully enrols staff member with valid 128-dim embedding and consent', async () => {
    const vector = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0002_${schoolId}`);
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/${testStaffId}/biometrics/enroll`,
      {
        cookie: adminCookie,
        payload: {
          consentGiven: true,
          consentVersion: 'v1.0-dpdpa',
          embeddingVector: vector,
          qualityScore: 98.2,
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.enrolmentId).toBeDefined();

    // Verify stored profile has encrypted template and sha256 hash
    const profileRes = await call(
      'GET',
      `/api/schools/${schoolId}/staff/${testStaffId}/biometrics`,
      { cookie: adminCookie },
    );
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.enrolled).toBe(true);
    expect(profileRes.body.status).toBe('enrolled');
    expect(profileRes.body.profile.templateHash).toBeDefined();
    expect(profileRes.body.profile.qualityScore).toBe(98.2);
  });

  it('allows consent revocation and purges the encrypted template vector', async () => {
    const withdrawRes = await call(
      'POST',
      `/api/schools/${schoolId}/staff/${testStaffId}/biometrics/withdraw-consent`,
      { cookie: adminCookie },
    );
    expect(withdrawRes.status).toBe(200);
    expect(withdrawRes.body.success).toBe(true);

    // Verify database state: status is 'withdrawn' and template is purged
    const dbCheck = await pool.query(
      `SELECT enrolment_status, template_data_encrypted, consent_withdrawn_at
       FROM staff_biometric_profiles
       WHERE school_id = $1 AND staff_id = $2`,
      [schoolId, testStaffId],
    );
    expect(dbCheck.rows[0].enrolment_status).toBe('withdrawn');
    expect(dbCheck.rows[0].template_data_encrypted).toBeNull();
    expect(dbCheck.rows[0].consent_withdrawn_at).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 3. PUNCH-IN & PUNCH-OUT STATE MACHINE & OPERATIONAL INTEGRATION             */
/* -------------------------------------------------------------------------- */
describe('Section 3: Punch-In & Punch-Out Workflow & State Management', () => {
  let teacherCookie: string;
  let teacherStaffId: string;

  beforeAll(async () => {
    teacherCookie = await login('teacher@demo.test', 'Teacher@12345');

    // Clean any prior punch events for teacher today to ensure clean state machine test
    const staffRow = await pool.query(
      `SELECT s.id FROM staff s
       JOIN users u ON u.id = s.user_id
       WHERE s.school_id = $1 AND u.email = 'teacher@demo.test'`,
      [schoolId],
    );
    teacherStaffId = staffRow.rows[0].id;

    await pool.query(
      `DELETE FROM staff_punch_events WHERE school_id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE`,
      [schoolId, teacherStaffId],
    );
    await pool.query(
      `DELETE FROM staff_attendance WHERE school_id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE`,
      [schoolId, teacherStaffId],
    );
  });

  it('returns current punch status indicating employee is not punched in', async () => {
    const res = await call(
      'GET',
      `/api/schools/${schoolId}/staff/attendance/punch/status`,
      { cookie: teacherCookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.currentPunchState).toBe('not_punched_in');
    expect(res.body.staff.employeeNumber).toBe('EMP-0003');
    expect(res.body.biometricEnrolled).toBe(true);
    expect(res.body.geofences.length).toBeGreaterThan(0);
  });

  it('executes valid punch-in within geofence with high-confidence face match', async () => {
    // Probe vector aligned with enrolled embedding
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0003_${schoolId}`);

    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: teacherCookie,
        payload: {
          punchType: 'punch_in',
          latitude: 26.853245,
          longitude: 80.946123,
          accuracyMeters: 8.5,
          locationTimestamp: Date.now(),
          probeEmbedding: probe,
          livenessProbe: {
            blinkDetected: true,
            motionScore: 95.0,
            textureVariance: 92.0,
          },
          deviceSource: 'employee_mobile',
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verificationStatus).toBe('verified');
    expect(res.body.punchType).toBe('punch_in');
    expect(res.body.telemetry.distanceMeters).toBeLessThanOrEqual(25);
    expect(res.body.telemetry.matchConfidence).toBeGreaterThanOrEqual(90);
    expect(res.body.punchEventId).toBeDefined();

    // Verify operational attendance record created in staff_attendance
    const attRow = await pool.query(
      `SELECT status, punch_in, punch_out FROM staff_attendance
       WHERE school_id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE`,
      [schoolId, teacherStaffId],
    );
    expect(attRow.rows.length).toBe(1);
    expect(attRow.rows[0].status).toBe('present');
    expect(attRow.rows[0].punch_in).not.toBeNull();
  });

  it('prevents duplicate punch-in attempts on the same work day', async () => {
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0003_${schoolId}`);

    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: teacherCookie,
        payload: {
          punchType: 'punch_in',
          latitude: 26.853245,
          longitude: 80.946123,
          accuracyMeters: 9.0,
          probeEmbedding: probe,
        },
      },
    );

    expect(res.status).toBe(409);
    expect(res.body.error?.message).toMatch(/already punched in/i);
  });

  it('executes valid punch-out linked to today punch-in', async () => {
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0003_${schoolId}`);

    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: teacherCookie,
        payload: {
          punchType: 'punch_out',
          latitude: 26.853240,
          longitude: 80.946120,
          accuracyMeters: 7.0,
          locationTimestamp: Date.now(),
          probeEmbedding: probe,
          livenessProbe: {
            blinkDetected: true,
            motionScore: 94.0,
          },
          deviceSource: 'employee_mobile',
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.punchType).toBe('punch_out');
    expect(res.body.verificationStatus).toBe('verified');

    // Verify punch_out is linked and staff_attendance updated
    const attRow = await pool.query(
      `SELECT punch_in, punch_out FROM staff_attendance
       WHERE school_id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE`,
      [schoolId, teacherStaffId],
    );
    expect(attRow.rows[0].punch_out).not.toBeNull();
  });

  it('rejects additional punch-in after employee has already completed full day', async () => {
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0003_${schoolId}`);

    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: teacherCookie,
        payload: {
          punchType: 'punch_in',
          latitude: 26.853245,
          longitude: 80.946123,
          probeEmbedding: probe,
        },
      },
    );

    expect(res.status).toBe(409);
    expect(res.body.error?.message).toMatch(/already completed/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. SECURITY BOUNDARIES: GEOFENCE REJECTION, POOR ACCURACY & FACE MISMATCH  */
/* -------------------------------------------------------------------------- */
describe('Section 4: Security Boundaries & Anti-Spoofing Rejections', () => {
  let financeCookie: string;
  let financeStaffId: string;

  beforeAll(async () => {
    financeCookie = await login('finance@demo.test', 'Finance@12345');

    const staffRow = await pool.query(
      `SELECT s.id FROM staff s
       JOIN users u ON u.id = s.user_id
       WHERE s.school_id = $1 AND u.email = 'finance@demo.test'`,
      [schoolId],
    );
    financeStaffId = staffRow.rows[0].id;

    // Clear finance today's punches for testing rejection scenarios
    await pool.query(
      `DELETE FROM staff_punch_events WHERE school_id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE`,
      [schoolId, financeStaffId],
    );
    await pool.query(
      `DELETE FROM staff_attendance WHERE school_id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE`,
      [schoolId, financeStaffId],
    );
  });

  it('rejects punch attempt located outside school geofence boundaries', async () => {
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0004_${schoolId}`);

    // Coordinates 2.5 km away from school
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: financeCookie,
        payload: {
          punchType: 'punch_in',
          latitude: 26.830000,
          longitude: 80.920000,
          accuracyMeters: 10.0,
          probeEmbedding: probe,
        },
      },
    );

    expect(res.status).toBe(400);
    expect(res.body.verificationStatus).toBe('out_of_geofence');
    expect(res.body.message).toMatch(/Outside authorized geofence/i);

    // Verify rejection telemetry logged in database
    const eventRow = await pool.query(
      `SELECT verification_status, failure_reason, distance_meters
       FROM staff_punch_events
       WHERE school_id = $1 AND staff_id = $2 AND verification_status = 'out_of_geofence'
       ORDER BY punched_at DESC LIMIT 1`,
      [schoolId, financeStaffId],
    );
    expect(eventRow.rows.length).toBe(1);
    expect(Number(eventRow.rows[0].distance_meters)).toBeGreaterThan(1000);
  });

  it('rejects punch attempt with poor GPS accuracy exceeding tolerance threshold', async () => {
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0004_${schoolId}`);

    // Inside geofence, but GPS accuracy is 180m (maximum threshold is 50m)
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: financeCookie,
        payload: {
          punchType: 'punch_in',
          latitude: 26.853245,
          longitude: 80.946123,
          accuracyMeters: 180.0,
          probeEmbedding: probe,
        },
      },
    );

    expect(res.status).toBe(400);
    expect(res.body.verificationStatus).toBe('poor_accuracy');
    expect(res.body.message).toMatch(/GPS accuracy.*is insufficient/i);
  });

  it('rejects punch attempt with facial biometric mismatch', async () => {
    // Generate mismatched probe vector from an unrelated random seed
    const wrongProbe = generateSyntheticBiometricEmbedding('COMPLETELY_UNRELATED_STRANGER_FACE');

    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: financeCookie,
        payload: {
          punchType: 'punch_in',
          latitude: 26.853245,
          longitude: 80.946123,
          accuracyMeters: 12.0,
          probeEmbedding: wrongProbe,
        },
      },
    );

    expect(res.status).toBe(400);
    expect(res.body.verificationStatus).toBe('face_mismatch');
    expect(res.body.message).toMatch(/Face identity does not match/i);
  });

  it('rejects punch attempt that fails anti-spoofing liveness check', async () => {
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0004_${schoolId}`);

    // High spoof probability (e.g. static photo or screen replay detected)
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/punch`,
      {
        cookie: financeCookie,
        payload: {
          punchType: 'punch_in',
          latitude: 26.853245,
          longitude: 80.946123,
          accuracyMeters: 10.0,
          probeEmbedding: probe,
          livenessProbe: {
            blinkDetected: false,
            motionScore: 12.0,
            textureVariance: 10.0,
            spoofProbability: 85.0,
          },
        },
      },
    );

    expect(res.status).toBe(400);
    expect(res.body.verificationStatus).toBe('liveness_failed');
    expect(res.body.message).toMatch(/Liveness verification failed/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. ATTENDANCE EXCEPTIONS & SEGREGATION OF DUTIES ENFORCEMENT               */
/* -------------------------------------------------------------------------- */
describe('Section 5: Attendance Exceptions & Segregated Supervisory Review', () => {
  let teacherCookie: string;
  let adminCookie: string;
  let teacherStaffId: string;
  let exceptionId: string;

  beforeAll(async () => {
    teacherCookie = await login('teacher@demo.test', 'Teacher@12345');
    adminCookie = await login('admin@demo.test', 'Admin@12345');

    const staffRow = await pool.query(
      `SELECT s.id FROM staff s
       JOIN users u ON u.id = s.user_id
       WHERE s.school_id = $1 AND u.email = 'teacher@demo.test'`,
      [schoolId],
    );
    teacherStaffId = staffRow.rows[0].id;
  });

  it('allows staff to submit an attendance exception for GPS hardware malfunction', async () => {
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/exceptions`,
      {
        cookie: teacherCookie,
        payload: {
          workDate: '2026-10-28',
          exceptionType: 'gps_failure',
          requestedPunchIn: '2026-10-28T07:55:00.000Z',
          requestedPunchOut: '2026-10-28T15:30:00.000Z',
          reason: 'Severe thunderstorm shielded GPS satellite signal at North gate entrance',
          supportingDocumentName: 'Gate_Security_Log_28Oct.pdf',
        },
      },
    );

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    exceptionId = res.body.id;
  });

  it('forbids unprivileged staff without approval permission from reviewing exceptions', async () => {
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/exceptions/${exceptionId}/review`,
      {
        cookie: teacherCookie,
        payload: {
          status: 'approved',
          reviewNotes: 'Unauthorized approval attempt',
        },
      },
    );

    expect(res.status).toBe(403);
    expect(res.body.error?.message).toMatch(/do not have permission/i);
  });

  it('enforces segregation of duties: supervisor cannot approve their own exception request', async () => {
    // Admin submits an exception for herself
    const adminReq = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/exceptions`,
      {
        cookie: adminCookie,
        payload: {
          workDate: '2026-10-27',
          exceptionType: 'camera_failure',
          reason: 'Accounts audit meeting at State Education Department',
        },
      },
    );
    expect(adminReq.status).toBe(201);
    const adminExceptionId = adminReq.body.id;

    // Admin attempts to self-approve her own exception
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/exceptions/${adminExceptionId}/review`,
      {
        cookie: adminCookie,
        payload: {
          status: 'approved',
          reviewNotes: 'Self-approval attempt by administrator',
        },
      },
    );

    expect(res.status).toBe(403);
    expect(res.body.error?.message).toMatch(/cannot approve your own/i);
  });

  it('allows administrator to approve exception and updates operational staff_attendance', async () => {
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/exceptions/${exceptionId}/review`,
      {
        cookie: adminCookie,
        payload: {
          status: 'approved',
          reviewNotes: 'Verified gate entry log and teacher presence in Primary classroom.',
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.decision).toBe('approved');

    // Verify operational attendance record created for 2026-10-28
    const attRow = await pool.query(
      `SELECT status, punch_in, punch_out, note
       FROM staff_attendance
       WHERE school_id = $1 AND staff_id = $2 AND work_date = '2026-10-28'`,
      [schoolId, teacherStaffId],
    );
    expect(attRow.rows.length).toBe(1);
    expect(attRow.rows[0].status).toBe('present');
    expect(attRow.rows[0].note).toMatch(/Approved exception \(gps_failure\)/i);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. DEDICATED ENTRANCE KIOSKS MANAGEMENT & KIOSK PUNCH                      */
/* -------------------------------------------------------------------------- */
describe('Section 6: Entrance Kiosk Registration & Kiosk Punch Terminal', () => {
  let adminCookie: string;
  const kioskSecretKey = 'KIOSK_SECRET_TEST_TOKEN_2026';

  beforeAll(async () => {
    adminCookie = await login('admin@demo.test', 'Admin@12345');
  });

  it('allows administrator to register a dedicated entrance kiosk device', async () => {
    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/kiosks`,
      {
        cookie: adminCookie,
        payload: {
          deviceCode: 'KIOSK-GATE-EAST-01',
          deviceName: 'East Gate Security Turnstile Terminal',
          apiKey: kioskSecretKey,
        },
      },
    );

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('lists active entrance kiosks with heartbeat status', async () => {
    const res = await call(
      'GET',
      `/api/schools/${schoolId}/staff/attendance/kiosks`,
      { cookie: adminCookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    const eastKiosk = res.body.items.find((k: any) => k.deviceCode === 'KIOSK-GATE-EAST-01');
    expect(eastKiosk).toBeDefined();
    expect(eastKiosk.status).toBe('active');
  });

  it('processes verified kiosk punch for enrolled staff member', async () => {
    // Generate probe embedding for transport fleet supervisor Gurpreet Singh (EMP-0006)
    const probe = generateSyntheticBiometricEmbedding(`STAFF_FACE_EMP-0006_${schoolId}`);

    const res = await call(
      'POST',
      `/api/schools/${schoolId}/staff/attendance/kiosk-punch`,
      {
        headers: {
          'x-kiosk-code': 'KIOSK-GATE-EAST-01',
          'x-kiosk-key': kioskSecretKey,
        },
        payload: {
          employeeCode: 'EMP-0006',
          punchType: 'punch_in',
          probeEmbedding: probe,
          livenessProbe: {
            blinkDetected: true,
            motionScore: 96.0,
          },
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verificationStatus).toBe('verified');
    expect(res.body.deviceSource).toBe('kiosk');
  });
});
