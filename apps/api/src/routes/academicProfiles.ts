import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { canAccessSection, visibleSectionIds } from "@erp/core";
import { getActor, requirePermission, requestMeta } from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { recordAudit } from "../lib/audit";
import { badRequest, notFound, parseInput } from "../lib/errors";
import { todayInTimeZone } from "../lib/format";
const school = z.object({ schoolId: z.string().uuid() });
const record = school.extend({ id: z.string().uuid() });
const optionalId = z.string().uuid().nullable().default(null);
const classProfile = z.object({
  stageId: optionalId,
  mediumId: optionalId,
  stream: z.string().trim().max(120).default(""),
  coordinatorUserId: optionalId,
  nextClassId: optionalId,
});
const sectionProfile = z
  .object({
    classTeacherUserId: optionalId,
    coTeacherUserId: optionalId,
    roomId: optionalId,
    shiftId: optionalId,
    mediumId: optionalId,
    stream: z.string().trim().max(120).default(""),
    nextSectionId: optionalId,
  })
  .refine(
    (v) => !v.classTeacherUserId || v.classTeacherUserId !== v.coTeacherUserId,
    {
      message: "Class teacher and co-teacher must be different",
      path: ["coTeacherUserId"],
    },
  );
const termInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  sequenceNo: z.number().int().min(1).max(100),
});
const holidayInput = z.object({
  name: z.string().trim().min(1).max(120),
  holidayOn: z.string().date(),
  notes: z.string().trim().max(1000).default(""),
});
type DB = pg.Pool | pg.PoolClient;
async function year(db: DB, schoolId: string, id: string, write = false) {
  const row = (
    await db.query<{
      id: string;
      name: string;
      startsOn: string;
      endsOn: string;
      status: string;
    }>(
      `SELECT id,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status FROM academic_years WHERE school_id=$1 AND id=$2 ${write ? "FOR UPDATE" : ""}`,
      [schoolId, id],
    )
  ).rows[0];
  if (!row) throw notFound("Academic year not found");
  if (write && row.status === "archived")
    throw badRequest("Archived year plans are read-only");
  return row;
}
async function master(
  db: DB,
  schoolId: string,
  id: string | null,
  kind: string,
  existing?: string | null,
) {
  if (!id) return;
  const found = await db.query(
    "SELECT 1 FROM institution_masters WHERE school_id=$1 AND id=$2 AND kind=$3 AND (active OR id=$4)",
    [schoolId, id, kind, existing ?? null],
  );
  if (!found.rowCount)
    throw badRequest("Choose an active master from this institution", {
      [kind]: ["Invalid master selection"],
    });
}
async function staff(
  db: DB,
  schoolId: string,
  id: string | null,
  teacher = false,
) {
  if (!id) return;
  const found = await db.query(
    `SELECT 1 FROM staff st JOIN users u ON u.id=st.user_id WHERE st.school_id=$1 AND st.user_id=$2 AND st.status='active' AND u.status='active' AND EXISTS(SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.school_id=$1 AND a.user_id=u.id AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now()) AND (NOT $3 OR r.code='teacher'))`,
    [schoolId, id, teacher],
  );
  if (!found.rowCount)
    throw badRequest(
      teacher
        ? "Choose an active teacher account in this institution"
        : "Choose an active staff account in this institution",
    );
}
export async function registerAcademicProfileRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/academic/profile-lookups",
    { preHandler: requirePermission("academic.structure.view") },
    async (req) => {
      const { schoolId } = parseInput(school, req.params);
      const scope = visibleSectionIds(getActor(req), "academic.structure.view");
      const masters = (
        await getPool().query(
          `SELECT id,kind,label,active FROM institution_masters WHERE school_id=$1 AND kind IN('academic_stage','language_medium','academic_shift') ORDER BY kind,label`,
          [schoolId],
        )
      ).rows;
      const people = (
        await getPool().query(
          `SELECT st.user_id AS id,concat_ws(' ',st.first_name,st.last_name)||' · '||st.employee_number AS name,EXISTS(SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id=a.role_id WHERE a.user_id=st.user_id AND a.school_id=$1 AND r.code='teacher' AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_to IS NULL OR a.valid_to>now())) AS "isTeacher" FROM staff st JOIN users u ON u.id=st.user_id AND u.status='active' WHERE st.school_id=$1 AND st.status='active' AND EXISTS(SELECT 1 FROM user_role_assignments active_role WHERE active_role.school_id=$1 AND active_role.user_id=st.user_id AND active_role.revoked_at IS NULL AND active_role.valid_from<=now() AND (active_role.valid_to IS NULL OR active_role.valid_to>now())) ORDER BY st.first_name,st.last_name`,
          [schoolId],
        )
      ).rows;
      const rooms = (
        await getPool().query(
          `SELECT id,name FROM rooms WHERE school_id=$1 AND status='active' ORDER BY name`,
          [schoolId],
        )
      ).rows;
      const classes = (
        await getPool().query(
          `SELECT id,name,status FROM classes WHERE school_id=$1 ORDER BY grade_order,name`,
          [schoolId],
        )
      ).rows;
      const sections = (
        await getPool().query(
          `SELECT s.id,s.class_id AS "classId",s.academic_year_id AS "academicYearId",c.name||' · '||s.name||' · '||y.name AS name,y.starts_on::text AS "yearStartsOn",y.ends_on::text AS "yearEndsOn",s.status FROM sections s JOIN classes c ON c.school_id=s.school_id AND c.id=s.class_id JOIN academic_years y ON y.school_id=s.school_id AND y.id=s.academic_year_id WHERE s.school_id=$1 AND ($2::uuid[] IS NULL OR s.id=ANY($2::uuid[])) ORDER BY y.starts_on,c.grade_order,s.name`,
          [schoolId, scope],
        )
      ).rows;
      return { masters, people, rooms, classes, sections };
    },
  );
  app.get(
    "/api/schools/:schoolId/classes/:id/profile",
    { preHandler: requirePermission("academic.structure.view") },
    async (req) => {
      const { schoolId, id } = parseInput(record, req.params);
      const row = (
        await getPool().query(
          `SELECT c.id,c.name,p.stage_id AS "stageId",p.medium_id AS "mediumId",coalesce(p.stream,'') AS stream,p.coordinator_user_id AS "coordinatorUserId",p.next_class_id AS "nextClassId",(SELECT count(*)::int FROM sections s WHERE s.school_id=c.school_id AND s.class_id=c.id AND s.status='active') AS "activeSectionCount" FROM classes c LEFT JOIN academic_class_profiles p ON p.school_id=c.school_id AND p.class_id=c.id WHERE c.school_id=$1 AND c.id=$2`,
          [schoolId, id],
        )
      ).rows[0];
      if (!row) throw notFound("Class not found");
      const capacitySummary = (
        await getPool().query(
          `SELECT y.id AS "academicYearId",y.name AS "academicYearName",count(s.id)::int AS "sectionCount",CASE WHEN bool_and(s.capacity IS NOT NULL) THEN sum(s.capacity)::int ELSE NULL END AS "totalCapacity",coalesce(sum((SELECT count(*) FROM enrollments e WHERE e.school_id=s.school_id AND e.section_id=s.id AND e.academic_year_id=s.academic_year_id AND e.enrollment_status='active')),0)::int AS enrolled FROM sections s JOIN academic_years y ON y.school_id=s.school_id AND y.id=s.academic_year_id WHERE s.school_id=$1 AND s.class_id=$2 AND s.status='active' GROUP BY y.id,y.name,y.starts_on ORDER BY y.starts_on DESC`,
          [schoolId, id],
        )
      ).rows;
      const actor = getActor(req);
      const scope = visibleSectionIds(actor, "academic.class.manage");
      const canEdit =
        actor.permissions.has("academic.class.manage") &&
        (scope === null ||
          actor.assignments.some(
            (a) =>
              a.scopeType === "class" &&
              a.scopeId === id &&
              (!a.permissions ||
                a.permissions.includes("academic.class.manage")),
          ) ||
          !!(
            await getPool().query(
              "SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=ANY($3::uuid[]) LIMIT 1",
              [schoolId, id, scope],
            )
          ).rowCount);
      return { ...row, capacitySummary, canEdit };
    },
  );
  app.put(
    "/api/schools/:schoolId/classes/:id/profile",
    { preHandler: requirePermission("academic.class.manage") },
    async (req) => {
      const { schoolId, id } = parseInput(record, req.params);
      const value = parseInput(classProfile, req.body);
      const actor = getActor(req);
      const allowedSections = visibleSectionIds(actor, "academic.class.manage");
      if (
        allowedSections !== null &&
        !actor.assignments.some(
          (a) =>
            a.scopeType === "class" &&
            a.scopeId === id &&
            (!a.permissions || a.permissions.includes("academic.class.manage")),
        ) &&
        !(
          await getPool().query(
            "SELECT 1 FROM sections WHERE school_id=$1 AND class_id=$2 AND id=ANY($3::uuid[]) LIMIT 1",
            [schoolId, id, allowedSections],
          )
        ).rowCount
      )
        throw notFound("Class not found in your assigned scope");

      return withTransaction(async (db) => {
        await db.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
          schoolId,
        ]);
        if (
          !(
            await db.query(
              "SELECT 1 FROM classes WHERE school_id=$1 AND id=$2",
              [schoolId, id],
            )
          ).rowCount
        )
          throw notFound("Class not found");
        const old = (
          await db.query(
            "SELECT * FROM academic_class_profiles WHERE school_id=$1 AND class_id=$2",
            [schoolId, id],
          )
        ).rows[0];
        await master(
          db,
          schoolId,
          value.stageId,
          "academic_stage",
          old?.stage_id,
        );
        await master(
          db,
          schoolId,
          value.mediumId,
          "language_medium",
          old?.medium_id,
        );
        await staff(db, schoolId, value.coordinatorUserId);
        if (value.nextClassId) {
          if (
            !(
              await db.query(
                `SELECT 1 FROM classes WHERE school_id=$1 AND id=$2 AND status='active'`,
                [schoolId, value.nextClassId],
              )
            ).rowCount
          )
            throw notFound("Next class not found");
          const seen = new Set([id]);
          let next: string | null = value.nextClassId;
          while (next) {
            if (seen.has(next))
              throw badRequest("Promotion mapping must not form a cycle");
            seen.add(next);
            if (seen.size > 1000)
              throw badRequest("Promotion mapping is too long");
            next =
              (
                await db.query<{ next_class_id: string | null }>(
                  "SELECT next_class_id FROM academic_class_profiles WHERE school_id=$1 AND class_id=$2",
                  [schoolId, next],
                )
              ).rows[0]?.next_class_id ?? null;
          }
        }
        await db.query(
          `INSERT INTO academic_class_profiles(school_id,class_id,stage_id,medium_id,stream,coordinator_user_id,next_class_id,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(school_id,class_id) DO UPDATE SET stage_id=excluded.stage_id,medium_id=excluded.medium_id,stream=excluded.stream,coordinator_user_id=excluded.coordinator_user_id,next_class_id=excluded.next_class_id,updated_by=excluded.updated_by,updated_at=now()`,
          [
            schoolId,
            id,
            value.stageId,
            value.mediumId,
            value.stream,
            value.coordinatorUserId,
            value.nextClassId,
            actor.userId,
          ],
        );
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "academic.class_profile_updated",
          entityType: "class",
          entityId: id,
          outcome: "success",
          before: old,
          after: value,
          ...requestMeta(req),
        });
        return { id };
      });
    },
  );
  app.get(
    "/api/schools/:schoolId/sections/:id/profile",
    { preHandler: requirePermission("academic.structure.view") },
    async (req) => {
      const { schoolId, id } = parseInput(record, req.params);
      const actor = getActor(req);
      if (!canAccessSection(actor, id, "academic.structure.view"))
        throw notFound("Section not found");
      const row = (
        await getPool().query(
          `SELECT s.id,s.class_id AS "classId",s.academic_year_id AS "academicYearId",s.capacity,y.starts_on::text AS "yearStartsOn",y.ends_on::text AS "yearEndsOn",p.class_teacher_user_id AS "classTeacherUserId",p.co_teacher_user_id AS "coTeacherUserId",p.room_id AS "roomId",p.shift_id AS "shiftId",p.medium_id AS "mediumId",coalesce(p.stream,'') AS stream,p.next_section_id AS "nextSectionId",(SELECT count(*)::int FROM enrollments e WHERE e.school_id=s.school_id AND e.section_id=s.id AND e.academic_year_id=s.academic_year_id AND e.enrollment_status='active') AS enrolled,(SELECT count(DISTINCT ta.subject_id)::int FROM teaching_assignments ta WHERE ta.school_id=s.school_id AND ta.section_id=s.id AND ta.academic_year_id=s.academic_year_id AND ta.valid_from<=$3::date AND (ta.valid_to IS NULL OR ta.valid_to>=$3::date)) AS "assignedSubjectCount" FROM sections s JOIN academic_years y ON y.school_id=s.school_id AND y.id=s.academic_year_id LEFT JOIN academic_section_profiles p ON p.school_id=s.school_id AND p.section_id=s.id WHERE s.school_id=$1 AND s.id=$2`,
          [schoolId, id, todayInTimeZone(actor.school.timezone)],
        )
      ).rows[0];
      if (!row) throw notFound("Section not found");
      return {
        ...row,
        canEdit:canAccessSection(actor,id,"academic.section.manage"),
        availableSeats:
          row.capacity === null
            ? null
            : Math.max(0, row.capacity - row.enrolled),
        overCapacity: row.capacity !== null && row.enrolled > row.capacity,
      };
    },
  );
  app.put(
    "/api/schools/:schoolId/sections/:id/profile",
    { preHandler: requirePermission("academic.section.manage") },
    async (req) => {
      const { schoolId, id } = parseInput(record, req.params);
      const actor = getActor(req);
      if (!canAccessSection(actor, id, "academic.section.manage"))
        throw notFound("Section not found");
      const value = parseInput(sectionProfile, req.body);
      return withTransaction(async (db) => {
        await db.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
          schoolId,
        ]);
        const section = (
          await db.query<{
            academic_year_id: string;
            ends_on: string;
            class_id: string;
          }>(
            `SELECT s.academic_year_id,s.class_id,y.ends_on::text FROM sections s JOIN academic_years y ON y.school_id=s.school_id AND y.id=s.academic_year_id WHERE s.school_id=$1 AND s.id=$2`,
            [schoolId, id],
          )
        ).rows[0];
        if (!section) throw notFound("Section not found");
        const old = (
          await db.query(
            "SELECT * FROM academic_section_profiles WHERE school_id=$1 AND section_id=$2",
            [schoolId, id],
          )
        ).rows[0];
        await staff(db, schoolId, value.classTeacherUserId, true);
        await staff(db, schoolId, value.coTeacherUserId, true);
        await master(
          db,
          schoolId,
          value.shiftId,
          "academic_shift",
          old?.shift_id,
        );
        await master(
          db,
          schoolId,
          value.mediumId,
          "language_medium",
          old?.medium_id,
        );
        if (
          value.roomId &&
          !(
            await db.query(
              `SELECT 1 FROM rooms WHERE school_id=$1 AND id=$2 AND (status='active' OR id=$3)`,
              [schoolId, value.roomId, old?.room_id ?? null],
            )
          ).rowCount
        )
          throw notFound("Room not found");
        if (value.nextSectionId) {
          const target = (
            await db.query<{ class_id: string }>(
              `SELECT s.class_id FROM sections s JOIN academic_years y ON y.school_id=s.school_id AND y.id=s.academic_year_id WHERE s.school_id=$1 AND s.id=$2 AND s.status='active' AND y.starts_on>$3::date`,
              [schoolId, value.nextSectionId, section.ends_on],
            )
          ).rows[0];
          if (
            !target ||
            !canAccessSection(
              actor,
              value.nextSectionId,
              "academic.section.manage",
            )
          )
            throw badRequest(
              "Choose an accessible section in a later academic year",
            );
          const promotion = (
            await db.query<{ next_class_id: string | null }>(
              "SELECT next_class_id FROM academic_class_profiles WHERE school_id=$1 AND class_id=$2",
              [schoolId, section.class_id],
            )
          ).rows[0];
          if (
            promotion?.next_class_id &&
            promotion.next_class_id !== target.class_id
          )
            throw badRequest(
              "Next section must match the configured next class",
            );
        }
        await db.query(
          `INSERT INTO academic_section_profiles(school_id,section_id,class_teacher_user_id,co_teacher_user_id,room_id,shift_id,medium_id,stream,next_section_id,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(school_id,section_id) DO UPDATE SET class_teacher_user_id=excluded.class_teacher_user_id,co_teacher_user_id=excluded.co_teacher_user_id,room_id=excluded.room_id,shift_id=excluded.shift_id,medium_id=excluded.medium_id,stream=excluded.stream,next_section_id=excluded.next_section_id,updated_by=excluded.updated_by,updated_at=now()`,
          [
            schoolId,
            id,
            value.classTeacherUserId,
            value.coTeacherUserId,
            value.roomId,
            value.shiftId,
            value.mediumId,
            value.stream,
            value.nextSectionId,
            actor.userId,
          ],
        );
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "academic.section_profile_updated",
          entityType: "section",
          entityId: id,
          outcome: "success",
          before: old,
          after: value,
          ...requestMeta(req),
        });
        return { id };
      });
    },
  );
  app.get(
    "/api/schools/:schoolId/academic-years/:id/plan",
    { preHandler: requirePermission("academic.structure.view") },
    async (req) => {
      const { schoolId, id } = parseInput(record, req.params);
      const actor = getActor(req);
      const selected = await year(getPool(), schoolId, id);
      const terms = (
        await getPool().query(
          `SELECT id,code,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",sequence_no AS "sequenceNo" FROM terms WHERE school_id=$1 AND academic_year_id=$2 ORDER BY sequence_no`,
          [schoolId, id],
        )
      ).rows;
      const holidays = (
        await getPool().query(
          `SELECT id,name,holiday_on::text AS "holidayOn",notes,academic_year_id AS "academicYearId" FROM holidays WHERE school_id=$1 AND holiday_on BETWEEN $3::date AND $4::date AND (academic_year_id=$2 OR academic_year_id IS NULL) ORDER BY holiday_on,name`,
          [schoolId, id, selected.startsOn, selected.endsOn],
        )
      ).rows;
      const readiness: Array<{ label: string; count: number | null }> = [];
      if (
        actor.permissions.has("academic.year.manage") &&
        visibleSectionIds(actor, "academic.year.manage") === null
      ) {
        const count = async (label: string, sql: string, allowed = true) => {
          readiness.push({
            label,
            count: allowed
              ? Number(
                  (
                    await getPool().query<{ count: string }>(sql, [
                      schoolId,
                      id,
                    ])
                  ).rows[0]?.count ?? 0,
                )
              : null,
          });
        };
        await count(
          "Active enrollments to review for continuation / promotion",
          `SELECT count(*)::text FROM enrollments WHERE school_id=$1 AND academic_year_id=$2 AND enrollment_status='active'`,
        );
        await count(
          "Draft examinations not published",
          `SELECT count(*)::text FROM exams WHERE school_id=$1 AND academic_year_id=$2 AND status='draft'`,
          actor.permissions.has("exams.view"),
        );
        await count(
          "Pending attendance corrections",
          `SELECT count(*)::text FROM attendance_corrections ac JOIN student_attendance a ON a.school_id=ac.school_id AND a.id=ac.attendance_id JOIN enrollments e ON e.school_id=a.school_id AND e.id=a.enrollment_id WHERE ac.school_id=$1 AND e.academic_year_id=$2 AND ac.status='pending'`,
          actor.permissions.has("attendance.register.view"),
        );
        await count(
          "Pending offline collection acknowledgements in this year",
          `SELECT count(*)::text FROM fee_offline_payment_acknowledgements a JOIN academic_years y ON y.school_id=a.school_id AND y.id=$2 WHERE a.school_id=$1 AND a.payment_date BETWEEN y.starts_on AND y.ends_on AND a.status IN('pending','under_review','more_info_needed','unmatched')`,
          actor.permissions.has("fees.view"),
        );
        await count(
          "Open issued purchase orders in this year",
          `SELECT count(*)::text FROM purchase_orders po JOIN academic_years y ON y.school_id=po.school_id AND y.id=$2 WHERE po.school_id=$1 AND po.order_date BETWEEN y.starts_on AND y.ends_on AND po.status IN('issued','partially_received')`,
          actor.permissions.has("procurement.view"),
        );
      }
      return {
        year: selected,
        canManageYearPlan:
          actor.permissions.has("academic.year.manage") &&
          visibleSectionIds(actor, "academic.year.manage") === null &&
          selected.status !== "archived",
        terms,
        holidays,
        readiness,
        readinessNote:
          "Read-only checklist counts. This does not promote students, close records, waive dues or certify that year-end checks are complete.",
      };
    },
  );
  for (const update of [false, true]) {
    app.route({
      method: update ? "PUT" : "POST",
      url: update
        ? "/api/schools/:schoolId/academic-years/:id/terms/:termId"
        : "/api/schools/:schoolId/academic-years/:id/terms",
      preHandler: requirePermission("academic.year.manage"),
      handler: async (req, reply) => {
        const { schoolId, id, termId } = parseInput(
          record.extend({ termId: z.string().uuid().optional() }),
          req.params,
        );
        const value = parseInput(termInput, req.body);
        const actor = getActor(req);
        if (visibleSectionIds(actor, "academic.year.manage") !== null)
          throw notFound(
            "Academic year management requires institution-wide scope",
          );
        const saved = await withTransaction(async (db) => {
          const y = await year(db, schoolId, id, true);
          if (
            value.startsOn > value.endsOn ||
            value.startsOn < y.startsOn ||
            value.endsOn > y.endsOn
          )
            throw badRequest(
              "Term dates must be ordered and inside the academic year",
            );
          if (
            update &&
            !(
              await db.query(
                "SELECT 1 FROM terms WHERE school_id=$1 AND academic_year_id=$2 AND id=$3",
                [schoolId, id, termId],
              )
            ).rowCount
          )
            throw notFound("Term not found");
          if (
            (
              await db.query(
                "SELECT 1 FROM terms WHERE school_id=$1 AND academic_year_id=$2 AND ($3::uuid IS NULL OR id<>$3) AND starts_on<=$5::date AND ends_on>=$4::date",
                [schoolId, id, termId ?? null, value.startsOn, value.endsOn],
              )
            ).rowCount
          )
            throw badRequest("Academic terms must not overlap");
          const row = update
            ? (
                await db.query(
                  `UPDATE terms SET code=$4,name=$5,starts_on=$6,ends_on=$7,sequence_no=$8 WHERE school_id=$1 AND academic_year_id=$2 AND id=$3 RETURNING id`,
                  [
                    schoolId,
                    id,
                    termId,
                    value.code,
                    value.name,
                    value.startsOn,
                    value.endsOn,
                    value.sequenceNo,
                  ],
                )
              ).rows[0]
            : (
                await db.query(
                  `INSERT INTO terms(school_id,academic_year_id,code,name,starts_on,ends_on,sequence_no) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                  [
                    schoolId,
                    id,
                    value.code,
                    value.name,
                    value.startsOn,
                    value.endsOn,
                    value.sequenceNo,
                  ],
                )
              ).rows[0];
          await recordAudit(db, {
            schoolId,
            actorUserId: actor.userId,
            action: update ? "academic.term_updated" : "academic.term_created",
            entityType: "term",
            entityId: row.id,
            outcome: "success",
            after: value,
            ...requestMeta(req),
          });
          return row;
        });
        return reply.status(update ? 200 : 201).send(saved);
      },
    });
    app.route({
      method: update ? "PUT" : "POST",
      url: update
        ? "/api/schools/:schoolId/academic-years/:id/holidays/:holidayId"
        : "/api/schools/:schoolId/academic-years/:id/holidays",
      preHandler: requirePermission("academic.year.manage"),
      handler: async (req, reply) => {
        const { schoolId, id, holidayId } = parseInput(
          record.extend({ holidayId: z.string().uuid().optional() }),
          req.params,
        );
        const value = parseInput(holidayInput, req.body);
        const actor = getActor(req);
        if (visibleSectionIds(actor, "academic.year.manage") !== null)
          throw notFound(
            "Academic year management requires institution-wide scope",
          );
        const saved = await withTransaction(async (db) => {
          const y = await year(db, schoolId, id, true);
          if (value.holidayOn < y.startsOn || value.holidayOn > y.endsOn)
            throw badRequest(
              "Holiday must be inside the selected academic year",
            );
          if (
            update &&
            !(
              await db.query(
                "SELECT 1 FROM holidays WHERE school_id=$1 AND academic_year_id=$2 AND id=$3",
                [schoolId, id, holidayId],
              )
            ).rowCount
          )
            throw notFound("Year holiday not found");
          const row = update
            ? (
                await db.query(
                  `UPDATE holidays SET name=$4,holiday_on=$5,notes=$6 WHERE school_id=$1 AND academic_year_id=$2 AND id=$3 RETURNING id`,
                  [
                    schoolId,
                    id,
                    holidayId,
                    value.name,
                    value.holidayOn,
                    value.notes,
                  ],
                )
              ).rows[0]
            : (
                await db.query(
                  `INSERT INTO holidays(school_id,academic_year_id,name,holiday_on,notes) VALUES($1,$2,$3,$4,$5) RETURNING id`,
                  [schoolId, id, value.name, value.holidayOn, value.notes],
                )
              ).rows[0];
          await recordAudit(db, {
            schoolId,
            actorUserId: actor.userId,
            action: update
              ? "academic.holiday_updated"
              : "academic.holiday_created",
            entityType: "holiday",
            entityId: row.id,
            outcome: "success",
            after: value,
            ...requestMeta(req),
          });
          return row;
        });
        return reply.status(update ? 200 : 201).send(saved);
      },
    });
  }
}
