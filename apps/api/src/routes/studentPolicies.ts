import { centralManagement } from '../lib/institutionPolicy';
import {
  defaultStudentPolicy,
  stateCodeInput,
  studentPolicyInput,
  uuid,
  type StudentLifecycleReview,
} from "@erp/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getActor, requirePermission, requestMeta } from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { recordAudit } from "../lib/audit";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  parseInput,
} from "../lib/errors";
import { todayInTimeZone } from "../lib/format";

const stateParams = z.object({ schoolId: uuid, stateCode: stateCodeInput });
const idParams = z.object({ schoolId: uuid, id: uuid });
async function loadPolicy(schoolId: string, stateCode: string) {
  const { rows } = await getPool().query<{
    config_value: unknown;
    version: number;
  }>(
    `SELECT config_value,version FROM school_configurations WHERE school_id=$1 AND config_key=$2 AND status='published' ORDER BY version DESC LIMIT 1`,
    [schoolId, `student_policy_${stateCode}`],
  );
  const policy=rows[0]?studentPolicyInput.parse(rows[0].config_value):defaultStudentPolicy(stateCode);
  const management=await centralManagement(schoolId);
  return {policy:management?{...policy,management}:policy,version:rows[0]?.version??0,managementManagedCentrally:!!management};
}
async function assertCurrentState(schoolId: string, stateCode: string) {
  const { rows } = await getPool().query<{ state: string }>(
    `SELECT config_value->>'stateCode' AS state FROM school_configurations WHERE school_id=$1 AND config_key='regional_settings' AND status='published' ORDER BY version DESC LIMIT 1`,
    [schoolId],
  );
  if (rows[0]?.state !== stateCode)
    throw badRequest(
      "Select this state in school setup before applying its policy",
    );
}

export async function registerStudentPolicyRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/admission-policy",
    { preHandler: requirePermission("school.view") },
    async (request) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: uuid }),
        request.params,
      );
      const { rows } = await getPool().query<{ state: string | null }>(
        `SELECT config_value->>'stateCode' AS state FROM school_configurations WHERE school_id=$1 AND config_key='regional_settings' AND status='published' ORDER BY version DESC LIMIT 1`,
        [schoolId],
      );
      const stateCode = rows[0]?.state;
      if (!stateCode)
        return { stateCode: null, requirements: [], reference: "" };
      const { policy } = await loadPolicy(schoolId, stateCode);
      return {
        stateCode,
        requirements: policy.admissionRequirements,
        reference: policy.policyReference,
      };
    },
  );
  app.get(
    "/api/schools/:schoolId/student-policies/:stateCode",
    { preHandler: requirePermission("school.manage") },
    async (request) => {
      const { schoolId, stateCode } = parseInput(stateParams, request.params);
      return loadPolicy(schoolId, stateCode);
    },
  );
  app.put(
    "/api/schools/:schoolId/student-policies/:stateCode",
    { preHandler: requirePermission("school.manage") },
    async (request) => {
      const { schoolId, stateCode } = parseInput(stateParams, request.params);
      const policy = parseInput(studentPolicyInput, request.body);
      const management=await centralManagement(schoolId);
      if(management&&management!==policy.management)throw badRequest('Management type is maintained centrally in Institution masters');
      if (policy.stateCode !== stateCode)
        throw badRequest("Policy state does not match its URL");
      return withTransaction(async (client) => {
        await client.query(`SELECT id FROM schools WHERE id=$1 FOR UPDATE`, [
          schoolId,
        ]);
        const key = `student_policy_${stateCode}`;
        const version = (
          await client.query<{ version: number }>(
            `SELECT coalesce(max(version),0)+1 AS version FROM school_configurations WHERE school_id=$1 AND config_key=$2`,
            [schoolId, key],
          )
        ).rows[0]!.version;
        const saved = await client.query<{ id: string }>(
          `INSERT INTO school_configurations(school_id,config_key,config_value,version,status,published_by,published_at,notes)
        VALUES($1,$2,$3,$4,'published',$5,now(),'Administrator-defined student policy; not government-verified') RETURNING id`,
          [schoolId, key, JSON.stringify(policy), version, request.user!.id],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "students.policy_saved",
          entityType: "school_configuration",
          entityId: saved.rows[0]!.id,
          outcome: "success",
          after: { stateCode, version },
          ...requestMeta(request),
        });
        return { policy, version };
      });
    },
  );
  app.post(
    "/api/schools/:schoolId/student-policies/:stateCode/apply",
    { preHandler: requirePermission("school.manage") },
    async (request) => {
      const { schoolId, stateCode } = parseInput(stateParams, request.params);
      await assertCurrentState(schoolId, stateCode);
      const { policy, version } = await loadPolicy(schoolId, stateCode);
      if (!version)
        throw badRequest("Save an administrator-approved policy first");
      return withTransaction(async (client) => {
        await client.query(`SELECT id FROM schools WHERE id=$1 FOR UPDATE`, [
          schoolId,
        ]);
        for (const head of policy.feeHeads)
          await client.query(
            `INSERT INTO fee_heads(school_id,code,name,description) VALUES($1,$2,$3,$4)
        ON CONFLICT(school_id,code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description`,
            [schoolId, head.code, head.name, head.description],
          );
        await client.query(
          `INSERT INTO student_policy_runtime(school_id,state_code) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [schoolId, stateCode],
        );
        let ruleId = (
          await client.query<{ late_rule_id: string | null }>(
            `SELECT late_rule_id FROM student_policy_runtime WHERE school_id=$1 AND state_code=$2 FOR UPDATE`,
            [schoolId, stateCode],
          )
        ).rows[0]!.late_rule_id;
        const rule = policy.lateFee;
        if (ruleId)
          await client.query(
            `UPDATE fee_late_fee_rules SET grace_days=$3,percent_per_month=$4,max_amount=$5,active=$6 WHERE school_id=$1 AND id=$2`,
            [
              schoolId,
              ruleId,
              rule.graceDays,
              rule.percentPerMonth,
              rule.maxAmount,
              rule.enabled,
            ],
          );
        else if (rule.enabled) {
          ruleId = (
            await client.query<{ id: string }>(
              `INSERT INTO fee_late_fee_rules(school_id,name,grace_days,percent_per_month,max_amount,active) VALUES($1,$2,$3,$4,$5,true) RETURNING id`,
              [
                schoolId,
                `[${stateCode}] School-configured late fee`,
                rule.graceDays,
                rule.percentPerMonth,
                rule.maxAmount,
              ],
            )
          ).rows[0]!.id;
        }
        await client.query(
          `UPDATE student_policy_runtime SET late_rule_id=$3,applied_version=$4 WHERE school_id=$1 AND state_code=$2`,
          [schoolId, stateCode, ruleId, version],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "students.policy_applied",
          entityType: "student_policy",
          outcome: "success",
          after: { stateCode, version, headCount: policy.feeHeads.length },
          ...requestMeta(request),
        });
        return {
          headsApplied: policy.feeHeads.length,
          lateRuleId: ruleId,
          version,
        };
      });
    },
  );
  app.post(
    "/api/schools/:schoolId/student-policies/:stateCode/review-overdue",
    { preHandler: requirePermission("school.manage") },
    async (request) => {
      const { schoolId, stateCode } = parseInput(stateParams, request.params);
      await assertCurrentState(schoolId, stateCode);
      const { policy } = await loadPolicy(schoolId, stateCode);
      if (policy.reviewAfterDays === null)
        throw badRequest("Set an overdue review threshold first");
      const today = todayInTimeZone(getActor(request).school.timezone);
      return withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO student_lifecycle_reviews(school_id,student_id,enrollment_id,academic_year_id,state_code,policy,outstanding,created_by)
        SELECT ch.school_id,ch.student_id,e.id,ch.academic_year_id,$2,$3::jsonb,
          sum(greatest(0,ch.amount-ch.concession_amount-ch.write_off_amount-coalesce((SELECT sum(pa.amount) FROM payment_allocations pa WHERE pa.school_id=ch.school_id AND pa.charge_id=ch.id),0))),$4
        FROM student_charges ch JOIN enrollments e ON e.school_id=ch.school_id AND e.student_id=ch.student_id AND e.academic_year_id=ch.academic_year_id AND e.enrollment_status='active'
        JOIN academic_years y ON y.school_id=ch.school_id AND y.id=ch.academic_year_id AND y.status='active'
        WHERE ch.school_id=$1 AND ch.due_on<=$5::date-$6::int GROUP BY ch.school_id,ch.student_id,e.id,ch.academic_year_id
        HAVING sum(greatest(0,ch.amount-ch.concession_amount-ch.write_off_amount-coalesce((SELECT sum(pa.amount) FROM payment_allocations pa WHERE pa.school_id=ch.school_id AND pa.charge_id=ch.id),0)))>0
        ON CONFLICT(school_id,student_id,academic_year_id,state_code) DO NOTHING RETURNING id`,
          [
            schoolId,
            stateCode,
            JSON.stringify(policy),
            request.user!.id,
            today,
            policy.reviewAfterDays,
          ],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "students.overdue_review_run",
          entityType: "student_policy",
          outcome: "success",
          after: { stateCode, newCases: rows.length },
          ...requestMeta(request),
        });
        return { created: rows.length };
      });
    },
  );
  app.get(
    "/api/schools/:schoolId/student-policy-reviews",
    { preHandler: requirePermission("school.manage") },
    async (request) => {
      const { schoolId } = parseInput(
        z.object({ schoolId: uuid }),
        request.params,
      );
      const { rows } = await getPool().query<StudentLifecycleReview>(
        `SELECT r.id,r.student_id AS "studentId",concat_ws(' ',s.first_name,s.last_name) AS "studentName",s.admission_number AS "admissionNumber",r.state_code AS "stateCode",r.outstanding::float8 AS outstanding,r.status,c.grade_order AS grade,r.created_at::text AS "createdAt",r.decision_note AS "decisionNote",r.policy
      FROM student_lifecycle_reviews r JOIN students s ON s.school_id=r.school_id AND s.id=r.student_id JOIN enrollments e ON e.id=r.enrollment_id AND e.school_id=r.school_id JOIN classes c ON c.id=e.class_id AND c.school_id=e.school_id WHERE r.school_id=$1 ORDER BY r.created_at DESC LIMIT 200`,
        [schoolId],
      );
      return { items: rows };
    },
  );
  app.post(
    "/api/schools/:schoolId/student-policy-reviews/:id/decide",
    { preHandler: requirePermission("school.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(
        z.object({
          decision: z.enum(["continue", "withdraw"]),
          note: z.string().trim().min(10).max(2000),
          authorityReference: z.string().trim().max(500).default(""),
        }),
        request.body,
      );
      const today = todayInTimeZone(getActor(request).school.timezone);
      return withTransaction(async (client) => {
        const { rows } = await client.query<{
          student_id: string;
          enrollment_id: string;
          created_by: string;
          status: string;
          grade: number | null;
          starts_on: string;
        }>(
          `SELECT r.*,c.grade_order AS grade,e.starts_on::text FROM student_lifecycle_reviews r JOIN enrollments e ON e.id=r.enrollment_id AND e.school_id=r.school_id JOIN classes c ON c.id=e.class_id AND c.school_id=e.school_id WHERE r.school_id=$1 AND r.id=$2 FOR UPDATE OF r,e`,
          [schoolId, id],
        );
        const row = rows[0];
        if (!row) throw notFound("Review case not found");
        if (row.status !== "pending")
          throw conflict("This case is already decided");
        if (input.decision === "withdraw") {
          if (row.grade === null || row.grade <= 8)
            throw badRequest(
              "Fee-based withdrawal is disabled for elementary or unclassified students. Keep the admission active and resolve this through an appropriate authorised process.",
            );
          if (!input.authorityReference)
            throw badRequest(
              "Record the applicable authority/policy and notice reference before withdrawal",
            );
          if (row.created_by === request.user!.id)
            throw forbidden(
              "A different administrator must approve withdrawal",
            );
          if (today < row.starts_on)
            throw badRequest("An enrollment cannot end before it starts");
          const balance = await client.query<{ amount: string }>(
            `SELECT coalesce(sum(greatest(0,ch.amount-ch.concession_amount-ch.write_off_amount-coalesce((SELECT sum(pa.amount) FROM payment_allocations pa WHERE pa.school_id=ch.school_id AND pa.charge_id=ch.id),0))),0)::text AS amount
          FROM student_charges ch JOIN enrollments e ON e.school_id=ch.school_id AND e.student_id=ch.student_id AND e.academic_year_id=ch.academic_year_id
          WHERE ch.school_id=$1 AND e.id=$2 AND ch.due_on<=$3::date-coalesce((SELECT (policy->>'reviewAfterDays')::int FROM student_lifecycle_reviews WHERE school_id=$1 AND id=$4),0)`,
            [schoolId, row.enrollment_id, today, id],
          );
          if (Number(balance.rows[0]!.amount) <= 0)
            throw badRequest(
              "The overdue charges have been settled; keep the admission active and close this review",
            );
          const ended = await client.query(
            `UPDATE enrollments SET enrollment_status='withdrawn',ends_on=$3 WHERE school_id=$1 AND id=$2 AND enrollment_status='active' RETURNING id`,
            [schoolId, row.enrollment_id, today],
          );
          if (!ended.rowCount)
            throw conflict("This enrollment is no longer active");
          await client.query(
            `UPDATE students s SET status='withdrawn' WHERE s.school_id=$1 AND s.id=$2 AND NOT EXISTS(SELECT 1 FROM enrollments e WHERE e.school_id=s.school_id AND e.student_id=s.id AND e.enrollment_status='active')`,
            [schoolId, row.student_id],
          );
        }
        await client.query(
          `UPDATE student_lifecycle_reviews SET status=$3,reviewed_by=$4,reviewed_at=now(),decision_note=$5,authority_reference=$6 WHERE school_id=$1 AND id=$2`,
          [
            schoolId,
            id,
            input.decision === "withdraw" ? "withdrawn" : "continued",
            request.user!.id,
            input.note,
            input.authorityReference,
          ],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "students.policy_review_decided",
          entityType: "student_lifecycle_review",
          entityId: id,
          outcome: "success",
          after: { decision: input.decision },
          ...requestMeta(request),
        });
        return {
          id,
          status: input.decision === "withdraw" ? "withdrawn" : "continued",
        };
      });
    },
  );
  app.post(
    "/api/schools/:schoolId/student-policy-reviews/:id/readmit",
    { preHandler: requirePermission("school.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(
        z.object({
          sectionId: uuid,
          startsOn: z.string().date(),
          note: z.string().trim().min(10).max(2000),
        }),
        request.body,
      );
      return withTransaction(async (client) => {
        const { rows } = await client.query<{
          student_id: string;
          academic_year_id: string;
          status: string;
          enrollment_id: string;
        }>(
          `SELECT student_id,academic_year_id,status,enrollment_id FROM student_lifecycle_reviews WHERE school_id=$1 AND id=$2 FOR UPDATE`,
          [schoolId, id],
        );
        const row = rows[0];
        if (!row) throw notFound("Review case not found");
        if (row.status !== "withdrawn")
          throw conflict("Only a withdrawn case can be readmitted");
        await client.query(
          `SELECT id FROM students WHERE school_id=$1 AND id=$2 FOR UPDATE`,
          [schoolId, row.student_id],
        );
        const section = await client.query<{
          class_id: string;
          starts_on: string;
          ends_on: string;
        }>(
          `SELECT sec.class_id,y.starts_on::text,y.ends_on::text FROM sections sec JOIN academic_years y ON y.id=sec.academic_year_id AND y.school_id=sec.school_id WHERE sec.school_id=$1 AND sec.id=$2 AND sec.academic_year_id=$3 AND y.status='active'`,
          [schoolId, input.sectionId, row.academic_year_id],
        );
        if (!section.rows[0])
          throw notFound("Active section for this academic year not found");
        if (
          input.startsOn < section.rows[0].starts_on ||
          input.startsOn > section.rows[0].ends_on
        )
          throw badRequest(
            "Readmission date must fall in the active academic year",
          );
        const old = await client.query<{ ends_on: string }>(
          `SELECT ends_on::text FROM enrollments WHERE school_id=$1 AND id=$2`,
          [schoolId, row.enrollment_id],
        );
        if (input.startsOn < old.rows[0]!.ends_on)
          throw badRequest("Readmission cannot precede withdrawal");
        const active = await client.query(
          `SELECT 1 FROM enrollments WHERE school_id=$1 AND student_id=$2 AND enrollment_status='active'`,
          [schoolId, row.student_id],
        );
        if (active.rowCount)
          throw conflict("The student already has an active enrollment");
        await client.query(
          `INSERT INTO enrollments(school_id,student_id,academic_year_id,class_id,section_id,enrollment_status,starts_on) VALUES($1,$2,$3,$4,$5,'active',$6)`,
          [
            schoolId,
            row.student_id,
            row.academic_year_id,
            section.rows[0].class_id,
            input.sectionId,
            input.startsOn,
          ],
        );
        await client.query(
          `UPDATE students SET status='active' WHERE school_id=$1 AND id=$2`,
          [schoolId, row.student_id],
        );
        await client.query(
          `UPDATE student_lifecycle_reviews SET status='readmitted',readmitted_by=$3,readmitted_at=now(),readmission_note=$4 WHERE school_id=$1 AND id=$2`,
          [schoolId, id, request.user!.id, input.note],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "students.readmitted",
          entityType: "student_lifecycle_review",
          entityId: id,
          outcome: "success",
          after: { sectionId: input.sectionId },
          ...requestMeta(request),
        });
        return { id, status: "readmitted", studentId: row.student_id };
      });
    },
  );
}
