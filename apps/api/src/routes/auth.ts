import { hashPassword, verifyPassword } from "@erp/core";
import {
  changePasswordSchema,
  loginSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  passwordForgotSchema,
  passwordResetSchema,
  type MeResponse,
} from "@erp/shared";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE, config } from "../config";
import { getPool, withTransaction } from "../db";
import { requireAuth } from "../auth/guards";
import { createSession, loadMemberships, revokeSession } from "../auth/session";
import { AppError, badRequest, parseInput, unauthorized } from "../lib/errors";
import { recordAudit } from "../lib/audit";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../lib/totp";
import {
  isPasswordResetEmailConfigured,
  sendPasswordResetEmail,
} from "../lib/password-reset-email";

const LOCK_THRESHOLD = 10;
const LOCK_MINUTES = 15;
const DIGIVISTA_ADMIN_ACCOUNTS = [
  { email: "palak.dixit@digivistainfotech.com", displayName: "Palak Dixit" },
  {
    email: "sandeep.saxena@digivistainfotech.com",
    displayName: "Sandeep Saxena",
  },
] as const;

const ownerRecoverySchema = z
  .object({
    email: z.string().trim().email().max(320),
    newPassword: z
      .string()
      .min(12)
      .max(200)
      .regex(/[a-zA-Z]/, "Include at least one letter")
      .regex(/[0-9]/, "Include at least one number"),
    confirmPassword: z.string().min(12).max(200),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "The new password and confirmation do not match.",
    path: ["confirmPassword"],
  });

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-never-matches");
  return dummyHash;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/auth/owner-recovery/password",
    {
      config: {
        rateLimit: { max: config.isTest ? 10000 : 3, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const secret = config.adminRecoverySecret;
      const suppliedHeader = request.headers["x-admin-recovery-secret"];
      const supplied = typeof suppliedHeader === "string" ? suppliedHeader : "";
      const expectedHash = createHash("sha256")
        .update(secret || "disabled")
        .digest();
      const suppliedHash = createHash("sha256").update(supplied).digest();
      if (
        secret.length < 32 ||
        !supplied ||
        !timingSafeEqual(expectedHash, suppliedHash)
      ) {
        throw new AppError(404, "not_found", "Not found");
      }

      const input = parseInput(ownerRecoverySchema, request.body);
      const owner = DIGIVISTA_ADMIN_ACCOUNTS.find(
        (account) => account.email.toLowerCase() === input.email.toLowerCase(),
      );
      if (!owner) throw new AppError(404, "not_found", "Not found");

      const markerAction = "auth.owner_password_recovered";
      const passwordHash = await hashPassword(input.newPassword);
      await withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(1413761347, 2)");
        const existing = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM users WHERE lower(email) = lower($1) FOR UPDATE`,
          [owner.email],
        );
        const user = existing.rows[0];
        if (user?.status === "disabled") {
          throw new AppError(
            409,
            "account_unavailable",
            "This owner account is disabled. Contact the system operator.",
          );
        }
        const userId =
          user?.id ??
          (
            await client.query<{ id: string }>(
              `INSERT INTO users (email, display_name, password_hash, status)
           VALUES ($1, $2, $3, 'active') RETURNING id`,
              [owner.email, owner.displayName, passwordHash],
            )
          ).rows[0]!.id;

        const priorUse = await client.query<{ id: string }>(
          `SELECT id FROM audit_events
           WHERE action = $1 AND entity_id = $2 AND outcome = 'success' LIMIT 1`,
          [markerAction, userId],
        );
        if (priorUse.rows[0]) {
          throw new AppError(
            410,
            "owner_recovery_used",
            "Owner recovery has already been used for this account. Contact the system operator.",
          );
        }

        const schools = await client.query<{ id: string }>(
          `SELECT id FROM schools WHERE status = 'active' ORDER BY created_at, id`,
        );
        if (schools.rows.length === 0) {
          throw new AppError(
            409,
            "school_not_ready",
            "No active institution is available for owner recovery.",
          );
        }
        const roleResult = await client.query<{ id: string }>(
          `SELECT id FROM roles WHERE code = 'main_admin'`,
        );
        const roleId = roleResult.rows[0]?.id;
        if (!roleId)
          throw new AppError(
            500,
            "role_not_ready",
            "The main administrator role is not configured.",
          );

        await client.query(
          `UPDATE users SET password_hash = $2, status = 'active',
             failed_login_attempts = 0, locked_until = NULL
           WHERE id = $1`,
          [userId, passwordHash],
        );
        await client.query(
          `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );

        for (const school of schools.rows) {
          const assignment = await client.query<{ id: string }>(
            `SELECT ura.id FROM user_role_assignments ura
             WHERE ura.user_id = $1 AND ura.school_id = $2 AND ura.role_id = $3
               AND ura.scope_type = 'school' AND ura.scope_id IS NULL
               AND ura.revoked_at IS NULL AND ura.valid_from <= now()
               AND (ura.valid_to IS NULL OR ura.valid_to > now()) LIMIT 1`,
            [userId, school.id, roleId],
          );
          if (!assignment.rows[0]) {
            await client.query(
              `INSERT INTO user_role_assignments
                 (user_id, role_id, school_id, scope_type, scope_id, reason)
               VALUES ($1, $2, $3, 'school', NULL, 'One-time owner password recovery')`,
              [userId, roleId, school.id],
            );
          }
        }

        await recordAudit(client, {
          actorType: "system",
          action: markerAction,
          entityType: "user",
          entityId: userId,
          outcome: "success",
          after: {
            email: owner.email,
            roleCode: "main_admin",
            scopeType: "school",
          },
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      });

      return reply.send({
        message: "Owner password updated. Sign in with the new password.",
      });
    },
  );

  app.post(
    "/api/auth/bootstrap-digivista-admins",
    {
      config: {
        rateLimit: { max: config.isTest ? 10000 : 3, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const expectedSecret = config.adminBootstrapSecret;
      if (expectedSecret.length < 32)
        throw new AppError(404, "not_found", "Not found");
      const suppliedSecret = request.headers["x-admin-bootstrap-secret"];
      const supplied = typeof suppliedSecret === "string" ? suppliedSecret : "";
      const expectedHash = createHash("sha256").update(expectedSecret).digest();
      const suppliedHash = createHash("sha256").update(supplied).digest();
      if (!supplied || !timingSafeEqual(expectedHash, suppliedHash)) {
        throw unauthorized("Setup authorization is invalid");
      }
      if (!isPasswordResetEmailConfigured()) {
        throw new AppError(
          503,
          "password_reset_unavailable",
          "Password recovery email is not set up yet. Contact Digivista support.",
        );
      }

      const markerAction = "auth.digivista_admin_bootstrap_completed";
      const prepared = await withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(1413761347, 1)");
        const marker = await client.query<{ id: string }>(
          "SELECT id FROM audit_events WHERE action = $1 LIMIT 1",
          [markerAction],
        );
        if (marker.rows[0])
          throw new AppError(
            410,
            "bootstrap_already_used",
            "Admin setup has already been completed",
          );

        const schoolResult = await client.query<{ id: string }>(
          `SELECT id FROM schools WHERE status = 'active' ORDER BY created_at, id`,
        );
        if (schoolResult.rows.length === 0) {
          throw new AppError(
            409,
            "school_not_ready",
            "No active institution is available for admin setup",
          );
        }
        const roleResult = await client.query<{ id: string }>(
          `SELECT id FROM roles WHERE code = 'main_admin'`,
        );
        const mainAdminRoleId = roleResult.rows[0]?.id;
        if (!mainAdminRoleId)
          throw new AppError(
            500,
            "role_not_ready",
            "The main administrator role is not configured",
          );

        const users: Array<{
          email: string;
          userId: string;
          created: boolean;
          resetToken: string;
        }> = [];
        for (const account of DIGIVISTA_ADMIN_ACCOUNTS) {
          const existing = await client.query<{ id: string; status: string }>(
            `SELECT id, status FROM users WHERE lower(email) = lower($1) FOR UPDATE`,
            [account.email],
          );
          let userId = existing.rows[0]?.id;
          let created = false;
          if (
            existing.rows[0]?.status === "disabled" ||
            existing.rows[0]?.status === "locked"
          ) {
            throw new AppError(
              409,
              "account_unavailable",
              `The account ${account.email} is disabled or locked; review it before granting access`,
            );
          }
          if (!userId) {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO users (email, display_name, password_hash, status)
               VALUES ($1, $2, NULL, 'invited') RETURNING id`,
              [account.email, account.displayName],
            );
            userId = inserted.rows[0]!.id;
            created = true;
          }

          for (const school of schoolResult.rows) {
            const assignment = await client.query<{ id: string }>(
              `SELECT ura.id FROM user_role_assignments ura
               WHERE ura.user_id = $1 AND ura.school_id = $2 AND ura.role_id = $3
                 AND ura.scope_type = 'school' AND ura.scope_id IS NULL
                 AND ura.revoked_at IS NULL AND ura.valid_from <= now()
                 AND (ura.valid_to IS NULL OR ura.valid_to > now())
               LIMIT 1`,
              [userId, school.id, mainAdminRoleId],
            );
            if (!assignment.rows[0]) {
              await client.query(
                `INSERT INTO user_role_assignments
                   (user_id, role_id, school_id, scope_type, scope_id, reason)
                 VALUES ($1, $2, $3, 'school', NULL, 'Owner-authorized Digivista admin recovery')`,
                [userId, mainAdminRoleId, school.id],
              );
              await recordAudit(client, {
                schoolId: school.id,
                actorType: "system",
                action: created
                  ? "access.user_created"
                  : "access.role_assigned",
                entityType: "user",
                entityId: userId,
                outcome: "success",
                after: {
                  email: account.email,
                  roleCode: "main_admin",
                  scopeType: "school",
                },
                sourceIp: request.ip,
                userAgent: request.headers["user-agent"] ?? null,
              });
            }
          }

          const resetToken = randomBytes(32).toString("base64url");
          await client.query(
            `UPDATE password_reset_tokens SET used_at = now()
             WHERE user_id = $1 AND used_at IS NULL`,
            [userId],
          );
          await client.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, now() + interval '30 minutes')`,
            [userId, hashToken(resetToken)],
          );
          users.push({ email: account.email, userId, created, resetToken });
        }
        return { users, schoolCount: schoolResult.rows.length };
      });

      try {
        for (const user of prepared.users)
          await sendPasswordResetEmail(user.email, user.resetToken);
      } catch (error) {
        await withTransaction(async (client) => {
          for (const user of prepared.users) {
            await client.query(
              `UPDATE password_reset_tokens SET used_at = now()
               WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL`,
              [user.userId, hashToken(user.resetToken)],
            );
          }
        });
        request.log.error(
          {
            code:
              error instanceof Error && "code" in error
                ? error.code
                : "mail_delivery_failed",
          },
          "Digivista admin recovery email delivery failed",
        );
        throw new AppError(
          503,
          "admin_recovery_delivery_failed",
          "Admin accounts were prepared, but a reset email could not be delivered. Retry the setup after checking email settings.",
        );
      }

      await withTransaction(async (client) => {
        await recordAudit(client, {
          actorType: "system",
          action: markerAction,
          entityType: "system",
          outcome: "success",
          after: {
            emails: prepared.users.map(({ email }) => email),
            schoolCount: prepared.schoolCount,
          },
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      });
      return reply.status(201).send({
        items: prepared.users.map(({ email, userId, created }) => ({
          email,
          userId,
          created,
        })),
        schoolCount: prepared.schoolCount,
        message:
          "Admin accounts are ready. Each recipient has been emailed a single-use password setup link.",
      });
    },
  );

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: { max: config.isTest ? 10000 : 10, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const input = parseInput(loginSchema, request.body);

      const { rows } = await getPool().query<{
        id: string;
        email: string | null;
        display_name: string;
        password_hash: string | null;
        status: "invited" | "active" | "locked" | "disabled";
        failed_login_attempts: number;
        locked_until: Date | null;
      }>(
        `SELECT id, email, display_name, password_hash, status, failed_login_attempts, locked_until
         FROM users WHERE lower(email) = lower($1)`,
        [input.email],
      );
      const user = rows[0];

      // Always run a hash comparison so response time does not reveal whether
      // the email exists.
      const matches = await verifyPassword(
        input.password,
        user?.password_hash ?? (await getDummyHash()),
      );

      if (!user) {
        await recordAudit(getPool(), {
          action: "auth.login",
          entityType: "user",
          outcome: "failure",
          reason: "unknown email",
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
        throw unauthorized("Email or password is incorrect");
      }

      if (user.locked_until && user.locked_until.getTime() > Date.now()) {
        throw new AppError(
          423,
          "account_locked",
          "Too many failed attempts. Try again in a few minutes or contact your administrator.",
        );
      }

      if (!matches) {
        const attempts = user.failed_login_attempts + 1;
        const lockedUntil =
          attempts >= LOCK_THRESHOLD
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : user.locked_until;
        await getPool().query(
          `UPDATE users
           SET failed_login_attempts = $2,
               locked_until = $3
           WHERE id = $1`,
          [user.id, attempts, lockedUntil],
        );
        await recordAudit(getPool(), {
          schoolId: null,
          actorUserId: user.id,
          action: "auth.login",
          entityType: "user",
          entityId: user.id,
          outcome: "failure",
          reason: "invalid password",
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
        throw unauthorized("Email or password is incorrect");
      }

      if (user.status !== "active") {
        throw new AppError(
          403,
          "account_unavailable",
          "This account is not active. Contact your school administrator.",
        );
      }

      const mfa = await getPool().query<{ secret: string }>(
        `SELECT secret FROM user_mfa WHERE user_id = $1 AND confirmed_at IS NOT NULL`,
        [user.id],
      );
      const mfaSecret = mfa.rows[0]?.secret;
      if (mfaSecret) {
        if (!input.totpCode) {
          throw new AppError(
            401,
            "mfa_required",
            "Enter the 6-digit code from your authenticator app.",
          );
        }
        if (!verifyTotp(mfaSecret, input.totpCode)) {
          const attempts = user.failed_login_attempts + 1;
          const lockedUntil =
            attempts >= LOCK_THRESHOLD
              ? new Date(Date.now() + LOCK_MINUTES * 60_000)
              : user.locked_until;
          await getPool().query(
            `UPDATE users SET failed_login_attempts = $2, locked_until = $3 WHERE id = $1`,
            [user.id, attempts, lockedUntil],
          );
          await recordAudit(getPool(), {
            schoolId: null,
            actorUserId: user.id,
            action: "auth.mfa_failed",
            entityType: "user",
            entityId: user.id,
            outcome: "failure",
            reason: "invalid TOTP code",
            sourceIp: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          });
          throw new AppError(
            401,
            "invalid_totp",
            "That authentication code is not valid.",
          );
        }
        await getPool().query(
          "UPDATE user_mfa SET last_used_at = now() WHERE user_id = $1",
          [user.id],
        );
      }

      await getPool().query(
        `UPDATE users
         SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now()
         WHERE id = $1`,
        [user.id],
      );

      const session = await createSession(user.id, {
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      reply.setCookie(SESSION_COOKIE, session.token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.cookieSecure,
        expires: session.expiresAt,
      });

      await recordAudit(getPool(), {
        actorUserId: user.id,
        action: "auth.login",
        entityType: "user",
        entityId: user.id,
        outcome: "success",
        sourceIp: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      const memberships = await loadMemberships(user.id);
      const body: MeResponse = {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          status: user.status,
        },
        memberships,
      };
      return reply.send(body);
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    if (request.sessionToken) await revokeSession(request.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    const user = request.user!;
    return {
      user,
      memberships: await loadMemberships(user.id),
    } satisfies MeResponse;
  });

  app.post(
    "/api/auth/change-password",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const input = parseInput(changePasswordSchema, request.body);
      const user = request.user!;

      const { rows } = await getPool().query<{ password_hash: string | null }>(
        "SELECT password_hash FROM users WHERE id = $1",
        [user.id],
      );
      const ok = await verifyPassword(
        input.currentPassword,
        rows[0]?.password_hash ?? null,
      );
      if (!ok) throw unauthorized("Current password is incorrect");

      const nextHash = await hashPassword(input.newPassword);
      await withTransaction(async (client) => {
        await client.query(
          "UPDATE users SET password_hash = $2 WHERE id = $1",
          [user.id, nextHash],
        );
        // Invalidate every other session after a password change.
        await client.query(
          `UPDATE sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL AND token_hash <> $2`,
          [user.id, request.sessionToken ?? ""],
        );
        await recordAudit(client, {
          actorUserId: user.id,
          action: "auth.password_changed",
          entityType: "user",
          entityId: user.id,
          outcome: "success",
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      });

      return reply.status(204).send();
    },
  );

  /* ----------------------------- password reset ---------------------------- */

  app.post(
    "/api/auth/password/forgot",
    {
      config: {
        rateLimit: { max: config.isTest ? 10000 : 5, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const input = parseInput(passwordForgotSchema, request.body);
      if (config.isProduction && !isPasswordResetEmailConfigured()) {
        throw new AppError(
          503,
          "password_reset_unavailable",
          "Password recovery email is not set up yet. Contact Digivista support.",
        );
      }
      const { rows } = await getPool().query<{ id: string; status: string }>(
        `SELECT id, status FROM users WHERE lower(email) = lower($1)`,
        [input.email],
      );
      const user = rows[0];

      let devToken: string | undefined;
      if (user && user.status !== "disabled") {
        const token = randomBytes(32).toString("base64url");
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE password_reset_tokens SET used_at = now()
             WHERE user_id = $1 AND used_at IS NULL`,
            [user.id],
          );
          await client.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
             VALUES ($1, $2, now() + interval '30 minutes', $3)`,
            [user.id, hashToken(token), request.ip ?? null],
          );
          await recordAudit(client, {
            actorUserId: user.id,
            action: "auth.password_reset_requested",
            entityType: "user",
            entityId: user.id,
            outcome: "success",
            sourceIp: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          });
        });
        if (!config.isProduction) {
          devToken = token;
        } else {
          try {
            await sendPasswordResetEmail(input.email, token);
          } catch (error) {
            await getPool().query(
              `UPDATE password_reset_tokens SET used_at = now()
               WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL`,
              [user.id, hashToken(token)],
            );
            request.log.error(
              {
                code:
                  error instanceof Error && "code" in error
                    ? error.code
                    : "mail_delivery_failed",
              },
              "Password reset email delivery failed",
            );
          }
        }
      }

      return reply.status(202).send({
        delivered: false,
        message:
          "If an account exists for that email, a single-use reset link has been sent. Check your inbox and spam folder.",
        ...(devToken ? { devToken } : {}),
      });
    },
  );

  app.post(
    "/api/auth/password/reset",
    {
      config: {
        rateLimit: {
          max: config.isTest ? 10000 : 10,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      const input = parseInput(passwordResetSchema, request.body);
      const nextHash = await hashPassword(input.newPassword);

      await withTransaction(async (client) => {
        const { rows } = await client.query<{
          id: string;
          user_id: string;
          expires_at: Date;
          used_at: Date | null;
          status: string;
        }>(
          `SELECT t.id, t.user_id, t.expires_at, t.used_at, u.status
           FROM password_reset_tokens t
           JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = $1
           FOR UPDATE`,
          [hashToken(input.token)],
        );
        const token = rows[0];
        if (
          !token ||
          token.used_at ||
          token.expires_at.getTime() <= Date.now()
        ) {
          throw badRequest("This reset link is invalid or has expired");
        }
        if (token.status === "disabled") {
          throw badRequest(
            "This account is disabled. Contact your school administrator.",
          );
        }

        await client.query(
          `UPDATE users
           SET password_hash = $2,
               status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
               failed_login_attempts = 0, locked_until = NULL
           WHERE id = $1`,
          [token.user_id, nextHash],
        );
        await client.query(
          "UPDATE password_reset_tokens SET used_at = now() WHERE id = $1",
          [token.id],
        );
        await client.query(
          `UPDATE password_reset_tokens SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [token.user_id],
        );
        await client.query(
          "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
          [token.user_id],
        );
        await recordAudit(client, {
          actorUserId: token.user_id,
          action: "auth.password_reset_completed",
          entityType: "user",
          entityId: token.user_id,
          outcome: "success",
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      });

      return reply.status(204).send();
    },
  );

  /* ---------------------------------- MFA ---------------------------------- */

  app.get("/api/auth/mfa", { preHandler: requireAuth }, async (request) => {
    const { rows } = await getPool().query<{ confirmed_at: Date | null }>(
      "SELECT confirmed_at FROM user_mfa WHERE user_id = $1",
      [request.user!.id],
    );
    return {
      enabled: Boolean(rows[0]?.confirmed_at),
      configured: Boolean(rows[0]),
      confirmedAt: rows[0]?.confirmed_at
        ? rows[0]!.confirmed_at.toISOString()
        : null,
    };
  });

  app.post(
    "/api/auth/mfa/setup",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request) => {
      const user = request.user!;
      const existing = await getPool().query<{ confirmed_at: Date | null }>(
        "SELECT confirmed_at FROM user_mfa WHERE user_id = $1",
        [user.id],
      );
      if (existing.rows[0]?.confirmed_at) {
        throw new AppError(
          409,
          "mfa_already_enabled",
          "Two-factor authentication is already enabled for this account.",
        );
      }

      const secret = generateTotpSecret();
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO user_mfa (user_id, secret, confirmed_at)
           VALUES ($1, $2, NULL)
           ON CONFLICT (user_id) DO UPDATE SET secret = EXCLUDED.secret, confirmed_at = NULL`,
          [user.id, secret],
        );
        await recordAudit(client, {
          actorUserId: user.id,
          action: "auth.mfa_setup_started",
          entityType: "user",
          entityId: user.id,
          outcome: "success",
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      });

      return {
        secret,
        otpauthUrl: otpauthUrl(user.email ?? user.displayName, secret),
      };
    },
  );

  app.post(
    "/api/auth/mfa/enable",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const user = request.user!;
      const input = parseInput(mfaCodeSchema, request.body);
      const { rows } = await getPool().query<{
        secret: string;
        confirmed_at: Date | null;
      }>("SELECT secret, confirmed_at FROM user_mfa WHERE user_id = $1", [
        user.id,
      ]);
      const mfa = rows[0];
      if (!mfa) throw badRequest("Start two-factor setup first");
      if (!verifyTotp(mfa.secret, input.code)) {
        throw badRequest("That authentication code is not valid", {
          code: ["Check the code and try again"],
        });
      }
      await withTransaction(async (client) => {
        await client.query(
          "UPDATE user_mfa SET confirmed_at = COALESCE(confirmed_at, now()) WHERE user_id = $1",
          [user.id],
        );
        await recordAudit(client, {
          actorUserId: user.id,
          action: "auth.mfa_enabled",
          entityType: "user",
          entityId: user.id,
          outcome: "success",
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      });
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/auth/mfa/disable",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const user = request.user!;
      const input = parseInput(mfaDisableSchema, request.body);
      const { rows } = await getPool().query<{
        password_hash: string | null;
        secret: string;
      }>(
        `SELECT u.password_hash, m.secret
         FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id AND m.confirmed_at IS NOT NULL
         WHERE u.id = $1`,
        [user.id],
      );
      const row = rows[0];
      const passwordOk = await verifyPassword(
        input.password,
        row?.password_hash ?? null,
      );
      if (!passwordOk) throw unauthorized("Your password is not correct");
      if (!row?.secret)
        throw badRequest("Two-factor authentication is not enabled");
      if (!verifyTotp(row.secret, input.code)) {
        throw badRequest("That authentication code is not valid", {
          code: ["Check the code and try again"],
        });
      }

      await withTransaction(async (client) => {
        await client.query("DELETE FROM user_mfa WHERE user_id = $1", [
          user.id,
        ]);
        await recordAudit(client, {
          actorUserId: user.id,
          action: "auth.mfa_disabled",
          entityType: "user",
          entityId: user.id,
          outcome: "success",
          sourceIp: request.ip,
          userAgent: request.headers["user-agent"] ?? null,
        });
      });
      return reply.status(204).send();
    },
  );
}
