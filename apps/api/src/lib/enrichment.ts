import { canAccessSection, visibleSectionIds } from "@erp/core";
import type { ActorContext } from '../auth/session';
import type { FastifyRequest } from "fastify";
import type pg from "pg";
import { getActor } from "../auth/guards";
import { getPool } from "../db";
import { forbidden, notFound } from "./errors";

export function enrichmentSections(actor: ActorContext): string[] | null {
  return visibleSectionIds(actor, "learning.manage");
}

export async function enrichmentGrades(
  request: FastifyRequest,
): Promise<number[]> {
  const actor = getActor(request);
  const staff = actor.permissions.has("learning.manage");
  if (staff && enrichmentSections(actor) === null)
    return Array.from({ length: 12 }, (_, i) => i + 1);
  const { rows } = await getPool().query<{ grade: number }>(
    `SELECT DISTINCT c.grade_order AS grade FROM enrollments e
     JOIN students s ON s.school_id=e.school_id AND s.id=e.student_id
     JOIN classes c ON c.school_id=e.school_id AND c.id=e.class_id
     JOIN academic_years y ON y.school_id=e.school_id AND y.id=e.academic_year_id
     WHERE e.school_id=$1 AND e.enrollment_status='active' AND y.status='active'
       AND (($3::boolean AND e.section_id=ANY($4::uuid[])) OR
         (NOT $3::boolean AND (s.user_id=$2 OR EXISTS(
           SELECT 1 FROM student_guardians sg JOIN guardians g ON g.school_id=sg.school_id AND g.id=sg.guardian_id
           WHERE sg.school_id=e.school_id AND sg.student_id=s.id AND g.user_id=$2
             AND sg.portal_access_status='verified' AND sg.valid_to IS NULL))))
       AND c.grade_order BETWEEN 1 AND 12 ORDER BY grade`,
    [actor.schoolId, actor.userId, staff, enrichmentSections(actor) ?? []],
  );
  return rows.map((row) => row.grade);
}

export async function assertEnrichmentGrade(
  request: FastifyRequest,
  grade: number,
) {
  if (!(await enrichmentGrades(request)).includes(grade))
    throw forbidden("This class is outside your assigned or linked classes");
}

export async function enrichmentStudent(
  request: FastifyRequest,
  studentId: string,
  client: Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query"> = getPool(),
) {
  const actor = getActor(request);
  const { rows } = await client.query<{
    id: string;
    section_id: string;
    academic_year_id: string;
    name: string;
  }>(
    `SELECT s.id,e.section_id,e.academic_year_id,concat_ws(' ',s.first_name,s.last_name) AS name
     FROM students s JOIN enrollments e ON e.school_id=s.school_id AND e.student_id=s.id
     JOIN academic_years y ON y.school_id=e.school_id AND y.id=e.academic_year_id
     WHERE s.school_id=$1 AND s.id=$2 AND e.enrollment_status='active' AND y.status='active'
       AND ($4::boolean OR s.user_id=$3 OR EXISTS(
         SELECT 1 FROM student_guardians sg JOIN guardians g ON g.school_id=sg.school_id AND g.id=sg.guardian_id
         WHERE sg.school_id=s.school_id AND sg.student_id=s.id AND g.user_id=$3
           AND sg.portal_access_status='verified' AND sg.valid_to IS NULL))
     ORDER BY e.starts_on DESC LIMIT 1`,
    [
      actor.schoolId,
      studentId,
      actor.userId,
      actor.permissions.has("learning.manage"),
    ],
  );
  const row = rows[0];
  if (
    !row ||
    (actor.permissions.has("learning.manage") &&
      !canAccessSection(actor, row.section_id, "learning.manage"))
  )
    throw notFound("Student not found in your scope");
  return row;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
