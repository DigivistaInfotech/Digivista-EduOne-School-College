import { centralManagement } from '../lib/institutionPolicy';
import { z } from 'zod';
import { DEFAULT_REGIONAL_SETTINGS, regionalSettingsInput, studentPolicyInput, type RegionalSettingsResponse } from '@erp/shared';
import type { FastifyInstance } from 'fastify';
import { getPool } from '../db';
import { requirePermission } from '../auth/guards';
import { badRequest, notFound, parseInput } from '../lib/errors';
import { recordAudit } from '../lib/audit';

const configKeyParam = z.object({
  schoolId: z.string().uuid(),
  configKey: z.string().trim().min(2).max(80),
});

const saveConfigInput = z.object({
  value: z.record(z.string(), z.any()),
  status: z.enum(['draft', 'published']).default('published'),
  notes: z.string().trim().max(500).optional(),
});

const rollbackInput = z.object({
  targetVersion: z.coerce.number().int().min(1),
});

const DEFAULT_CONFIGS: Record<string, any> = {
  navigation_labels: {
    dashboard: 'Overview',
    academic: 'Academics',
    people: 'Students & Staff',
    attendance: 'Daily Attendance',
    fees: 'Fee Management',
    reports: 'Reports & Analytics',
  },
  attendance_policy: {
    thresholdPercent: 80.0,
    strictClassOrderMin: 6,
    warningGraceDays: 7,
    condonationMedicalMax: 15,
  },
  workflow_settings: {
    requireTwoPersonApprovalOnPO: true,
    blockSelfApproval: true,
    parentOfflineReceiptAcknowledgement: true,
  },
  library_policy: {
    defaultLoanDays: 14,
    maxConcurrentLoansStudent: 2,
    finePerDayRupees: 2.0,
  },
  branding: {
    brandTheme: 'Rang-Biranga',
    paletteName: 'Rang-Biranga Teal & Sun',
    primaryColor: '#0B3F4B',
    accentColor: '#FF756B',
    welcomeMotto: 'Knowledge, Excellence and Integrity',
  },
};

export async function registerConfigStudioRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/schools/:schoolId/regional-settings',
    { preHandler: requirePermission('school.view') },
    async (request): Promise<RegionalSettingsResponse> => {
      const { schoolId } = parseInput(z.object({ schoolId: z.string().uuid() }), request.params);
      const { rows } = await getPool().query<{ config_value: unknown; version: number }>(
        `SELECT config_value, version FROM school_configurations
         WHERE school_id = $1 AND config_key = 'regional_settings' AND status = 'published'
         ORDER BY version DESC LIMIT 1`,
        [schoolId],
      );
      return {
        settings: rows[0] ? regionalSettingsInput.parse(rows[0].config_value) : DEFAULT_REGIONAL_SETTINGS,
        version: rows[0]?.version ?? 0,
      };
    },
  );
  /* ---------------------- GET /config ---------------------------------------- */
  app.get(
    '/api/schools/:schoolId/config',
    { preHandler: [requirePermission('school.view')] },
    async (request) => {
      const { schoolId } = parseInput(z.object({ schoolId: z.string().uuid() }), request.params);
      const pool = getPool();

      const { rows } = await pool.query<{
        config_key: string;
        config_value: any;
        version: number;
        status: string;
        notes: string | null;
        updated_at: string;
      }>(
        `SELECT DISTINCT ON (config_key)
           config_key,
           config_value,
           version,
           status,
           notes,
           to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at
         FROM school_configurations
         WHERE school_id = $1
         ORDER BY config_key, version DESC`,
        [schoolId],
      );

      const configs: Record<string, any> = { ...DEFAULT_CONFIGS };
      for (const row of rows) {
        configs[row.config_key] = {
          value: row.config_value,
          version: row.version,
          status: row.status,
          notes: row.notes,
          updatedAt: row.updated_at,
        };
      }

      return { configs };
    },
  );

  /* ---------------------- PUT /config/:configKey ----------------------------- */
  app.put(
    '/api/schools/:schoolId/config/:configKey',
    { preHandler: [requirePermission('school.manage')] },
    async (request) => {
      const { schoolId, configKey } = parseInput(configKeyParam, request.params);
      const input = parseInput(saveConfigInput, request.body);
      if (configKey === 'regional_settings') {
        input.value = parseInput(regionalSettingsInput, input.value);
        if (input.status !== 'published') throw badRequest('Regional settings must be published to take effect');
      }
      if (configKey.startsWith('student_policy_')) {
        input.value = parseInput(studentPolicyInput, input.value);
        const management=await centralManagement(schoolId);if(management&&input.value.management!==management)throw badRequest('Management type is maintained centrally in Institution masters');
        if (input.value.stateCode !== configKey.slice('student_policy_'.length)) throw badRequest('Policy state does not match its key');
      }
      const pool = getPool();

      // Find highest existing version
      const { rows: maxRows } = await pool.query<{ max_version: number | null }>(
        `SELECT max(version) AS max_version
         FROM school_configurations
         WHERE school_id = $1 AND config_key = $2`,
        [schoolId, configKey],
      );

      const nextVersion = (maxRows[0]?.max_version ?? 0) + 1;

      const { rows: inserted } = await pool.query<{ id: string }>(
        `INSERT INTO school_configurations
           (school_id, config_key, config_value, version, status, published_by, published_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
         RETURNING id`,
        [
          schoolId,
          configKey,
          JSON.stringify(input.value),
          nextVersion,
          input.status,
          request.user!.id,
          input.notes || null,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: 'school.config.updated',
        entityType: 'school_configuration',
        entityId: inserted[0]!.id,
        outcome: 'success',
        after: { configKey, version: nextVersion, status: input.status },
      });

      return {
        configKey,
        version: nextVersion,
        status: input.status,
        configValue: input.value,
        value: input.value,
      };
    },
  );

  /* ---------------------- POST /config/:configKey/rollback ------------------- */
  app.post(
    '/api/schools/:schoolId/config/:configKey/rollback',
    { preHandler: [requirePermission('school.manage')] },
    async (request) => {
      const { schoolId, configKey } = parseInput(configKeyParam, request.params);
      const input = parseInput(rollbackInput, request.body);
      const pool = getPool();

      // Find target version
      const { rows: targetRows } = await pool.query<{ config_value: any }>(
        `SELECT config_value
         FROM school_configurations
         WHERE school_id = $1 AND config_key = $2 AND version = $3`,
        [schoolId, configKey, input.targetVersion],
      );

      if (!targetRows[0]) {
        throw notFound(`Version ${input.targetVersion} not found for ${configKey}`);
      }
      if (configKey === 'regional_settings') {
        parseInput(regionalSettingsInput, targetRows[0].config_value);
      }
      if (configKey.startsWith('student_policy_')) {
        const policy = parseInput(studentPolicyInput, targetRows[0].config_value);
        const management=await centralManagement(schoolId);if(management&&policy.management!==management)throw badRequest('The historical management type differs from the current institution master');
        if (policy.stateCode !== configKey.slice('student_policy_'.length)) throw badRequest('Policy state does not match its key');
      }

      // Find current max version
      const { rows: maxRows } = await pool.query<{ max_version: number }>(
        `SELECT coalesce(max(version), 0) AS max_version
         FROM school_configurations
         WHERE school_id = $1 AND config_key = $2`,
        [schoolId, configKey],
      );

      const nextVersion = maxRows[0]!.max_version + 1;

      const { rows: inserted } = await pool.query<{ id: string }>(
        `INSERT INTO school_configurations
           (school_id, config_key, config_value, version, status, published_by, published_at, notes)
         VALUES ($1, $2, $3, $4, 'published', $5, now(), $6)
         RETURNING id`,
        [
          schoolId,
          configKey,
          JSON.stringify(targetRows[0].config_value),
          nextVersion,
          request.user!.id,
          `Rollback to version ${input.targetVersion}`,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: 'school.config.rolled_back',
        entityType: 'school_configuration',
        entityId: inserted[0]!.id,
        outcome: 'success',
        after: { configKey, rolledBackTo: input.targetVersion, newVersion: nextVersion },
      });

      return {
        configKey,
        rolledBackTo: input.targetVersion,
        newVersion: nextVersion,
        status: 'published',
      };
    },
  );
}
