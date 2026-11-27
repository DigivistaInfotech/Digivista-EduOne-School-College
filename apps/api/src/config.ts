import "dotenv/config";
import { parseTrialExpiry } from "./lib/trial";

function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

const trialFile = process.env.TRIAL_EXPIRY_FILE;
const trialExpiry = process.env.TRIAL_EXPIRES_AT;
if (
  trialFile !== undefined &&
  (!trialFile.trim() || trialExpiry !== undefined)
) {
  throw new Error("Set either TRIAL_EXPIRY_FILE or TRIAL_EXPIRES_AT");
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: int(process.env.PORT, 4000),
  host: process.env.API_HOST ?? "0.0.0.0",
  trialFile,
  trialExpiresAt:
    trialExpiry === undefined ? undefined : parseTrialExpiry(trialExpiry),
  trialEnabled: trialFile !== undefined || trialExpiry !== undefined,
  managedWeb:
    bool(process.env.MANAGED_WEB, false) ||
    process.env.MANAGED_TRIAL_PASSWORD !== undefined,
  managedTrialPassword: process.env.MANAGED_TRIAL_PASSWORD,
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 7),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  isTest: (process.env.NODE_ENV ?? "development") === "test",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@127.0.0.1:5433/school_erp",
  /**
   * Optional external notification delivery. There is no built-in provider and
   * no credential is shipped; when these are unset the outbox marks messages
   * blocked instead of pretending they were delivered.
   */
  notificationProviderUrl: process.env.NOTIFICATION_PROVIDER_URL ?? "",
  notificationProviderToken: process.env.NOTIFICATION_PROVIDER_TOKEN ?? "",
  notificationProviderName: process.env.NOTIFICATION_PROVIDER_NAME ?? "webhook",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: int(process.env.SMTP_PORT, 465),
  smtpSecure: bool(process.env.SMTP_SECURE, true),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
  smtpFrom: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
  adminBootstrapSecret: process.env.ADMIN_BOOTSTRAP_SECRET ?? "",
  adminRecoverySecret: process.env.ADMIN_RECOVERY_SECRET ?? "",
} as const;

export const SESSION_COOKIE = "erp_session";
