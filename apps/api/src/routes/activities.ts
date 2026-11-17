import {
  activityClubInput,
  activitySessionInput,
  activityParticipationInput,
  uuid,
  type ActivityClub,
  type ActivityMember,
  type ActivitySession,
  type ActivityStudent,
  type ActivityParticipation,
} from "@erp/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getActor, requirePermission, requestMeta } from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { recordAudit } from "../lib/audit";
import { badRequest, conflict, notFound, parseInput } from "../lib/errors";
import { enrichmentStudent, enrichmentSections, escapeHtml } from "../lib/enrichment";

const schoolParams = z.object({ schoolId: uuid });
const idParams = schoolParams.extend({ id: uuid });
const studentInput = z.object({ studentId: uuid });

export async function registerActivityRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/activities/clubs",
    { preHandler: requirePermission("learning.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await getPool().query<ActivityClub>(
        `SELECT c.id,c.code,c.name,c.category,c.venue,c.meeting_schedule AS "meetingSchedule",c.max_members AS "maxMembers",
        (SELECT count(*)::int FROM club_memberships m WHERE m.school_id=c.school_id AND m.club_id=c.id AND m.status='active') AS "memberCount"
       FROM school_clubs c WHERE c.school_id=$1 AND c.status='active' ORDER BY c.name`,
        [schoolId],
      );
      return { items: rows };
    },
  );
  app.post(
    "/api/schools/:schoolId/activities/clubs",
    { preHandler: requirePermission("learning.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(activityClubInput, request.body);
      const id = await withTransaction(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO school_clubs(school_id,code,name,category,venue,meeting_schedule,max_members)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            schoolId,
            input.code,
            input.name,
            input.category,
            input.venue,
            input.meetingSchedule,
            input.maxMembers,
          ],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "activities.club_created",
          entityType: "school_club",
          entityId: rows[0]!.id,
          outcome: "success",
          ...requestMeta(request),
        });
        return rows[0]!.id;
      });
      return reply.code(201).send({ id });
    },
  );
  app.get(
    "/api/schools/:schoolId/activities/students",
    { preHandler: requirePermission("learning.manage") },
    async (request) => {
      const actor = getActor(request);
      const { search } = parseInput(
        z.object({ search: z.string().trim().max(100).default("") }),
        request.query,
      );
      const { rows } = await getPool().query<ActivityStudent>(
        `SELECT DISTINCT s.id,concat_ws(' ',s.first_name,s.last_name) AS name,c.name AS "className",c.grade_order AS grade,
        e.section_id AS "sectionId",e.academic_year_id AS "academicYearId"
       FROM students s JOIN enrollments e ON e.school_id=s.school_id AND e.student_id=s.id
       JOIN academic_years y ON y.school_id=e.school_id AND y.id=e.academic_year_id
       JOIN classes c ON c.school_id=e.school_id AND c.id=e.class_id
       WHERE s.school_id=$1 AND e.enrollment_status='active' AND y.status='active'
         AND ($2::uuid[] IS NULL OR e.section_id=ANY($2::uuid[]))
         AND concat_ws(' ',s.first_name,s.last_name,s.admission_number) ILIKE $3 ORDER BY name LIMIT 200`,
        [actor.schoolId, enrichmentSections(actor), `%${search}%`],
      );
      return { items: rows };
    },
  );
  app.get(
    "/api/schools/:schoolId/activities/clubs/:id/members",
    { preHandler: requirePermission("learning.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const actor = getActor(request);
      const { rows } = await getPool().query<ActivityMember>(
        `SELECT DISTINCT m.student_id AS "studentId",concat_ws(' ',s.first_name,s.last_name) AS name,
        m.academic_year_id AS "academicYearId",m.achievements FROM club_memberships m
       JOIN students s ON s.school_id=m.school_id AND s.id=m.student_id
       JOIN enrollments e ON e.school_id=m.school_id AND e.student_id=m.student_id AND e.academic_year_id=m.academic_year_id
       JOIN academic_years y ON y.school_id=m.school_id AND y.id=m.academic_year_id
       WHERE m.school_id=$1 AND m.club_id=$2 AND m.status='active' AND y.status='active' AND e.enrollment_status='active'
         AND ($3::uuid[] IS NULL OR e.section_id=ANY($3::uuid[])) ORDER BY name`,
        [schoolId, id, enrichmentSections(actor)],
      );
      return { items: rows };
    },
  );
  app.post(
    "/api/schools/:schoolId/activities/clubs/:id/members",
    { preHandler: requirePermission("learning.manage") },
    async (request, reply) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const { studentId } = parseInput(studentInput, request.body);
      const result = await withTransaction(async (client) => {
        const student = await enrichmentStudent(request, studentId, client);
        const { rows } = await client.query<{ max_members: number }>(
          `SELECT max_members FROM school_clubs WHERE school_id=$1 AND id=$2 AND status='active' FOR UPDATE`,
          [schoolId, id],
        );
        if (!rows[0]) throw notFound("Club not found");
        const existing = await client.query(
          `SELECT 1 FROM club_memberships WHERE school_id=$1 AND club_id=$2 AND student_id=$3 AND academic_year_id=$4 AND status='active'`,
          [schoolId, id, studentId, student.academic_year_id],
        );
        if (existing.rowCount)
          throw conflict("Student is already enrolled in this club");
        const count = await client.query<{ count: string }>(
          `SELECT count(*) FROM club_memberships WHERE school_id=$1 AND club_id=$2 AND status='active'`,
          [schoolId, id],
        );
        if (Number(count.rows[0]!.count) >= rows[0].max_members)
          throw conflict("The club has reached its capacity");
        const added = await client.query<{ id: string }>(
          `INSERT INTO club_memberships(school_id,club_id,student_id,academic_year_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(club_id,student_id,academic_year_id) DO UPDATE SET status='active' RETURNING id`,
          [schoolId, id, studentId, student.academic_year_id],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "activities.member_enrolled",
          entityType: "club_membership",
          entityId: added.rows[0]!.id,
          outcome: "success",
          ...requestMeta(request),
        });
        return added.rows[0]!;
      });
      return reply.code(201).send(result);
    },
  );
  app.get(
    "/api/schools/:schoolId/activities/sessions",
    { preHandler: requirePermission("learning.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await getPool().query<ActivitySession>(
        `SELECT a.id,a.club_id AS "clubId",c.name AS "clubName",a.title,a.kind,
      a.starts_at::text AS "startsAt",a.ends_at::text AS "endsAt",a.venue FROM activity_sessions a
      JOIN school_clubs c ON c.school_id=a.school_id AND c.id=a.club_id WHERE a.school_id=$1 ORDER BY a.starts_at DESC LIMIT 200`,
        [schoolId],
      );
      return { items: rows };
    },
  );
  app.post(
    "/api/schools/:schoolId/activities/sessions",
    { preHandler: requirePermission("learning.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(activitySessionInput, request.body);
      const result = await withTransaction(async (client) => {
        const club = await client.query(
          `SELECT 1 FROM school_clubs WHERE school_id=$1 AND id=$2 AND status='active'`,
          [schoolId, input.clubId],
        );
        if (!club.rowCount) throw notFound("Club not found");
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO activity_sessions(school_id,club_id,title,kind,starts_at,ends_at,venue,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            schoolId,
            input.clubId,
            input.title,
            input.kind,
            input.startsAt,
            input.endsAt,
            input.venue,
            request.user!.id,
          ],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "activities.session_created",
          entityType: "activity_session",
          entityId: rows[0]!.id,
          outcome: "success",
          ...requestMeta(request),
        });
        return rows[0]!;
      });
      return reply.code(201).send(result);
    },
  );
  app.get(
    "/api/schools/:schoolId/activities/sessions/:id/participation",
    { preHandler: requirePermission("learning.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const { rows } = await getPool().query<ActivityParticipation>(
        `SELECT DISTINCT p.id,p.student_id AS "studentId",concat_ws(' ',s.first_name,s.last_name) AS "studentName",
      p.status,coalesce(p.house,'') AS house,p.score::float8 AS score,p.rank,coalesce(p.achievement,'') AS achievement,ac.id AS "certificateId"
      FROM activity_participation p JOIN students s ON s.school_id=p.school_id AND s.id=p.student_id
      JOIN enrollments e ON e.school_id=s.school_id AND e.student_id=s.id AND e.enrollment_status='active'
      LEFT JOIN activity_certificates ac ON ac.school_id=p.school_id AND ac.participation_id=p.id
      WHERE p.school_id=$1 AND p.session_id=$2 AND ($3::uuid[] IS NULL OR e.section_id=ANY($3::uuid[])) ORDER BY "studentName"`,
        [schoolId, id, enrichmentSections(getActor(request))],
      );
      return { items: rows };
    },
  );
  app.put(
    "/api/schools/:schoolId/activities/sessions/:id/participation",
    { preHandler: requirePermission("learning.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(activityParticipationInput, request.body);
      if (
        input.status !== "present" &&
        (input.score !== null || input.rank !== null || input.achievement)
      )
        throw badRequest(
          "Only present participants can receive results or achievements",
        );
      return withTransaction(async (client) => {
        const student = await enrichmentStudent(
          request,
          input.studentId,
          client,
        );
        const session = await client.query<{
          club_id: string;
          started: boolean;
        }>(
          `SELECT club_id,starts_at<=now() AS started FROM activity_sessions WHERE school_id=$1 AND id=$2 FOR UPDATE`,
          [schoolId, id],
        );
        if (!session.rows[0]) throw notFound("Session not found");
        if (!session.rows[0].started)
          throw badRequest(
            "Attendance cannot be recorded before the session starts",
          );
        const membership = await client.query(
          `SELECT 1 FROM club_memberships WHERE school_id=$1 AND club_id=$2 AND student_id=$3 AND academic_year_id=$4 AND status='active'`,
          [
            schoolId,
            session.rows[0].club_id,
            input.studentId,
            student.academic_year_id,
          ],
        );
        if (!membership.rowCount)
          throw badRequest("Enrol the student in this club first");
        const issued = await client.query(
          `SELECT 1 FROM activity_certificates ac JOIN activity_participation p ON p.school_id=ac.school_id AND p.id=ac.participation_id WHERE p.school_id=$1 AND p.session_id=$2 AND p.student_id=$3`,
          [schoolId, id, input.studentId],
        );
        if (issued.rowCount)
          throw conflict(
            "A certificate has been issued; its participation record is locked",
          );
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO activity_participation(school_id,session_id,student_id,status,house,score,rank,achievement,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(school_id,session_id,student_id) DO UPDATE
        SET status=EXCLUDED.status,house=EXCLUDED.house,score=EXCLUDED.score,rank=EXCLUDED.rank,achievement=EXCLUDED.achievement,recorded_by=EXCLUDED.recorded_by,updated_at=now() RETURNING id`,
          [
            schoolId,
            id,
            input.studentId,
            input.status,
            input.house,
            input.score,
            input.rank,
            input.achievement,
            request.user!.id,
          ],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: request.user!.id,
          action: "activities.participation_recorded",
          entityType: "activity_participation",
          entityId: rows[0]!.id,
          outcome: "success",
          ...requestMeta(request),
        });
        return rows[0]!;
      });
    },
  );
  app.post(
    "/api/schools/:schoolId/activities/participation/:id/certificate",
    { preHandler: requirePermission("learning.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      return withTransaction(async (client) => {
        const { rows } = await client.query<{
          student_id: string;
          status: string;
          finished: boolean;
        }>(
          `SELECT p.student_id,p.status,a.ends_at<=now() AS finished FROM activity_participation p
        JOIN activity_sessions a ON a.school_id=p.school_id AND a.id=p.session_id WHERE p.school_id=$1 AND p.id=$2 FOR UPDATE OF a,p`,
          [schoolId, id],
        );
        if (!rows[0]) throw notFound("Participation not found");
        await enrichmentStudent(request, rows[0].student_id, client);
        if (rows[0].status !== "present" || !rows[0].finished)
          throw badRequest(
            "Certificates require attendance at a completed activity",
          );
        const certificate = await client.query<{ id: string }>(
          `INSERT INTO activity_certificates(school_id,participation_id,issued_by) VALUES($1,$2,$3)
        ON CONFLICT(school_id,participation_id) DO NOTHING RETURNING id`,
          [schoolId, id, request.user!.id],
        );
        if (certificate.rows[0])
          await recordAudit(client, {
            schoolId,
            actorUserId: request.user!.id,
            action: "activities.certificate_issued",
            entityType: "activity_certificate",
            entityId: certificate.rows[0].id,
            outcome: "success",
            ...requestMeta(request),
          });
        const existing =
          certificate.rows[0] ??
          (
            await client.query<{ id: string }>(
              `SELECT id FROM activity_certificates WHERE school_id=$1 AND participation_id=$2`,
              [schoolId, id],
            )
          ).rows[0]!;
        return existing;
      });
    },
  );
  app.get(
    "/api/schools/:schoolId/activities/certificates/:id/print",
    { preHandler: requirePermission("learning.view") },
    async (request, reply) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const { rows } = await getPool().query<{
        student_id: string;
        student_name: string;
        school_name: string;
        title: string;
        achievement: string;
        issued_on: string;
      }>(
        `SELECT p.student_id,concat_ws(' ',s.first_name,s.last_name) AS student_name,
      sc.name AS school_name,a.title,p.achievement,ac.issued_at::date::text AS issued_on FROM activity_certificates ac
      JOIN activity_participation p ON p.school_id=ac.school_id AND p.id=ac.participation_id
      JOIN students s ON s.school_id=p.school_id AND s.id=p.student_id
      JOIN activity_sessions a ON a.school_id=p.school_id AND a.id=p.session_id JOIN schools sc ON sc.id=ac.school_id
      WHERE ac.school_id=$1 AND ac.id=$2`,
        [schoolId, id],
      );
      const row = rows[0];
      if (!row) throw notFound("Certificate not found");
      await enrichmentStudent(request, row.student_id);
      return reply.header("content-type", "text/html; charset=utf-8")
        .send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Participation certificate</title>
      <style>body{font:20px Georgia,serif;color:#182944;margin:48px;text-align:center}main{border:5px double #087f83;padding:70px 35px}h1{font-size:36px}small{font-size:12px}button{margin-top:24px}@media print{button{display:none}}</style>
      <main><p>${escapeHtml(row.school_name)}</p><h1>Certificate of Participation</h1><p>This certifies that</p><h2>${escapeHtml(row.student_name)}</h2><p>participated in ${escapeHtml(row.title)}.</p><p>${escapeHtml(row.achievement)}</p><small>Issued ${escapeHtml(row.issued_on)} · Reference ${escapeHtml(id)}</small></main><button onclick="window.print()">Print certificate</button></html>`);
    },
  );
}
