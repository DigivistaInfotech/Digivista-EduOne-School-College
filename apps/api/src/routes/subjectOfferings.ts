import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { visibleSectionIds } from "@erp/core";
import { getActor, requirePermission, requestMeta } from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { recordAudit } from "../lib/audit";
import { badRequest, forbidden, notFound, parseInput } from "../lib/errors";

const schoolParams = z.object({ schoolId: z.string().uuid() });
export async function registerSubjectOfferingRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/subject-offerings",
    { preHandler: requirePermission("academic.structure.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const db = getPool();
      const [years, classes, items] = await Promise.all([
        db.query(
          `SELECT id,name,status FROM academic_years WHERE school_id=$1 ORDER BY starts_on DESC`,
          [schoolId],
        ),
        db.query(
          `SELECT id,name,grade_order AS "gradeOrder",status FROM classes WHERE school_id=$1 ORDER BY grade_order,name`,
          [schoolId],
        ),
        db.query(
          `SELECT academic_year_id AS "academicYearId",subject_id AS "subjectId",class_id AS "classId" FROM subject_class_offerings WHERE school_id=$1`,
          [schoolId],
        ),
      ]);
      return { years: years.rows, classes: classes.rows, items: items.rows };
    },
  );
  app.put(
    "/api/schools/:schoolId/subjects/:id/class-offerings",
    { preHandler: requirePermission("academic.subject.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(
        schoolParams.extend({ id: z.string().uuid() }),
        request.params,
      );
      const input = parseInput(
        z.object({
          academicYearId: z.string().uuid(),
          classIds: z
            .array(z.string().uuid())
            .max(1000)
            .refine(
              (ids) => new Set(ids).size === ids.length,
              "Duplicate classes are not allowed",
            ),
        }),
        request.body,
      );
      const actor = getActor(request);
      if (visibleSectionIds(actor, "academic.subject.manage") !== null)
        throw forbidden("School-wide subject administration is required");
      return withTransaction(async (db) => {
        if (
          !(
            await db.query(
              "SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2 FOR UPDATE",
              [schoolId, id],
            )
          ).rowCount
        )
          throw notFound("Subject not found");
        const year = (
          await db.query(
            "SELECT status FROM academic_years WHERE school_id=$1 AND id=$2 FOR UPDATE",
            [schoolId, input.academicYearId],
          )
        ).rows[0];
        if (!year) throw notFound("Academic year not found");
        if (year.status === "archived")
          throw badRequest("Archived academic years are read-only");
        const before = (
          await db.query(
            `SELECT class_id AS "classId" FROM subject_class_offerings WHERE school_id=$1 AND academic_year_id=$2 AND subject_id=$3 ORDER BY class_id`,
            [schoolId, input.academicYearId, id],
          )
        ).rows;
        const existing = new Set(before.map((r) => r.classId));
        const classes = (
          await db.query(
            "SELECT id,status FROM classes WHERE school_id=$1 AND id=ANY($2::uuid[])",
            [schoolId, input.classIds],
          )
        ).rows;
        if (classes.length !== input.classIds.length)
          throw notFound("Class not found");
        if (classes.some((c) => c.status !== "active" && !existing.has(c.id)))
          throw badRequest("New offerings require active classes");
        await db.query(
          "DELETE FROM subject_class_offerings WHERE school_id=$1 AND academic_year_id=$2 AND subject_id=$3",
          [schoolId, input.academicYearId, id],
        );
        for (const classId of input.classIds)
          await db.query(
            "INSERT INTO subject_class_offerings(school_id,academic_year_id,subject_id,class_id,updated_by) VALUES($1,$2,$3,$4,$5)",
            [schoolId, input.academicYearId, id, classId, actor.userId],
          );
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "subject.offerings.updated",
          entityType: "subject",
          entityId: id,
          outcome: "success",
          before: {
            academicYearId: input.academicYearId,
            classIds: before.map((r) => r.classId),
          },
          after: input,
          ...requestMeta(request),
        });
        return { subjectId: id, ...input };
      });
    },
  );
}
