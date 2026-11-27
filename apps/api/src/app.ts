import { registerFeeCollectionRoutes } from './routes/feeCollection';
import { registerInstitutionMasterRoutes } from './routes/institutionMasters';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { SESSION_COOKIE, config } from './config';
import { getPool } from './db';
import { loadSessionUser } from './auth/session';
import { AppError, forbidden, mapDatabaseError } from './lib/errors';
import { readTrialExpiry } from './lib/trial';
import { registerAuthRoutes } from './routes/auth';
import { registerAcademicRoutes } from './routes/academic';
import { registerSubjectOfferingRoutes } from './routes/subjectOfferings';
import { registerStudentRoutes } from './routes/students';
import { registerAttendanceRoutes } from './routes/attendance';
import { registerTimetableRoutes } from './routes/timetable';
import { registerFeeRoutes } from './routes/fees';
import { registerFeeExtrasRoutes } from './routes/feeExtras';
import { registerExamRoutes } from './routes/exams';
import { registerStaffRoutes } from './routes/staff';
import { registerNoticeRoutes } from './routes/notices';
import { registerReportRoutes } from './routes/reports';
import { registerAccessRoutes } from './routes/access';
import { registerSafeguardingRoutes } from './routes/safeguarding';
import { registerLeaveConfigRoutes } from './routes/leaveConfig';
import { registerPayrollRoutes } from './routes/payroll';
import { registerSchoolRoutes } from './routes/school';
import { registerStaffAttendanceRoutes } from './routes/staffAttendance';
import { registerRecruitmentRoutes } from './routes/recruitment';
import { registerProcurementRoutes } from './routes/procurement';
import { registerTransportRoutes } from './routes/transport';
import { registerLibraryRoutes } from './routes/library';
import { registerLearningRoutes } from './routes/learning';
import { registerConcernRoutes } from './routes/concerns';
import { registerNotificationRoutes } from './routes/notifications';
import { registerReconciliationRoutes } from './routes/reconciliation';
import { registerSavedReportRoutes } from './routes/savedReports';
import { registerStudentPortalRoutes } from './routes/studentPortal';
import { registerOfflinePaymentRoutes } from './routes/offlinePayments';
import { registerAttendancePolicyRoutes } from './routes/attendancePolicy';
import { registerConfigStudioRoutes } from './routes/configStudio';
import { registerTeacherEligibilityRoutes } from './routes/teacherEligibility';
import { advancedAttendanceRoutes } from './routes/advancedAttendance';
import { parentPortalRoutes } from './routes/parentPortal';
import { registerGeoFaceAttendanceRoutes } from './routes/geoFaceAttendance';
import { registerOperationsExpansionRoutes } from './routes/operationsExpansion';
import { registerActivityRoutes } from './routes/activities';
import { registerDiscoveryRoutes } from './routes/discovery';
import { registerStudentPolicyRoutes } from './routes/studentPolicies';
import { isManagedWebNavigation, managedWebRoot, registerManagedWeb } from './lib/managed-web';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: [],
  });

  app.decorateRequest('user', null);
  app.decorateRequest('actor', null);
  app.decorateRequest('sessionToken', null);

  if (config.managedWeb) {
    await registerManagedWeb(app, config.managedTrialPassword);
  }

  app.addHook('onRequest', async (request) => {
    if (!config.trialEnabled) return;
    const path = request.url.split('?', 1)[0];
    if (request.method === 'GET' && path === '/api/health') return;
    const expiresAt = config.trialFile ? await readTrialExpiry(config.trialFile) : config.trialExpiresAt!;
    if (Date.now() < expiresAt) return;
    throw new AppError(403, 'trial_expired', 'This ERP trial has ended. Contact your trial coordinator for renewal.');
  });

  /**
   * CSRF defence for cookie-authenticated mutations: browsers always send
   * Origin for cross-site writes, so a mismatched origin is rejected. Requests
   * without an Origin header (server-to-server, tests) are still authenticated
   * by the session cookie and SameSite=Lax.
   */
  app.addHook('onRequest', async (request) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;
    if (!isAllowedOrigin(origin)) {
      throw forbidden('Cross-origin request blocked');
    }
  });

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const user = await loadSessionUser(token);
    if (user) {
      request.user = user;
      request.sessionToken = token;
    }
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await getPool().query('SELECT 1');
      return { status: 'ok', database: 'ok', version: '0.1.0' };
    } catch {
      return reply.status(503).send({ status: 'degraded', database: 'unavailable' });
    }
  });

  await registerAuthRoutes(app);
  await registerAcademicRoutes(app);
  await registerSubjectOfferingRoutes(app);
  await registerStudentRoutes(app);
  await registerAttendanceRoutes(app);
  await registerTimetableRoutes(app);
  await registerFeeRoutes(app);
  await registerFeeCollectionRoutes(app);
  await registerFeeExtrasRoutes(app);
  await registerExamRoutes(app);
  await registerStaffRoutes(app);
  await registerInstitutionMasterRoutes(app);
  await registerLeaveConfigRoutes(app);
  await registerPayrollRoutes(app);
  await registerSafeguardingRoutes(app);
  await registerNoticeRoutes(app);
  await registerReportRoutes(app);
  await registerAccessRoutes(app);
  await registerSchoolRoutes(app);
  await registerStaffAttendanceRoutes(app);
  await registerRecruitmentRoutes(app);
  await registerProcurementRoutes(app);
  await registerTransportRoutes(app);
  await registerLibraryRoutes(app);
  await registerLearningRoutes(app);
  await registerConcernRoutes(app);
  await registerNotificationRoutes(app);
  await registerReconciliationRoutes(app);
  await registerSavedReportRoutes(app);
  await registerStudentPortalRoutes(app);
  await registerOfflinePaymentRoutes(app);
  await registerAttendancePolicyRoutes(app);
  await registerConfigStudioRoutes(app);
  await registerTeacherEligibilityRoutes(app);
  await advancedAttendanceRoutes(app);
  await parentPortalRoutes(app);
  await registerGeoFaceAttendanceRoutes(app);
  await registerOperationsExpansionRoutes(app);
  await registerActivityRoutes(app);
  await registerDiscoveryRoutes(app);
  await registerStudentPolicyRoutes(app);

  app.setNotFoundHandler((request, reply) => {
    if (config.managedWeb &&
        isManagedWebNavigation(request.method, request.url, request.headers.accept)) {
      return reply.header('Cache-Control', 'no-store').sendFile('index.html', managedWebRoot, { cacheControl: false });
    }
    return reply.status(404).send({
      error: {
        code: 'not_found',
        message: `No route for ${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }

    const dbError = mapDatabaseError(error);
    if (dbError) {
      return reply.status(dbError.status).send({
        error: {
          code: dbError.code,
          message: dbError.message,
          details: dbError.details,
          requestId: request.id,
        },
      });
    }

    const status = (error as { statusCode?: number }).statusCode ?? 500;

    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled request error');
      return reply.status(500).send({
        error: {
          code: 'internal_error',
          message: 'Something went wrong on our side. Please try again.',
          requestId: request.id,
        },
      });
    }

    return reply.status(status).send({
      error: {
        code: (error as { code?: string }).code ?? 'request_failed',
        message:
          (error as { message?: string }).message === 'Invalid JSON'
            ? 'The request body is not valid JSON'
            : 'The request could not be processed',
        requestId: request.id,
      },
    });
  });

  return app;
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const candidate = new URL(origin);
    const configured = new URL(config.appOrigin);
    if (candidate.origin === configured.origin) return true;
    // The hosted trial accepts the configured origin only.
    if (config.isProduction || config.trialEnabled) return false;
    // Allow external testing domains in development.
    if (
      candidate.hostname === 'unstylish-unhitched-flashing.ngrok-free.dev' ||
      candidate.hostname.endsWith('.ngrok-free.dev') ||
      candidate.hostname.endsWith('.ngrok-free.app') ||
      candidate.hostname.endsWith('.ngrok.io')
    ) {
      return true;
    }
    // Treat loopback aliases as equivalent during local development.
    const loopback = new Set(['localhost', '127.0.0.1', '::1']);
    return (
      loopback.has(candidate.hostname) &&
      loopback.has(configured.hostname) &&
      candidate.port === configured.port
    );
  } catch {
    return false;
  }
}
