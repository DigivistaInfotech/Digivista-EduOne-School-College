import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { getPool, withTransaction } from "../db";
import {
  getActor,
  requireAnyPermission,
  requirePermission,
  requestMeta,
} from "../auth/guards";
import { badRequest, forbidden, notFound, parseInput } from "../lib/errors";
import { recordAudit } from "../lib/audit";
const params = z.object({ schoolId: z.string().uuid() });
const input = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
  code: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/),
  label: z.string().trim().min(1).max(120),
  institutionType: z
    .enum(["all", "school", "college", "university"])
    .default("all"),
  active: z.boolean().default(true),
  notes: z.string().trim().max(1000).default(""),
});
export async function registerInstitutionMasterRoutes(app: FastifyInstance) {
  app.get(
    "/api/schools/:schoolId/institution-masters",
    { preHandler: requirePermission("school.view") },
    async (request) => {
      const { schoolId } = parseInput(params, request.params);
      const rows = await getPool().query(
        `SELECT id,kind,code,label,institution_type AS "institutionType",active,notes FROM institution_masters WHERE school_id=$1 ORDER BY kind,institution_type,label`,
        [schoolId],
      );
      return { items: rows.rows };
    },
  );
  app.post(
    "/api/schools/:schoolId/institution-masters",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "hr.employee.manage",
        "transport.manage",
      ),
    },
    async (request, reply) => {
      const { schoolId } = parseInput(params, request.params);
      const value = parseInput(input, request.body);
      const actor = getActor(request);
      assertMasterKindPermission(actor.permissions, value.kind);
      const id = await withTransaction(async (db) => {
        const row = (
          await db.query<{ id: string }>(
            `INSERT INTO institution_masters(school_id,kind,code,label,institution_type,active,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [
              schoolId,
              value.kind,
              value.code,
              value.label,
              value.institutionType,
              value.active,
              value.notes,
            ],
          )
        ).rows[0]!;
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "master.created",
          entityType: "institution_master",
          entityId: row.id,
          outcome: "success",
          after: value,
          ...requestMeta(request),
        });
        return row.id;
      });
      return reply.status(201).send({ id });
    },
  );
  app.patch(
    "/api/schools/:schoolId/institution-masters/:id",
    {
      preHandler: requireAnyPermission(
        "school.manage",
        "hr.employee.manage",
        "transport.manage",
      ),
    },
    async (request) => {
      const { schoolId, id } = parseInput(
        params.extend({ id: z.string().uuid() }),
        request.params,
      );
      const value = parseInput(
        z.object({
          active: z.boolean(),
          notes: z.string().trim().max(1000).optional(),
        }),
        request.body,
      );
      const actor = getActor(request);
      return withTransaction(async (db) => {
        const old = (
          await db.query<{ kind: string }>(
            "SELECT kind FROM institution_masters WHERE school_id=$1 AND id=$2 FOR UPDATE",
            [schoolId, id],
          )
        ).rows[0];
        if (!old) throw notFound("Master not found");
        assertMasterKindPermission(actor.permissions, old.kind);
        await db.query(
          "UPDATE institution_masters SET active=$3,notes=coalesce($4,notes) WHERE school_id=$1 AND id=$2",
          [schoolId, id, value.active, value.notes ?? null],
        );
        await recordAudit(db, {
          schoolId,
          actorUserId: actor.userId,
          action: "master.status_updated",
          entityType: "institution_master",
          entityId: id,
          outcome: "success",
          after: value,
          ...requestMeta(request),
        });
        return { id };
      });
    },
  );
}
export interface StaffMapping {
  institutionType?: "school" | "college" | "university";
  staffTypeId?: string | null;
  designationId?: string | null;
  departmentId?: string | null;
  employmentTypeId?: string | null;
}
export async function mapStaffMasters(
  db: pg.PoolClient,
  schoolId: string,
  staffId: string,
  input: StaffMapping,
) {
  const prior = (
    await db.query(
      `SELECT institution_type AS "institutionType",staff_type_id AS "staffTypeId",designation_id AS "designationId",department_id AS "departmentId",employment_type_id AS "employmentTypeId" FROM staff_master_mapping WHERE school_id=$1 AND staff_id=$2`,
      [schoolId, staffId],
    )
  ).rows[0] ?? { institutionType: "school" };
  const value = { ...prior, ...input };
  const labels: Record<string, string> = {};
  for (const [key, kind] of [
    ["staffTypeId", "staff_type"],
    ["designationId", "designation"],
    ["departmentId", "department"],
    ["employmentTypeId", "employment_type"],
  ] as const) {
    const id = value[key];
    if (!id) continue;
    const master = (
      await db.query<{
        label: string;
        institution_type: string;
        active: boolean;
      }>(
        `SELECT label,institution_type,active FROM institution_masters WHERE school_id=$1 AND id=$2 AND kind=$3`,
        [schoolId, id, kind],
      )
    ).rows[0];
    if (
      !master ||
      (!master.active && id !== prior[key]) ||
      (master.institution_type !== "all" &&
        master.institution_type !== value.institutionType)
    )
      throw badRequest(
        "Choose an active master matching the institution and field",
        { [key]: ["Invalid or unavailable master selection"] },
      );
    labels[kind] = master.label;
  }
  await db.query(
    `INSERT INTO staff_master_mapping(school_id,staff_id,institution_type,staff_type_id,designation_id,department_id,employment_type_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(school_id,staff_id) DO UPDATE SET institution_type=excluded.institution_type,staff_type_id=excluded.staff_type_id,designation_id=excluded.designation_id,department_id=excluded.department_id,employment_type_id=excluded.employment_type_id`,
    [
      schoolId,
      staffId,
      value.institutionType,
      value.staffTypeId ?? null,
      value.designationId ?? null,
      value.departmentId ?? null,
      value.employmentTypeId ?? null,
    ],
  );
  if (labels.designation || labels.department)
    await db.query(
      "UPDATE staff SET designation=coalesce($3,designation),department=coalesce($4,department) WHERE school_id=$1 AND id=$2",
      [
        schoolId,
        staffId,
        labels.designation ?? null,
        labels.department ?? null,
      ],
    );
}

function assertMasterKindPermission(
  permissions: ReadonlySet<string>,
  kind: string,
): void {
  if (permissions.has("school.manage")) return;
  if (
    permissions.has("hr.employee.manage") &&
    ["staff_type", "designation", "department", "employment_type"].includes(
      kind,
    )
  )
    return;
  if (
    permissions.has("transport.manage") &&
    ["vehicle_model", "vehicle_type", "fuel_type", "maintenance_type"].includes(
      kind,
    )
  )
    return;
  throw forbidden("Your role cannot manage this master category");
}
