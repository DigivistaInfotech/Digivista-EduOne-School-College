import {
  importPreviewInput,
  savedReportInput,
  savedReportUpdate,
  uuid,
  type ImportBatch,
  type ImportRow,
  type SavedReport,
} from '@erp/shared';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { getActor, requirePermission, requestMeta } from '../auth/guards';
import { getPool, withTransaction } from '../db';
import { recordAudit } from '../lib/audit';
import { badRequest, conflict, notFound, parseInput } from '../lib/errors';
import { toIsoDate, toIsoDateTime, toNumber } from '../lib/format';
import { idempotentRoute } from '../lib/idempotency';

const schoolParams = z.object({ schoolId: uuid });
const idParams = z.object({ schoolId: uuid, id: uuid });
const listQuery = z.object({
  reportType: z.enum(['students', 'attendance', 'fees']).optional(),
});
const importQuery = z.object({
  entityType: z.enum(['students', 'library_books', 'vendors', 'academic_years', 'classes', 'sections', 'subjects', 'subject_offerings', 'staff', 'rooms', 'timetable_periods', 'fee_heads', 'institution_masters']).optional(),
  status: z.enum(['previewed', 'committed', 'cancelled']).optional(),
});

const ALLOWED_FILTERS: Record<SavedReport['reportType'], string[]> = {
  students: ['academicYearId', 'sectionId'],
  attendance: ['from', 'to', 'academicYearId', 'sectionId'],
  fees: ['academicYearId', 'sectionId'],
};

/**
 * Saved report views and two-step CSV imports.
 *
 * A saved view stores only its name, type and filters; results are recomputed by
 * the report endpoints when opened. Imports are always previewed first and every
 * row keeps its validation result. Commit applies only valid rows inside one
 * transaction and refuses a batch that was already committed, so retrying after
 * a dropped connection cannot duplicate records.
 */
export async function registerSavedReportRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ saved reports ---------------------------- */

  app.get(
    '/api/schools/:schoolId/saved-reports',
    { preHandler: requirePermission('reports.saved.manage') },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const query = parseInput(listQuery, request.query);
      const actor = getActor(request);
      const params: unknown[] = [schoolId, actor.userId];
      let filter = '';
      if (query.reportType) {
        params.push(query.reportType);
        filter = `AND r.report_type = $${params.length}`;
      }
      const { rows } = await getPool().query<{
        id: string;
        name: string;
        report_type: SavedReport['reportType'];
        filters: Record<string, string | undefined>;
        shared: boolean;
        created_by_name: string | null;
        created_at: Date;
      }>(
        `SELECT r.id, r.name, r.report_type, r.filters, r.shared,
                u.display_name AS created_by_name, r.created_at
         FROM saved_reports r
         LEFT JOIN users u ON u.id = r.created_by
         WHERE r.school_id = $1 AND (r.created_by = $2 OR r.shared = TRUE) ${filter}
         ORDER BY r.name`,
        params,
      );
      const items: SavedReport[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        reportType: row.report_type,
        filters: row.filters ?? {},
        shared: row.shared,
        createdByName: row.created_by_name,
        createdAt: toIsoDateTime(row.created_at),
      }));
      return { items };
    },
  );

  app.post(
    '/api/schools/:schoolId/saved-reports',
    { preHandler: requirePermission('reports.saved.manage') },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(savedReportInput, request.body);
      const actor = getActor(request);
      validateFilters(input.reportType, input.filters);
      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO saved_reports (school_id, name, report_type, filters, shared, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          schoolId,
          input.name,
          input.reportType,
          JSON.stringify(input.filters),
          input.shared,
          actor.userId,
        ],
      );
      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: 'reports.saved_view_created',
        entityType: 'saved_report',
        entityId: rows[0]!.id,
        outcome: 'success',
        after: { name: input.name, reportType: input.reportType, shared: input.shared },
        ...requestMeta(request),
      });
      return reply.status(201).send({ id: rows[0]!.id });
    },
  );

  app.patch(
    '/api/schools/:schoolId/saved-reports/:id',
    { preHandler: requirePermission('reports.saved.manage') },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(savedReportUpdate, request.body);
      const actor = getActor(request);
      const { rows } = await getPool().query<{
        name: string;
        report_type: SavedReport['reportType'];
        filters: Record<string, string | undefined>;
        shared: boolean;
        created_by: string;
      }>(
        `SELECT name, report_type, filters, shared, created_by FROM saved_reports
         WHERE school_id = $1 AND id = $2`,
        [schoolId, id],
      );
      const row = rows[0];
      if (!row || row.created_by !== actor.userId) throw notFound('Saved report not found');
      const reportType = input.reportType ?? row.report_type;
      const filters = input.filters ?? row.filters ?? {};
      validateFilters(reportType, filters);
      await getPool().query(
        `UPDATE saved_reports SET name = $3, report_type = $4, filters = $5, shared = $6
         WHERE school_id = $1 AND id = $2`,
        [
          schoolId,
          id,
          input.name ?? row.name,
          reportType,
          JSON.stringify(filters),
          input.shared ?? row.shared,
        ],
      );
      return { id };
    },
  );

  app.delete(
    '/api/schools/:schoolId/saved-reports/:id',
    { preHandler: requirePermission('reports.saved.manage') },
    async (request, reply) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const actor = getActor(request);
      const { rowCount } = await getPool().query(
        'DELETE FROM saved_reports WHERE school_id = $1 AND id = $2 AND created_by = $3',
        [schoolId, id, actor.userId],
      );
      if (rowCount === 0) throw notFound('Saved report not found');
      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: 'reports.saved_view_deleted',
        entityType: 'saved_report',
        entityId: id,
        outcome: 'success',
        ...requestMeta(request),
      });
      return reply.status(204).send();
    },
  );

  /* --------------------------------- imports ------------------------------- */

  app.get(
    '/api/schools/:schoolId/imports',
    { preHandler: requirePermission('imports.manage') },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const query = parseInput(importQuery, request.query);
      const params: unknown[] = [schoolId];
      const filters = ['school_id = $1'];
      if (query.entityType) {
        params.push(query.entityType);
        filters.push(`entity_type = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        filters.push(`status = $${params.length}`);
      }
      const { rows } = await getPool().query<BatchRow>(
        `${batchSelect} WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 100`,
        params,
      );
      return { items: rows.map(toBatch) };
    },
  );

  app.get(
    '/api/schools/:schoolId/imports/:id',
    { preHandler: requirePermission('imports.manage') },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const { rows } = await getPool().query<BatchRow>(
        `${batchSelect} WHERE school_id = $1 AND id = $2`,
        [schoolId, id],
      );
      if (!rows[0]) throw notFound('Import batch not found');
      const rowData = await getPool().query<RowRow>(
        `SELECT id, row_number, payload, errors, action, created_entity_id
         FROM import_batch_rows WHERE school_id = $1 AND batch_id = $2 ORDER BY row_number`,
        [schoolId, id],
      );
      return { ...toBatch(rows[0]), rows: rowData.rows.map(toRow) };
    },
  );

  app.post(
    '/api/schools/:schoolId/imports/preview',
    { preHandler: requirePermission('imports.manage') },
    idempotentRoute('POST /imports/preview', async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(importPreviewInput, request.body);
      const actor = getActor(request);

      let parsed: string[][];
      try {
        parsed = parseCsv(input.csv);
      } catch (error) {
        throw badRequest(error instanceof Error ? error.message : 'The CSV could not be read');
      }
      if (parsed.length < 2) {
        throw badRequest('The CSV needs a header row and at least one data row');
      }
      const header = parsed[0]!.map((cell) => cell.trim().toLowerCase());
      const body = parsed
        .slice(1)
        .filter((row) => row.some((cell) => cell.trim() !== ''));
      if (body.length === 0) throw badRequest('The CSV has no data rows');
      if (body.length > 500) throw badRequest('Import at most 500 rows in one file');

      const prepared = await prepareImport(schoolId, input.entityType, header, body);

      const created = await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO import_batches
             (school_id, entity_type, filename, total_rows, valid_rows, invalid_rows, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            schoolId,
            input.entityType,
            input.filename,
            prepared.length,
            prepared.filter((row) => row.errors.length === 0).length,
            prepared.filter((row) => row.errors.length > 0).length,
            actor.userId,
          ],
        );
        const batchId = rows[0]!.id;
        for (const row of prepared) {
          await client.query(
            `INSERT INTO import_batch_rows
               (school_id, batch_id, row_number, payload, errors, action)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              schoolId,
              batchId,
              row.rowNumber,
              JSON.stringify(row.payload),
              JSON.stringify(row.errors),
              row.errors.length === 0 ? 'create' : 'skip',
            ],
          );
        }
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: 'imports.previewed',
          entityType: 'import_batch',
          entityId: batchId,
          outcome: 'success',
          after: {
            entityType: input.entityType,
            totalRows: prepared.length,
            validRows: prepared.filter((row) => row.errors.length === 0).length,
          },
          ...requestMeta(request),
        });
        return batchId;
      });

      return reply.status(201).send({
        id: created,
        totalRows: prepared.length,
        validRows: prepared.filter((row) => row.errors.length === 0).length,
        invalidRows: prepared.filter((row) => row.errors.length > 0).length,
      });
    }),
  );

  app.post(
    '/api/schools/:schoolId/imports/:id/commit',
    { preHandler: requirePermission('imports.manage') },
    idempotentRoute('POST /imports/commit', async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const actor = getActor(request);
      const committed = await withTransaction(async (client) => {
        const found = await client.query<{
          entity_type: ImportBatch['entityType'];
          status: ImportBatch['status'];
          valid_rows: number;
        }>(
          `SELECT entity_type, status, valid_rows FROM import_batches
           WHERE school_id = $1 AND id = $2 FOR UPDATE`,
          [schoolId, id],
        );
        const batch = found.rows[0];
        if (!batch) throw notFound('Import batch not found');
        if (batch.entity_type === 'students') {
          throw conflict('This student batch uses the older incomplete format. Start a new import from Students → Import students.', 'student_import_requires_admission');
        }
        if (batch.status === 'committed') throw conflict('This import was already committed');
        if (batch.status === 'cancelled') throw conflict('This import was cancelled');

        const rows = await client.query<RowRow>(
          `SELECT id, row_number, payload, errors, action, created_entity_id
           FROM import_batch_rows
           WHERE school_id = $1 AND batch_id = $2 AND action = 'create'
           ORDER BY row_number`,
          [schoolId, id],
        );
        if (rows.rows.length !== batch.valid_rows) {
          throw conflict('The import rows no longer match the preview; create a new preview');
        }

        let created = 0;
        for (const row of rows.rows) {
          let entityId: string;
          try {
            entityId = await commitRow(client, schoolId, batch.entity_type, row.payload, actor.userId);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'This row could not be imported';
            throw conflict(`Row ${row.row_number}: ${message}`, 'import_row_failed');
          }
          await client.query(
            `UPDATE import_batch_rows SET created_entity_id = $4
             WHERE school_id = $1 AND batch_id = $2 AND id = $3`,
            [schoolId, id, row.id, entityId],
          );
          await recordAudit(client, {
            schoolId,
            actorUserId: actor.userId,
            action: 'imports.row_created',
            entityType: batch.entity_type,
            entityId,
            outcome: 'success',
            after: { batchId: id, rowNumber: row.row_number },
            ...requestMeta(request),
          });
          created += 1;
        }

        await client.query(
          `UPDATE import_batches SET
             status = 'committed', created_rows = $3, committed_by = $4, committed_at = now()
           WHERE school_id = $1 AND id = $2`,
          [schoolId, id, created, actor.userId],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: 'imports.committed',
          entityType: 'import_batch',
          entityId: id,
          outcome: 'success',
          after: { entityType: batch.entity_type, created },
          ...requestMeta(request),
        });
        return { id, created, status: 'committed' };
      });
      return committed;
    }),
  );

  app.post(
    '/api/schools/:schoolId/imports/:id/cancel',
    { preHandler: requirePermission('imports.manage') },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const actor = getActor(request);
      const { rows } = await getPool().query<{ id: string }>(
        `UPDATE import_batches SET status = 'cancelled'
         WHERE school_id = $1 AND id = $2 AND status = 'previewed' RETURNING id`,
        [schoolId, id],
      );
      if (!rows[0]) throw conflict('Only a previewed import can be cancelled');
      await recordAudit(getPool(), {
        schoolId,
        actorUserId: actor.userId,
        action: 'imports.cancelled',
        entityType: 'import_batch',
        entityId: id,
        outcome: 'success',
        ...requestMeta(request),
      });
      return { id, status: 'cancelled' };
    },
  );
}

/* --------------------------------- helpers -------------------------------- */

interface BatchRow {
  id: string;
  entity_type: ImportBatch['entityType'];
  filename: string;
  status: ImportBatch['status'];
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_rows: number;
  created_at: Date;
  committed_at: Date | null;
}

interface RowRow {
  id: string;
  row_number: number;
  payload: Record<string, string>;
  errors: string[];
  action: ImportRow['action'];
  created_entity_id: string | null;
}

const batchSelect = `
  SELECT id, entity_type, filename, status, total_rows, valid_rows, invalid_rows,
         created_rows, created_at, committed_at
  FROM import_batches`;

function toBatch(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    entityType: row.entity_type,
    filename: row.filename,
    status: row.status,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    invalidRows: row.invalid_rows,
    createdRows: row.created_rows,
    createdAt: toIsoDateTime(row.created_at),
    committedAt: row.committed_at ? toIsoDateTime(row.committed_at) : null,
  };
}

function toRow(row: RowRow): ImportRow {
  return {
    id: row.id,
    rowNumber: row.row_number,
    payload: row.payload ?? {},
    errors: row.errors ?? [],
    action: row.action,
    createdEntityId: row.created_entity_id,
  };
}

function validateFilters(
  reportType: SavedReport['reportType'],
  filters: Record<string, string | undefined>,
): void {
  const allowed = ALLOWED_FILTERS[reportType];
  const unknown = Object.keys(filters).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw badRequest(`These filters are not valid for a ${reportType} report`, {
      filters: [`Remove: ${unknown.join(', ')}`],
    });
  }
}

interface PreparedRow {
  rowNumber: number;
  payload: Record<string, string>;
  errors: string[];
}

async function prepareImport(
  schoolId: string,
  entityType: ImportBatch['entityType'],
  header: string[],
  body: string[][],
): Promise<PreparedRow[]> {
  const requireColumn = (name: string) => {
    if (!header.includes(name)) throw badRequest(`The CSV needs a "${name}" column`);
  };

  if (entityType === 'students') {
    throw badRequest('Use Students → Import students for admissions. It validates the complete student and guardian record and links the enrollment.');
  } else if (entityType === 'library_books') {
    requireColumn('title');
  } else if (entityType === 'vendors') {
    requireColumn('name');
  } else {
    const required: Record<string, string[]> = {
      academic_years: ['code', 'name', 'starts_on', 'ends_on', 'status'],
      classes: ['code', 'name', 'grade_order', 'status'],
      sections: ['academic_year_code', 'class_code', 'code', 'name', 'capacity', 'status'],
      subjects: ['code', 'name', 'subject_type', 'status'],
      subject_offerings: ['academic_year_code', 'subject_code', 'class_code'],
      staff: ['employee_number', 'first_name', 'last_name', 'email', 'phone', 'designation', 'department', 'joined_on', 'status'],
      rooms: ['code', 'name', 'capacity', 'status'],
      timetable_periods: ['academic_year_code', 'name', 'sequence_no', 'starts_at', 'ends_at', 'is_break'],
      fee_heads: ['code', 'name', 'description', 'status'],
      institution_masters: ['kind', 'code', 'label', 'institution_type', 'active', 'notes'],
    };
    for (const column of required[entityType] ?? []) requireColumn(column);
  }

  const prepared: PreparedRow[] = [];
  const fileKeys = new Set<string>();
  const periodRanges = new Map<string, Array<{ start: string; end: string }>>();
  let activeYearRows = 0;
  for (const [index, raw] of body.entries()) {
    const payload: Record<string, string> = {};
    header.forEach((key, column) => {
      payload[key] = (raw[column] ?? '').trim();
    });
    const errors: string[] = [];
    const value = (name: string) => payload[name] ?? '';
    if (value('sample_only').toLowerCase() === 'yes') errors.push('Example row: replace it with real data or remove this row before committing');

    if (entityType === 'library_books') {
      if (!value('title')) errors.push('title is required');
      const copies = value('copies') || '0';
      if (!/^\d+$/.test(copies) || Number(copies) > 500) {
        errors.push('copies must be a whole number from 0 to 500');
      }
      if (value('category_code')) {
        const category = await getPool().query(
          'SELECT 1 FROM library_categories WHERE school_id = $1 AND lower(code) = lower($2)',
          [schoolId, value('category_code')],
        );
        if (category.rowCount === 0) errors.push('That category code was not found');
      }
    } else if (entityType === 'vendors') {
      if (!value('name')) errors.push('name is required');
      if (value('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) {
        errors.push('email is not valid');
      }
      if (value('status') && !['active', 'inactive', 'blocked'].includes(value('status'))) {
        errors.push('status must be active, inactive or blocked');
      }
      if (value('code')) {
        const duplicate = await getPool().query(
          'SELECT 1 FROM vendors WHERE school_id = $1 AND lower(code) = lower($2)',
          [schoolId, value('code')],
        );
        if (duplicate.rowCount) errors.push('That vendor code is already in use');
      }
    } else {
      const rowNumber = index + 2;
      const duplicate = (key: string, label: string) => {
        if (!value(key)) return;
        const normalized = `${key}:${value(key).toLocaleLowerCase()}`;
        if (fileKeys.has(normalized)) errors.push(`${label} is duplicated in this file`);
        fileKeys.add(normalized);
      };
      const validStatus = (allowed: string[]) => {
        if (value('status') && !allowed.includes(value('status').toLowerCase())) errors.push(`status must be ${allowed.join(', ')}`);
      };
      const checkDuplicate = async (table: string, column: string, key: string, label: string) => {
        if (!value(key)) return;
        const exists = await getPool().query(`SELECT 1 FROM ${table} WHERE school_id=$1 AND lower(${column})=lower($2) LIMIT 1`, [schoolId, value(key)]);
        if (exists.rowCount) errors.push(`${label} already exists in this school`);
      };
      if (entityType === 'academic_years') {
        if (!value('code') || !value('name') || !/^\d{4}-\d{2}-\d{2}$/.test(value('starts_on')) || !/^\d{4}-\d{2}-\d{2}$/.test(value('ends_on'))) errors.push('code, name and ISO dates (YYYY-MM-DD) are required');
        if (value('starts_on') && value('ends_on') && value('ends_on') < value('starts_on')) errors.push('ends_on must not be before starts_on');
        validStatus(['planned', 'active', 'closed', 'archived']);
        if (value('status').toLowerCase() === 'active') {
          activeYearRows += 1;
          const active = await getPool().query("SELECT 1 FROM academic_years WHERE school_id=$1 AND status='active' LIMIT 1", [schoolId]);
          if (active.rowCount) errors.push('an active academic year already exists; create this year as planned and activate it separately');
          if (activeYearRows > 1) errors.push('only one row in an import may be active');
        }
        duplicate('code', 'Academic year code');
        await checkDuplicate('academic_years', 'code', 'code', 'Academic year code');
      } else if (entityType === 'classes') {
        if (!value('code') || !value('name')) errors.push('code and name are required');
        if (value('grade_order') && !/^\d+$/.test(value('grade_order'))) errors.push('grade_order must be a whole number');
        validStatus(['active', 'inactive']); duplicate('code', 'Class code');
        await checkDuplicate('classes', 'code', 'code', 'Class code');
      } else if (entityType === 'sections') {
        if (!value('academic_year_code') || !value('class_code') || !value('code') || !value('name')) errors.push('academic_year_code, class_code, code and name are required');
        if (value('capacity') && (!/^\d+$/.test(value('capacity')) || Number(value('capacity')) > 10000)) errors.push('capacity must be a whole number from 0 to 10000');
        validStatus(['active', 'inactive']);
        const refs = await getPool().query(`SELECT y.id AS year_id,c.id AS class_id FROM academic_years y JOIN classes c ON c.school_id=y.school_id WHERE y.school_id=$1 AND lower(y.code)=lower($2) AND lower(c.code)=lower($3)`, [schoolId, value('academic_year_code'), value('class_code')]);
        if (!refs.rowCount) errors.push('academic_year_code or class_code was not found in this school');
        else if (value('code')) {
          const ref = refs.rows[0]!;
          const key = `section:${ref.year_id}:${ref.class_id}:${value('code').toLowerCase()}`;
          if (fileKeys.has(key)) errors.push('section code is duplicated for this class and year in the file');
          fileKeys.add(key);
        }
        if (value('code')) {
          const exists = await getPool().query(`SELECT 1 FROM sections sec JOIN academic_years y ON y.school_id=sec.school_id AND y.id=sec.academic_year_id JOIN classes c ON c.school_id=sec.school_id AND c.id=sec.class_id WHERE sec.school_id=$1 AND lower(y.code)=lower($2) AND lower(c.code)=lower($3) AND lower(sec.code)=lower($4) LIMIT 1`, [schoolId, value('academic_year_code'), value('class_code'), value('code')]);
          if (exists.rowCount) errors.push('section code already exists for this class and year');
        }
      } else if (entityType === 'subjects') {
        if (!value('code') || !value('name')) errors.push('code and name are required');
        validStatus(['active', 'inactive']); duplicate('code', 'Subject code');
        await checkDuplicate('subjects', 'code', 'code', 'Subject code');
      } else if (entityType === 'subject_offerings') {
        if (!value('academic_year_code') || !value('subject_code') || !value('class_code')) errors.push('academic_year_code, subject_code and class_code are required');
        const refs = await getPool().query(`SELECT y.id AS year_id,s.id AS subject_id,c.id AS class_id FROM academic_years y JOIN subjects s ON s.school_id=y.school_id JOIN classes c ON c.school_id=y.school_id WHERE y.school_id=$1 AND lower(y.code)=lower($2) AND lower(s.code)=lower($3) AND lower(c.code)=lower($4)`, [schoolId, value('academic_year_code'), value('subject_code'), value('class_code')]);
        if (!refs.rowCount) errors.push('academic year, subject or class code was not found in this school');
        else {
          const ref = refs.rows[0]!;
          const duplicateKey = `offering:${ref.year_id}:${ref.subject_id}:${ref.class_id}`;
          if (fileKeys.has(duplicateKey)) errors.push('this subject/class/year offering is duplicated in the file');
          fileKeys.add(duplicateKey);
          const existing = await getPool().query('SELECT 1 FROM subject_class_offerings WHERE school_id=$1 AND academic_year_id=$2 AND subject_id=$3 AND class_id=$4', [schoolId, ref.year_id, ref.subject_id, ref.class_id]);
          if (existing.rowCount) errors.push('this class-subject mapping already exists');
        }
      } else if (entityType === 'staff') {
        if (!value('employee_number') || !value('first_name') || !value('designation')) errors.push('employee_number, first_name and designation are required');
        if (value('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) errors.push('email is not valid');
        if (value('joined_on') && !/^\d{4}-\d{2}-\d{2}$/.test(value('joined_on'))) errors.push('joined_on must use YYYY-MM-DD');
        validStatus(['active', 'on_leave', 'inactive', 'left']); duplicate('employee_number', 'Employee number');
        await checkDuplicate('staff', 'employee_number', 'employee_number', 'Employee number');
      } else if (entityType === 'rooms') {
        if (!value('code') || !value('name')) errors.push('code and name are required');
        if (value('capacity') && (!/^\d+$/.test(value('capacity')) || Number(value('capacity')) > 10000)) errors.push('capacity must be a whole number from 0 to 10000');
        validStatus(['active', 'inactive']); duplicate('code', 'Room code');
        await checkDuplicate('rooms', 'code', 'code', 'Room code');
      } else if (entityType === 'timetable_periods') {
        const validTime = (time: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
        if (!value('academic_year_code') || !value('name') || !/^\d+$/.test(value('sequence_no')) || !validTime(value('starts_at')) || !validTime(value('ends_at'))) errors.push('academic_year_code, name, numeric sequence_no and valid HH:MM start/end times are required');
        if (value('starts_at') && value('ends_at') && value('ends_at') <= value('starts_at')) errors.push('ends_at must be later than starts_at');
        if (value('is_break') && !['true', 'false'].includes(value('is_break').toLowerCase())) errors.push('is_break must be true or false');
        const year = await getPool().query('SELECT id FROM academic_years WHERE school_id=$1 AND lower(code)=lower($2)', [schoolId, value('academic_year_code')]);
        if (!year.rowCount) errors.push('academic_year_code was not found in this school');
        else {
          const yearId = year.rows[0]!.id;
          const key = `period:${yearId}:${value('sequence_no')}`;
          if (fileKeys.has(key)) errors.push('sequence_no is duplicated in this academic year in the file');
          fileKeys.add(key);
          const duplicate = await getPool().query('SELECT 1 FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND sequence_no=$3', [schoolId, yearId, Number(value('sequence_no'))]);
          if (duplicate.rowCount) errors.push('sequence_no already exists in this academic year');
          if (validTime(value('starts_at')) && validTime(value('ends_at')) && value('ends_at') > value('starts_at')) {
            const ranges = periodRanges.get(yearId) ?? [];
            if (ranges.some((range) => range.start < value('ends_at') && range.end > value('starts_at'))) errors.push('period time range overlaps another row in this file');
            ranges.push({ start: value('starts_at'), end: value('ends_at') });
            periodRanges.set(yearId, ranges);
            const overlap = await getPool().query('SELECT 1 FROM timetable_periods WHERE school_id=$1 AND academic_year_id=$2 AND starts_at < $4::time AND ends_at > $3::time LIMIT 1', [schoolId, yearId, value('starts_at'), value('ends_at')]);
            if (overlap.rowCount) errors.push('period time range overlaps an existing period');
          }
        }
      } else if (entityType === 'fee_heads') {
        if (!value('code') || !value('name')) errors.push('code and name are required');
        validStatus(['active', 'inactive']); duplicate('code', 'Fee head code');
        await checkDuplicate('fee_heads', 'code', 'code', 'Fee head code');
      } else if (entityType === 'institution_masters') {
        if (!value('kind') || !/^[a-z][a-z0-9_]{1,59}$/.test(value('kind'))) errors.push('kind must use lowercase letters, digits or underscores');
        if (!value('code') || !value('label') || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/.test(value('code'))) errors.push('valid code and label are required');
        if (value('institution_type') && !['all', 'school', 'college', 'university'].includes(value('institution_type'))) errors.push('institution_type must be all, school, college or university');
        if (value('active') && !['true', 'false'].includes(value('active').toLowerCase())) errors.push('active must be true or false');
        const masterKey = `institution-master:${value('kind').toLowerCase()}:${value('code').toLowerCase()}`;
        if (value('kind') && value('code') && fileKeys.has(masterKey)) errors.push('master code is duplicated for this kind in the file');
        if (value('kind') && value('code')) fileKeys.add(masterKey);
        const exists = await getPool().query('SELECT 1 FROM institution_masters WHERE school_id=$1 AND kind=$2 AND lower(code)=lower($3) LIMIT 1', [schoolId, value('kind'), value('code')]);
        if (exists.rowCount) errors.push('master code already exists for this kind');
      }
      void rowNumber;
    }

    prepared.push({ rowNumber: index + 2, payload, errors });
  }
  return prepared;
}

async function commitRow(
  client: Pick<pg.PoolClient, 'query'>,
  schoolId: string,
  entityType: ImportBatch['entityType'],
  payload: Record<string, string>,
  actorUserId: string,
): Promise<string> {
  if (entityType === 'students') {
    const year = await client.query<{ id: string; starts_on: string }>(
      `SELECT id, starts_on FROM academic_years WHERE school_id = $1 AND status = 'active'`,
      [schoolId],
    );
    const activeYear = year.rows[0];
    if (!activeYear) throw badRequest('No active academic year');
    const section = await client.query<{ id: string; class_id: string; year_code: string }>(
      `SELECT sec.id, sec.class_id, y.code AS year_code
       FROM sections sec
       JOIN classes c ON c.id = sec.class_id AND c.school_id = sec.school_id
       JOIN academic_years y ON y.id = sec.academic_year_id AND y.school_id = sec.school_id
       WHERE sec.school_id = $1 AND sec.academic_year_id = $2
         AND lower(c.name) = lower($3) AND lower(sec.name) = lower($4)`,
      [schoolId, activeYear.id, payload.class_name, payload.section_name],
    );
    const sectionRow = section.rows[0];
    if (!sectionRow) throw badRequest('The section no longer exists');
    const admission =
      payload.admission_number || (await nextAdmissionNumber(client, schoolId, sectionRow.year_code));
    const student = await client.query<{ id: string }>(
      `INSERT INTO students
         (school_id, admission_number, first_name, middle_name, last_name, date_of_birth, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id`,
      [
        schoolId,
        admission,
        payload.first_name,
        payload.middle_name || null,
        payload.last_name || null,
        payload.date_of_birth || null,
      ],
    );
    const studentId = student.rows[0]!.id;
    await client.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, class_id, section_id, enrollment_status,
          starts_on)
       VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
      [
        schoolId,
        studentId,
        activeYear.id,
        sectionRow.class_id,
        sectionRow.id,
        toIsoDate(activeYear.starts_on) || new Date().toISOString().slice(0, 10),
      ],
    );
    if (payload.guardian_first_name) {
      const guardian = payload.guardian_email
        ? await client.query<{ id: string }>(
            'SELECT id FROM guardians WHERE school_id = $1 AND lower(email) = lower($2) LIMIT 1',
            [schoolId, payload.guardian_email],
          )
        : await client.query<{ id: string }>(
            'SELECT id FROM guardians WHERE school_id = $1 AND phone = $2 LIMIT 1',
            [schoolId, payload.guardian_phone],
          );
      const guardianId = guardian.rows[0]?.id ?? (await client.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, email, phone)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, payload.guardian_first_name, payload.guardian_last_name || null, payload.guardian_email || null, payload.guardian_phone || null],
      )).rows[0]!.id;
      await client.query(
        `INSERT INTO student_guardians
           (school_id, student_id, guardian_id, relationship_type, is_primary, portal_access_status)
         VALUES ($1, $2, $3, $4, $5, 'pending') ON CONFLICT (student_id, guardian_id) DO NOTHING`,
        [schoolId, studentId, guardianId, payload.guardian_relationship || 'parent', payload.guardian_is_primary?.toLowerCase() === 'true'],
      );
    }
    return studentId;
  }

  if (entityType === 'library_books') {
    const categoryId = payload.category_code
      ? (
          await client.query<{ id: string }>(
            'SELECT id FROM library_categories WHERE school_id = $1 AND lower(code) = lower($2)',
            [schoolId, payload.category_code],
          )
        ).rows[0]?.id ?? null
      : null;
    const book = await client.query<{ id: string }>(
      `INSERT INTO library_books
         (school_id, category_id, title, author, publisher, isbn, language, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        schoolId,
        categoryId,
        payload.title,
        payload.author || null,
        payload.publisher || null,
        payload.isbn || null,
        payload.language || null,
        payload.description || null,
      ],
    );
    const bookId = book.rows[0]!.id;
    const copies = Number(payload.copies || '0');
    for (let index = 0; index < copies; index += 1) {
      await client.query(
        `INSERT INTO library_copies (school_id, book_id, accession_number)
         VALUES ($1, $2, $3)`,
        [schoolId, bookId, await nextAccession(client, schoolId)],
      );
    }
    return bookId;
  }

  if (entityType === 'academic_years') {
    const result = await client.query<{ id: string }>(
      `INSERT INTO academic_years(school_id,code,name,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [schoolId, payload.code, payload.name, payload.starts_on, payload.ends_on, payload.status || 'planned'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'classes') {
    const result = await client.query<{ id: string }>(
      `INSERT INTO classes(school_id,code,name,grade_order,status) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, payload.code, payload.name, payload.grade_order ? Number(payload.grade_order) : null, payload.status || 'active'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'sections') {
    const refs = await client.query<{ year_id: string; class_id: string }>(
      `SELECT y.id AS year_id,c.id AS class_id FROM academic_years y JOIN classes c ON c.school_id=y.school_id WHERE y.school_id=$1 AND lower(y.code)=lower($2) AND lower(c.code)=lower($3)`,
      [schoolId, payload.academic_year_code, payload.class_code],
    );
    const ref = refs.rows[0];
    if (!ref) throw badRequest('The academic year or class reference no longer exists in this school');
    const result = await client.query<{ id: string }>(
      `INSERT INTO sections(school_id,academic_year_id,class_id,code,name,capacity,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [schoolId, ref.year_id, ref.class_id, payload.code, payload.name, payload.capacity ? Number(payload.capacity) : null, payload.status || 'active'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'subjects') {
    const result = await client.query<{ id: string }>(
      `INSERT INTO subjects(school_id,code,name,subject_type,status) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, payload.code, payload.name, payload.subject_type || 'academic', payload.status || 'active'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'subject_offerings') {
    const refs = await client.query<{ academic_year_id: string; subject_id: string; class_id: string }>(
      `SELECT y.id AS academic_year_id,s.id AS subject_id,c.id AS class_id FROM academic_years y JOIN subjects s ON s.school_id=y.school_id JOIN classes c ON c.school_id=y.school_id WHERE y.school_id=$1 AND lower(y.code)=lower($2) AND lower(s.code)=lower($3) AND lower(c.code)=lower($4)`,
      [schoolId, payload.academic_year_code, payload.subject_code, payload.class_code],
    );
    const ref = refs.rows[0];
    if (!ref) throw badRequest('The academic year, subject or class reference no longer exists in this school');
    const result = await client.query<{ id: string }>(
      `INSERT INTO subject_class_offerings(school_id,academic_year_id,subject_id,class_id,updated_by) VALUES($1,$2,$3,$4,$5) RETURNING subject_id AS id`,
      [schoolId, ref.academic_year_id, ref.subject_id, ref.class_id, actorUserId],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'staff') {
    const result = await client.query<{ id: string }>(
      `INSERT INTO staff(school_id,employee_number,first_name,last_name,email,phone,designation,department,joined_on,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [schoolId, payload.employee_number, payload.first_name, payload.last_name || null, payload.email || null, payload.phone || null, payload.designation, payload.department || null, payload.joined_on || null, payload.status || 'active'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'rooms') {
    const result = await client.query<{ id: string }>(
      `INSERT INTO rooms(school_id,code,name,capacity,status) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, payload.code, payload.name, payload.capacity ? Number(payload.capacity) : null, payload.status || 'active'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'timetable_periods') {
    const year = await client.query<{ id: string }>('SELECT id FROM academic_years WHERE school_id=$1 AND lower(code)=lower($2)', [schoolId, payload.academic_year_code]);
    if (!year.rows[0]) throw badRequest('The academic year reference no longer exists in this school');
    const result = await client.query<{ id: string }>(
      `INSERT INTO timetable_periods(school_id,academic_year_id,name,sequence_no,starts_at,ends_at,is_break) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [schoolId, year.rows[0].id, payload.name, Number(payload.sequence_no), payload.starts_at, payload.ends_at, payload.is_break.toLowerCase() === 'true'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'fee_heads') {
    const result = await client.query<{ id: string }>(
      `INSERT INTO fee_heads(school_id,code,name,description,status) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [schoolId, payload.code, payload.name, payload.description || null, payload.status || 'active'],
    );
    return result.rows[0]!.id;
  }
  if (entityType === 'institution_masters') {
    const result = await client.query<{ id: string }>(
      `INSERT INTO institution_masters(school_id,kind,code,label,institution_type,active,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [schoolId, payload.kind, payload.code, payload.label, payload.institution_type || 'all', payload.active ? payload.active.toLowerCase() === 'true' : true, payload.notes || ''],
    );
    return result.rows[0]!.id;
  }

  const code = payload.code || (await nextVendorCode(client, schoolId));
  const vendor = await client.query<{ id: string }>(
    `INSERT INTO vendors
       (school_id, code, name, contact_name, email, phone, address, status, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      schoolId,
      code,
      payload.name,
      payload.contact_name || null,
      payload.email || null,
      payload.phone || null,
      payload.address || null,
      payload.status || 'active',
      payload.notes || null,
      actorUserId,
    ],
  );
  return vendor.rows[0]!.id;
}

async function nextAdmissionNumber(
  client: Pick<pg.PoolClient, 'query'>,
  schoolId: string,
  yearCode: string,
): Promise<string> {
  const { rows } = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM students WHERE school_id = $1',
    [schoolId],
  );
  return `${yearCode}-${String(toNumber(rows[0]?.count) + 1).padStart(4, '0')}`;
}

async function nextAccession(
  client: Pick<pg.PoolClient, 'query'>,
  schoolId: string,
): Promise<string> {
  const { rows } = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM library_copies WHERE school_id = $1',
    [schoolId],
  );
  return `ACC-${String(toNumber(rows[0]?.count) + 1).padStart(6, '0')}`;
}

async function nextVendorCode(
  client: Pick<pg.PoolClient, 'query'>,
  schoolId: string,
): Promise<string> {
  const { rows } = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM vendors WHERE school_id = $1',
    [schoolId],
  );
  return `VEN-${String(toNumber(rows[0]?.count) + 1).padStart(4, '0')}`;
}

/**
 * Minimal RFC 4180 reader: quoted cells, escaped quotes and CRLF are supported.
 * It rejects unbalanced quotes instead of silently guessing.
 */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = csv.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      if (cell !== '') throw badRequest('A quote can only start a quoted CSV cell');
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char === '\r') {
      // Ignored; the following \n ends the row.
    } else {
      cell += char;
    }
  }
  if (quoted) throw badRequest('The CSV has an unclosed quote');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
