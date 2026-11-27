import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getPool } from '../db';
import { requirePermission } from '../auth/guards';
import { assertGuardianLinked } from '../lib/portal';
import { badRequest, forbidden, notFound, parseInput } from '../lib/errors';
import { recordAudit } from '../lib/audit';

const childOfflineParam = z.object({
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
});

const ackIdParam = z.object({
  schoolId: z.string().uuid(),
  id: z.string().uuid(),
});

const offlineAckInput = z.object({
  amount: z.coerce.number().min(1, 'Amount must be greater than zero').max(10000000),
  paymentMethod: z.enum(['cash', 'cheque', 'bank_transfer', 'upi', 'demand_draft', 'pos_slip', 'other']),
  referenceNumber: z.string().trim().min(2, 'Reference/UTR/Cheque number is required').max(120),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date format'),
  bankName: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  evidenceUrl: z.string().trim().max(500).optional().nullable(),
});

const verifyAckInput = z.object({
  notes: z.string().trim().max(500).optional(),
});

const updateAckStatusInput = z.object({
  status: z.enum(['under_review', 'unmatched', 'more_info_needed', 'rejected']),
  reviewNotes: z.string().trim().min(3).max(500),
  parentContactOutcome: z.string().trim().max(500).optional(),
});

export async function registerOfflinePaymentRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------- Parent: Submit offline acknowledgement ---------------- */
  app.post(
    '/api/schools/:schoolId/portal/children/:studentId/offline-payments',
    { preHandler: [requirePermission('guardian.student.view')] },
    async (request) => {
      const { schoolId, studentId } = parseInput(childOfflineParam, request.params);
      const pool = getPool();
      await assertGuardianLinked(pool, schoolId, request.user!.id, studentId);

      const input = parseInput(offlineAckInput, request.body);

      // Find guardian id
      const { rows: gRows } = await pool.query<{ id: string }>(
        `SELECT id FROM guardians WHERE school_id = $1 AND user_id = $2 LIMIT 1`,
        [schoolId, request.user!.id],
      );

      const { rows: inserted } = await pool.query<{ id: string }>(
        `INSERT INTO fee_offline_payment_acknowledgements
           (school_id, student_id, guardian_id, amount, payment_method, reference_number, payment_date, bank_name, notes, evidence_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
         RETURNING id`,
        [
          schoolId,
          studentId,
          gRows[0]?.id || null,
          input.amount,
          input.paymentMethod,
          input.referenceNumber,
          input.paymentDate,
          input.bankName || null,
          input.notes || null,
          input.evidenceUrl || null,
        ],
      );

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: 'fee.offline_payment.acknowledged',
        entityType: 'fee_offline_payment_acknowledgement',
        entityId: inserted[0]!.id,
        outcome: 'success',
      });

      return {
        id: inserted[0]!.id,
        status: 'pending',
        acknowledgement: {
          id: inserted[0]!.id,
          status: 'pending',
        },
        message: 'Offline payment reference submitted. The finance office will verify this against bank records.',
      };
    },
  );

  /* ------------------ Parent: List child's acknowledgements ------------------ */
  app.get(
    '/api/schools/:schoolId/portal/children/:studentId/offline-payments',
    { preHandler: [requirePermission('guardian.student.view')] },
    async (request) => {
      const { schoolId, studentId } = parseInput(childOfflineParam, request.params);
      const pool = getPool();
      await assertGuardianLinked(pool, schoolId, request.user!.id, studentId);

      const { rows } = await pool.query<{
        id: string;
        amount: number;
        payment_method: string;
        reference_number: string;
        payment_date: string;
        bank_name: string | null;
        status: string;
        review_notes: string | null;
        created_at: string;
      }>(
        `SELECT
           id,
           amount,
           payment_method,
           reference_number,
           to_char(payment_date, 'YYYY-MM-DD') AS payment_date,
           bank_name,
           status,
           review_notes,
           to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
         FROM fee_offline_payment_acknowledgements
         WHERE school_id = $1 AND student_id = $2
         ORDER BY created_at DESC`,
        [schoolId, studentId],
      );

      return {
        items: rows.map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          paymentMethod: r.payment_method,
          referenceNumber: r.reference_number,
          paymentDate: r.payment_date,
          bankName: r.bank_name,
          status: r.status,
          reviewNotes: r.review_notes,
          createdAt: r.created_at,
        })),
      };
    },
  );

  /* ------------------ Finance: List queue of acknowledgements ---------------- */
  app.get(
    '/api/schools/:schoolId/fees/offline-acknowledgements',
    { preHandler: [requirePermission('fees.view')] },
    async (request) => {
      const { schoolId } = parseInput(z.object({ schoolId: z.string().uuid() }), request.params);
      const pool = getPool();

      const { rows } = await pool.query<{
        id: string;
        student_id: string;
        student_name: string;
        admission_number: string;
        class_name: string;
        section_name: string;
        amount: number;
        payment_method: string;
        reference_number: string;
        payment_date: string;
        bank_name: string | null;
        status: string;
        notes: string | null;
        evidence_url: string | null;
        review_notes: string | null;
        created_at: string;
      }>(
        `SELECT
           ack.id,
           s.id AS student_id,
           concat_ws(' ', s.first_name, s.middle_name, s.last_name) AS student_name,
           s.admission_number,
           c.name AS class_name,
           sec.name AS section_name,
           ack.amount,
           ack.payment_method,
           ack.reference_number,
           to_char(ack.payment_date, 'YYYY-MM-DD') AS payment_date,
           ack.bank_name,
           ack.status,
           ack.notes,
           ack.evidence_url,
           ack.review_notes,
           to_char(ack.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
         FROM fee_offline_payment_acknowledgements ack
         JOIN students s ON s.id = ack.student_id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.enrollment_status = 'active'
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN sections sec ON sec.id = e.section_id
         WHERE ack.school_id = $1
         ORDER BY ack.status = 'pending' DESC, ack.payment_date DESC`,
        [schoolId],
      );

      return {
        items: rows.map((r) => ({
          id: r.id,
          studentId: r.student_id,
          studentName: r.student_name,
          admissionNumber: r.admission_number,
          className: r.class_name,
          sectionName: r.section_name,
          amount: Number(r.amount),
          paymentMethod: r.payment_method,
          referenceNumber: r.reference_number,
          paymentDate: r.payment_date,
          bankName: r.bank_name,
          status: r.status,
          notes: r.notes,
          evidenceUrl: r.evidence_url,
          reviewNotes: r.review_notes,
          createdAt: r.created_at,
        })),
      };
    },
  );

  /* ------------------- Finance: Verify and confirm payment ------------------- */
  app.post(
    '/api/schools/:schoolId/fees/offline-acknowledgements/:id/verify',
    { preHandler: [requirePermission('fees.payment.verify')] },
    async (request) => {
      const { schoolId, id } = parseInput(ackIdParam, request.params);
      const input = parseInput(verifyAckInput, request.body);
      const pool = getPool();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Lock acknowledgement row
        const { rows: ackRows } = await client.query<{
          id: string;
          student_id: string;
          amount: number;
          payment_method: string;
          reference_number: string;
          payment_date: string;
          status: string;
          collector_user_id: string|null;
        }>(
          `SELECT id, student_id, amount, payment_method, reference_number, collector_user_id,
                  to_char(payment_date, 'YYYY-MM-DD') AS payment_date, status
           FROM fee_offline_payment_acknowledgements
           WHERE school_id = $1 AND id = $2
           FOR UPDATE`,
          [schoolId, id],
        );

        const ack = ackRows[0];
        if (!ack) throw notFound('Acknowledgement not found');
        if (ack.collector_user_id === request.user!.id) throw forbidden('Another finance officer must verify this collection');
        if (ack.status === 'verified') {
          throw badRequest('This offline payment has already been verified.');
        }

        // Find student active enrollment for academic_year_id
        const { rows: enrRows } = await client.query<{ academic_year_id: string }>(
          `SELECT academic_year_id FROM enrollments
           WHERE school_id = $1 AND student_id = $2 AND enrollment_status = 'active'
           ORDER BY starts_on DESC LIMIT 1`,
          [schoolId, ack.student_id],
        );
        const academicYearId = enrRows[0]?.academic_year_id;
        if (!academicYearId) throw badRequest('No active academic year enrollment found for student.');

        // Generate receipt number
        const receiptNo = `RCPT-OFF-${Date.now().toString().slice(-8)}`;

        // Create confirmed payment
        const { rows: pRows } = await client.query<{ id: string }>(
          `INSERT INTO payments
             (school_id, student_id, academic_year_id, receipt_number, amount, method, reference, notes, paid_on, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            schoolId,
            ack.student_id,
            academicYearId,
            receiptNo,
            ack.amount,
            ack.payment_method === 'upi' ? 'upi' : ack.payment_method === 'cash' ? 'cash' : 'bank_transfer',
            ack.reference_number,
            input.notes ? `Verified offline ack: ${input.notes}` : `Verified offline ack ${ack.reference_number}`,
            ack.payment_date,
            request.user!.id,
          ],
        );
        const paymentId = pRows[0]!.id;

        // Auto-allocate against student's open charges
        const { rows: openCharges } = await client.query<{
          id: string;
          amount: number;
          concession: number;
          paid: number;
        }>(
          `SELECT
             sc.id,
             sc.amount,
             sc.concession_amount AS concession,
             coalesce(sum(pa.amount), 0)::numeric AS paid
           FROM student_charges sc
           LEFT JOIN payment_allocations pa ON pa.charge_id = sc.id AND pa.school_id = sc.school_id
           WHERE sc.school_id = $1 AND sc.student_id = $2
           GROUP BY sc.id, sc.amount, sc.concession_amount
           ORDER BY sc.created_at ASC`,
          [schoolId, ack.student_id],
        );

        let remainingToAllocate = Number(ack.amount);
        for (const charge of openCharges) {
          if (remainingToAllocate <= 0) break;
          const openBalance = Math.max(0, Number(charge.amount) - Number(charge.concession) - Number(charge.paid));
          if (openBalance > 0) {
            const alloc = Math.min(openBalance, remainingToAllocate);
            await client.query(
              `INSERT INTO payment_allocations
                 (school_id, payment_id, charge_id, amount)
               VALUES ($1, $2, $3, $4)`,
              [schoolId, paymentId, charge.id, alloc],
            );
            remainingToAllocate -= alloc;
          }
        }

        // Update acknowledgement
        await client.query(
          `UPDATE fee_offline_payment_acknowledgements
           SET status = 'verified',
               verified_payment_id = $1,
               reviewed_by = $2,
               reviewed_at = now(),
               review_notes = $3
           WHERE school_id = $4 AND id = $5`,
          [paymentId, request.user!.id, input.notes || 'Verified against bank/cash records', schoolId, id],
        );

        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: 'fee.offline_payment.verified',
          entityType: 'fee_offline_payment_acknowledgement',
          entityId: id,
          outcome: 'success',
          after: { paymentId, receiptNumber: receiptNo, verifiedAmount: ack.amount },
        });

        await client.query('COMMIT');

        return {
          status: 'verified',
          paymentId,
          receiptNumber: receiptNo,
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  );

  /* ----------------- Finance: Update status / contact outcome ---------------- */
  app.post(
    '/api/schools/:schoolId/fees/offline-acknowledgements/:id/status',
    { preHandler: [requirePermission('fees.payment.verify')] },
    async (request) => {
      const { schoolId, id } = parseInput(ackIdParam, request.params);
      const input = parseInput(updateAckStatusInput, request.body);
      const pool = getPool();

      const { rowCount } = await pool.query(
        `UPDATE fee_offline_payment_acknowledgements
         SET status = $1,
             review_notes = $2,
             parent_contact_outcome = $3,
             parent_contacted_at = CASE WHEN $3::text IS NOT NULL THEN now() ELSE parent_contacted_at END,
             reviewed_by = $4,
             reviewed_at = now()
         WHERE school_id = $5 AND id = $6`,
        [input.status, input.reviewNotes, input.parentContactOutcome || null, request.user!.id, schoolId, id],
      );

      if (rowCount === 0) throw notFound('Acknowledgement not found');

      await recordAudit(pool, {
        schoolId,
        actorUserId: request.user!.id,
        action: 'fee.offline_payment.status_updated',
        entityType: 'fee_offline_payment_acknowledgement',
        entityId: id,
        outcome: 'success',
        after: { status: input.status, reviewNotes: input.reviewNotes },
      });

      return { status: input.status };
    },
  );
}
