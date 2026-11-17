import {
  enrichmentQuestionInput,
  paperBlueprintInput,
  uuid,
  type EnrichmentQuestion,
  type GeneratedPaper,
  type PaperQuestion,
} from "@erp/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getActor, requirePermission, requestMeta } from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { recordAudit } from "../lib/audit";
import { badRequest, notFound, parseInput } from "../lib/errors";
import {
  assertEnrichmentGrade,
  enrichmentGrades,
  escapeHtml,
} from "../lib/enrichment";
import { todayInTimeZone } from "../lib/format";
import { buildPaperVariants } from "../lib/paperBuilder";

const schoolParams = z.object({ schoolId: uuid });
const idParams = schoolParams.extend({ id: uuid });
const questionQuery = z.object({
  grade: z.coerce.number().int().min(1).max(12).optional(),
  subject: z.string().trim().max(100).optional(),
  kind: z.enum(["objective", "short", "long", "very_long"]).optional(),
  language: z.enum(["en", "hi"]).optional(),
});
const questionSelect = `SELECT id,grade,subject,chapter,topic,kind,question,answer,options,difficulty,
  source_title AS "sourceTitle",source_url AS "sourceUrl",as_of::text AS "asOf",current_affairs AS "currentAffairs",
  language,status,reviewed_at::text AS "reviewedAt" FROM enrichment_questions`;
const paperSelect = `SELECT id,title,grade,subject,language,variant,total_marks AS "totalMarks",duration_minutes AS "durationMinutes",questions FROM generated_question_papers`;

export async function registerDiscoveryRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/discovery/questions",
    { preHandler: requirePermission("learning.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const query = parseInput(questionQuery, request.query);
      const grades = await enrichmentGrades(request);
      const grade = query.grade ?? grades[0];
      if (grade !== undefined) await assertEnrichmentGrade(request, grade);
      const staff = getActor(request).permissions.has("learning.manage");
      if (grade === undefined) return { grades, staff, items: [] };
      const today = todayInTimeZone(getActor(request).school.timezone);
      const { rows } = await getPool().query<EnrichmentQuestion>(
        `${questionSelect} WHERE school_id=$1 AND grade=$2
      AND ($3::text IS NULL OR lower(subject)=lower($3)) AND ($4::text IS NULL OR kind=$4)
      AND ($5::text IS NULL OR language=$5)
      AND ($6::boolean OR (status='published' AND (NOT current_affairs OR as_of BETWEEN $7::date-30 AND $7::date)))
      ORDER BY current_affairs DESC,as_of DESC NULLS LAST,created_at DESC LIMIT 200`,
        [
          schoolId,
          grade,
          query.subject ?? null,
          query.kind ?? null,
          query.language ?? null,
          staff,
          today,
        ],
      );
      return {
        grades,
        staff,
        items: rows.map((row) => {
          if (staff) return row;
          const { answer: _answer, status: _status, ...safe } = row;
          return safe;
        }),
      };
    },
  );
  app.post(
    "/api/schools/:schoolId/discovery/questions",
    { preHandler: requirePermission("learning.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(enrichmentQuestionInput, request.body);
      await assertEnrichmentGrade(request, input.grade);
      if (input.status !== "draft")
        throw badRequest("Save a draft first, then review and publish it");
      if (
        input.asOf &&
        input.asOf > todayInTimeZone(getActor(request).school.timezone)
      )
        throw badRequest("A source date cannot be in the future");
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO enrichment_questions(school_id,grade,subject,chapter,topic,kind,question,answer,options,difficulty,source_title,source_url,as_of,current_affairs,language,status,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16) RETURNING id`,
          [
            schoolId,
            input.grade,
            input.subject,
            input.chapter,
            input.topic,
            input.kind,
            input.question,
            input.answer,
            JSON.stringify(input.options),
            input.difficulty,
            input.sourceTitle,
            input.sourceUrl,
            input.asOf,
            input.currentAffairs,
            input.language,
            request.user!.id,
          ],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "discovery.question_created",
          entityType: "enrichment_question",
          entityId: rows[0]!.id,
          outcome: "success",
          ...requestMeta(request),
        });
        return rows[0]!;
      });
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/api/schools/:schoolId/discovery/questions/:id/publish",
    { preHandler: requirePermission("learning.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      return withTransaction(async (client) => {
        const { rows } = await client.query<EnrichmentQuestion>(
          `${questionSelect} WHERE school_id=$1 AND id=$2 FOR UPDATE`,
          [schoolId, id],
        );
        const question = rows[0];
        if (!question) throw notFound("Question not found");
        await assertEnrichmentGrade(request, question.grade);
        if (
          question.currentAffairs &&
          question.asOf &&
          question.asOf > todayInTimeZone(getActor(request).school.timezone)
        )
          throw badRequest("A source date cannot be in the future");
        if (question.status === "published") return { id, status: "published" };
        await client.query(
          `UPDATE enrichment_questions SET status='published',reviewed_by=$3,reviewed_at=now() WHERE school_id=$1 AND id=$2`,
          [schoolId, id, request.user!.id],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "discovery.question_published",
          entityType: "enrichment_question",
          entityId: id,
          outcome: "success",
          ...requestMeta(request),
        });
        return { id, status: "published" };
      });
    },
  );
  app.post(
    "/api/schools/:schoolId/discovery/questions/:id/practice",
    { preHandler: requirePermission("learning.view") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const { response } = parseInput(
        z.object({ response: z.string().trim().min(1).max(20000) }),
        request.body,
      );
      const today = todayInTimeZone(getActor(request).school.timezone);
      const { rows } = await getPool().query<EnrichmentQuestion>(
        `${questionSelect} WHERE school_id=$1 AND id=$2 AND status='published'
      AND (NOT current_affairs OR as_of BETWEEN $3::date-30 AND $3::date)`,
        [schoolId, id, today],
      );
      const question = rows[0];
      if (!question) throw notFound("Published question not found");
      await assertEnrichmentGrade(request, question.grade);
      if (question.kind === "objective" && !question.options.includes(response))
        throw badRequest("Choose one of the listed options");
      const correct =
        question.kind === "objective" ? response === question.answer : null;
      await getPool().query(
        `INSERT INTO learning_practice_attempts(school_id,question_id,user_id,response,correct) VALUES($1,$2,$3,$4,$5)`,
        [schoolId, id, request.user!.id, response, correct],
      );
      return {
        correct,
        modelAnswer: question.answer,
        feedback:
          correct === null
            ? "Compare your answer with this model answer. Descriptive answers are not automatically graded."
            : correct
              ? "Correct answer."
              : "Review the explanation and try again.",
      };
    },
  );
  app.get(
    "/api/schools/:schoolId/discovery/papers",
    { preHandler: requirePermission("learning.manage") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const grades = await enrichmentGrades(request);
      const { rows } = await getPool().query<GeneratedPaper>(
        `${paperSelect} WHERE school_id=$1 AND grade=ANY($2::int[]) ORDER BY created_at DESC LIMIT 100`,
        [schoolId, grades],
      );
      return { grades, items: rows };
    },
  );
  app.post(
    "/api/schools/:schoolId/discovery/papers",
    { preHandler: requirePermission("learning.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(paperBlueprintInput, request.body);
      await assertEnrichmentGrade(request, input.grade);
      const today = todayInTimeZone(getActor(request).school.timezone);
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query<EnrichmentQuestion>(
          `${questionSelect} WHERE school_id=$1 AND grade=$2 AND lower(subject)=lower($3) AND language=$4
        AND status='published' AND (cardinality($5::text[])=0 OR chapter=ANY($5::text[]))
        AND (NOT current_affairs OR as_of BETWEEN $6::date-30 AND $6::date) ORDER BY id`,
          [
            schoolId,
            input.grade,
            input.subject,
            input.language,
            input.chapters,
            today,
          ],
        );
        const variants = buildPaperVariants(input, rows);
        const papers: GeneratedPaper[] = [];
        for (let index = 0; index < variants.length; index++) {
          const questions = variants[index]!;
          const total = questions.reduce(
            (sum, question) => sum + question.marks,
            0,
          );
          const { rows: created } = await client.query<GeneratedPaper>(
            `INSERT INTO generated_question_papers(school_id,title,grade,subject,language,variant,total_marks,duration_minutes,blueprint,questions,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,title,grade,subject,language,variant,total_marks AS "totalMarks",duration_minutes AS "durationMinutes",questions`,
            [
              schoolId,
              input.title,
              input.grade,
              input.subject,
              input.language,
              String.fromCharCode(65 + index),
              total,
              input.durationMinutes,
              JSON.stringify(input),
              JSON.stringify(questions),
              request.user!.id,
            ],
          );
          const paper = created[0]!;
          papers.push(paper);
          await recordAudit(client, {
            schoolId,
            actorUserId: request.user!.id,
            action: "discovery.paper_generated",
            entityType: "generated_question_paper",
            entityId: paper.id,
            outcome: "success",
            after: {
              grade: input.grade,
              questionCount: questions.length,
              variant: paper.variant,
            },
            ...requestMeta(request),
          });
        }
        return { items: papers };
      });
      return reply.code(201).send(result);
    },
  );
  app.get(
    "/api/schools/:schoolId/discovery/papers/:id/print",
    { preHandler: requirePermission("learning.manage") },
    async (request, reply) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const { answers } = parseInput(
        z.object({ answers: z.enum(["true", "false"]).default("false") }),
        request.query,
      );
      const { rows } = await getPool().query<GeneratedPaper>(
        `${paperSelect} WHERE school_id=$1 AND id=$2`,
        [schoolId, id],
      );
      const paper = rows[0];
      if (!paper) throw notFound("Paper not found");
      await assertEnrichmentGrade(request, paper.grade);
      const groups = ["objective", "short", "long", "very_long"] as const;
      let number = 0;
      const content = groups
        .map((kind) => {
          const questions = paper.questions.filter(
            (question) => question.kind === kind,
          );
          if (!questions.length) return "";
          return (
            `<h2>${escapeHtml(kind.replaceAll("_", " ").toUpperCase())}</h2>` +
            questions
              .map((question: PaperQuestion) => {
                number++;
                return `<article><p><b>${number}.</b> ${escapeHtml(question.question)} <span class="marks">[${question.marks}]</span></p>${question.options.length ? `<ol type="A">${question.options.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ol>` : ""}${answers === "true" ? `<p class="answer">Answer: ${escapeHtml(question.answer)}</p><small>Source: ${escapeHtml(question.sourceTitle)} · ${escapeHtml(question.chapter)}</small>` : ""}</article>`;
              })
              .join("")
          );
        })
        .join("");
      return reply
        .header("cache-control", "private, no-store")
        .header("content-type", "text/html; charset=utf-8")
        .send(`<!doctype html><html lang="${paper.language}"><meta charset="utf-8"><title>${escapeHtml(paper.title)}</title><style>body{font:16px Arial,sans-serif;max-width:850px;margin:40px auto;line-height:1.7;color:#182944}header{text-align:center;border-bottom:2px solid #182944}h2{font-size:18px;margin-top:30px}article{break-inside:avoid;white-space:pre-wrap}.marks{float:right}.answer{background:#eef8f2;padding:12px}small{color:#555}@media print{button{display:none}body{margin:15mm}}</style>
      <header><h1>${escapeHtml(getActor(request).school.name)}</h1><h2>${escapeHtml(paper.title)} — Set ${paper.variant}${answers === "true" ? " — ANSWER KEY" : ""}</h2><p>Class ${paper.grade} · ${escapeHtml(paper.subject)} · ${paper.totalMarks} marks · ${paper.durationMinutes} minutes</p></header><p>Teacher review required before use.</p>${content}<button onclick="window.print()">Print</button></html>`);
    },
  );
}
