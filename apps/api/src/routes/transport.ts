import { createTransportAllocation } from "../lib/transportAllocations";
import {
  registerTransportOperationsRoutes,
  addRouteTariff,
} from "./transportOperations";
import {
  saveVehicleProfile,
  validateMaintenanceProfile,
} from "../lib/transportProfiles";
import {
  driverInput,
  driverUpdate,
  transportAllocationEndInput,
  transportAllocationInput,
  transportMaintenanceInput,
  transportRouteInput,
  transportRouteUpdate,
  uuid,
  vehicleInput,
  vehicleUpdate,
  type StudentTransportAllocation,
  type TransportDriver,
  type TransportMaintenance,
  type TransportRoute,
  type TransportStop,
  type TransportVehicle,
} from "@erp/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getActor, requirePermission, requestMeta } from "../auth/guards";
import { getPool, withTransaction } from "../db";
import { recordAudit } from "../lib/audit";
import { badRequest, conflict, notFound, parseInput } from "../lib/errors";
import { toIsoDate, toNumber, todayInTimeZone } from "../lib/format";
import { idempotentRoute } from "../lib/idempotency";

const schoolParams = z.object({ schoolId: uuid });
const idParams = z.object({ schoolId: uuid, id: uuid });
const allocationQuery = z.object({
  routeId: uuid.optional(),
  studentId: uuid.optional(),
  activeOnly: z.enum(["true", "false"]).optional(),
});

/**
 * Transport and fleet management.
 *
 * Capacity is enforced when a student is allocated: the route's assigned
 * vehicle capacity is compared with the number of active allocations inside the
 * same transaction, so a race cannot overfill a bus. Insurance and licence
 * dates are surfaced as supplied by the school; no compliance rule is invented.
 */
export async function registerTransportRoutes(
  app: FastifyInstance,
): Promise<void> {
  await registerTransportOperationsRoutes(app);
  app.get(
    "/api/schools/:schoolId/transport/lookups",
    { preHandler: requirePermission("transport.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const masters = (
        await getPool().query(
          `SELECT id,kind,code,label,active,notes FROM institution_masters WHERE school_id=$1 AND kind IN('vehicle_model','vehicle_type','fuel_type','maintenance_type') ORDER BY kind,label`,
          [schoolId],
        )
      ).rows;
      const feeHeads = (
        await getPool().query(
          `SELECT id,code,name FROM fee_heads WHERE school_id=$1 AND status='active' AND (code ILIKE '%transport%' OR name ILIKE '%transport%') ORDER BY name`,
          [schoolId],
        )
      ).rows;
      const vendors = (
        await getPool().query(
          `SELECT id,name FROM vendors WHERE school_id=$1 AND status='active' ORDER BY name`,
          [schoolId],
        )
      ).rows;
      return { masters, feeHeads, vendors };
    },
  );

  /* -------------------------------- vehicles ------------------------------- */

  app.get(
    "/api/schools/:schoolId/transport/vehicles",
    { preHandler: requirePermission("transport.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await getPool().query<{
        id: string;
        registration_number: string;
        model: string | null;
        capacity: number;
        status: TransportVehicle["status"];
        insurance_expires_on: Date | null;
        notes: string | null;
        route_count: string;
        profile: TransportVehicle["profile"];
      }>(
        `SELECT v.id, v.registration_number, v.model, v.capacity, v.status,
                v.insurance_expires_on, v.notes, p.audit_details AS profile,
                (SELECT count(*) FROM transport_routes r
                 WHERE r.school_id = v.school_id AND r.vehicle_id = v.id)::text AS route_count
         FROM transport_vehicles v LEFT JOIN transport_vehicle_profiles p ON p.school_id=v.school_id AND p.vehicle_id=v.id
         WHERE v.school_id = $1 ORDER BY v.registration_number`,
        [schoolId],
      );
      const items: TransportVehicle[] = rows.map((row) => ({
        id: row.id,
        registrationNumber: row.registration_number,
        profile: row.profile ?? undefined,
        model: row.model,
        capacity: row.capacity,
        status: row.status,
        insuranceExpiresOn: row.insurance_expires_on
          ? toIsoDate(row.insurance_expires_on)
          : null,
        notes: row.notes,
        assignedRouteCount: toNumber(row.route_count),
      }));
      return { items };
    },
  );

  app.post(
    "/api/schools/:schoolId/transport/vehicles",
    { preHandler: requirePermission("transport.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(vehicleInput, request.body);
      const actor = getActor(request);
      return withTransaction(async (client) => {
        if (
          (
            await client.query(
              `SELECT 1 FROM transport_vehicles WHERE school_id=$1 AND upper(regexp_replace(registration_number,'[^A-Za-z0-9]','','g'))=upper(regexp_replace($2::text,'[^A-Za-z0-9]','','g'))`,
              [schoolId, input.registrationNumber],
            )
          ).rowCount
        )
          throw conflict("This registration is already present in the fleet");
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO transport_vehicles
           (school_id, registration_number, model, capacity, status, insurance_expires_on, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            schoolId,
            input.registrationNumber,
            input.model ?? null,
            input.capacity,
            input.status,
            input.insuranceExpiresOn ?? null,
            input.notes ?? null,
          ],
        );
        await saveVehicleProfile(
          client,
          schoolId,
          rows[0]!.id,
          input.profile,
          input.registrationNumber,
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "transport.vehicle_created",
          entityType: "transport_vehicle",
          entityId: rows[0]!.id,
          outcome: "success",
          after: {
            registrationNumber: input.registrationNumber,
            capacity: input.capacity,
          },
          ...requestMeta(request),
        });
        return reply.status(201).send({ id: rows[0]!.id });
      });
    },
  );

  app.patch(
    "/api/schools/:schoolId/transport/vehicles/:id",
    { preHandler: requirePermission("transport.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(vehicleUpdate, request.body);
      return withTransaction(async (client) => {
        await client.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
          schoolId,
        ]);
        const existing = await client.query<{
          registration_number: string;
          model: string | null;
          capacity: number;
          status: TransportVehicle["status"];
          insurance_expires_on: Date | null;
          notes: string | null;
        }>(
          `SELECT registration_number, model, capacity, status, insurance_expires_on, notes
         FROM transport_vehicles WHERE school_id = $1 AND id = $2`,
          [schoolId, id],
        );
        const row = existing.rows[0];
        if (
          input.registrationNumber &&
          (
            await client.query(
              `SELECT 1 FROM transport_vehicles WHERE school_id=$1 AND id<>$3 AND upper(regexp_replace(registration_number,'[^A-Za-z0-9]','','g'))=upper(regexp_replace($2::text,'[^A-Za-z0-9]','','g'))`,
              [schoolId, input.registrationNumber, id],
            )
          ).rowCount
        )
          throw conflict("This registration is already present in the fleet");

        if (!row) throw notFound("Vehicle not found");
        if (
          input.capacity !== undefined &&
          input.capacity < (await activeAllocationsForVehicle(schoolId, id))
        ) {
          throw conflict(
            "The capacity is lower than the number of students already allocated",
          );
        }
        await client.query(
          `UPDATE transport_vehicles SET
           registration_number = $3, model = $4, capacity = $5, status = $6,
           insurance_expires_on = $7, notes = $8
         WHERE school_id = $1 AND id = $2`,
          [
            schoolId,
            id,
            input.registrationNumber ?? row.registration_number,
            input.model === undefined ? row.model : input.model,
            input.capacity ?? row.capacity,
            input.status ?? row.status,
            input.insuranceExpiresOn === undefined
              ? row.insurance_expires_on
              : input.insuranceExpiresOn,
            input.notes === undefined ? row.notes : input.notes,
          ],
        );
        await saveVehicleProfile(
          client,
          schoolId,
          id,
          input.profile ?? {},
          input.registrationNumber ?? row.registration_number,
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: getActor(request).userId,
          action: "transport.vehicle_updated",
          entityType: "transport_vehicle",
          entityId: id,
          outcome: "success",
          before: row,
          after: input,
          ...requestMeta(request),
        });
        return { id };
      });
    },
  );

  /* --------------------------------- drivers ------------------------------- */

  app.get(
    "/api/schools/:schoolId/transport/drivers",
    { preHandler: requirePermission("transport.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await getPool().query<{
        id: string;
        staff_id: string | null;
        full_name: string;
        phone: string | null;
        licence_number: string | null;
        licence_expires_on: Date | null;
        status: TransportDriver["status"];
      }>(
        `SELECT id, staff_id, full_name, phone, licence_number, licence_expires_on, status
         FROM transport_drivers WHERE school_id = $1 ORDER BY full_name`,
        [schoolId],
      );
      const items: TransportDriver[] = rows.map((row) => ({
        id: row.id,
        staffId: row.staff_id,
        fullName: row.full_name,
        phone: row.phone,
        licenceNumber: row.licence_number,
        licenceExpiresOn: row.licence_expires_on
          ? toIsoDate(row.licence_expires_on)
          : null,
        status: row.status,
      }));
      return { items };
    },
  );

  app.post(
    "/api/schools/:schoolId/transport/drivers",
    { preHandler: requirePermission("transport.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(driverInput, request.body);
      const { rows } = await getPool().query<{ id: string }>(
        `INSERT INTO transport_drivers
           (school_id, staff_id, full_name, phone, licence_number, licence_expires_on, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          schoolId,
          input.staffId ?? null,
          input.fullName,
          input.phone ?? null,
          input.licenceNumber ?? null,
          input.licenceExpiresOn ?? null,
          input.status,
        ],
      );
      return reply.status(201).send({ id: rows[0]!.id });
    },
  );

  app.patch(
    "/api/schools/:schoolId/transport/drivers/:id",
    { preHandler: requirePermission("transport.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(driverUpdate, request.body);
      const existing = await getPool().query<{
        staff_id: string | null;
        full_name: string;
        phone: string | null;
        licence_number: string | null;
        licence_expires_on: Date | null;
        status: TransportDriver["status"];
      }>(
        `SELECT staff_id, full_name, phone, licence_number, licence_expires_on, status
         FROM transport_drivers WHERE school_id = $1 AND id = $2`,
        [schoolId, id],
      );
      const row = existing.rows[0];
      if (!row) throw notFound("Driver not found");
      await getPool().query(
        `UPDATE transport_drivers SET
           staff_id = $3, full_name = $4, phone = $5, licence_number = $6,
           licence_expires_on = $7, status = $8
         WHERE school_id = $1 AND id = $2`,
        [
          schoolId,
          id,
          input.staffId === undefined ? row.staff_id : input.staffId,
          input.fullName ?? row.full_name,
          input.phone === undefined ? row.phone : input.phone,
          input.licenceNumber === undefined
            ? row.licence_number
            : input.licenceNumber,
          input.licenceExpiresOn === undefined
            ? row.licence_expires_on
            : input.licenceExpiresOn,
          input.status ?? row.status,
        ],
      );
      return { id };
    },
  );

  /* --------------------------------- routes -------------------------------- */

  app.get(
    "/api/schools/:schoolId/transport/routes",
    { preHandler: requirePermission("transport.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const routes = await getPool().query<{
        id: string;
        code: string;
        name: string;
        vehicle_id: string | null;
        vehicle_registration: string | null;
        driver_id: string | null;
        driver_name: string | null;
        attendant_name: string | null;
        fee_head_id: string | null;
        fee_amount: string | null;
        status: TransportRoute["status"];
        notes: string | null;
        allocated_students: string;
        capacity: number | null;
      }>(
        `SELECT r.id, r.code, r.name, r.vehicle_id, v.registration_number AS vehicle_registration,
                r.driver_id, d.full_name AS driver_name, r.attendant_name, r.fee_head_id,
                r.fee_amount, r.status, r.notes, v.capacity,
                (SELECT count(*) FROM student_transport_allocations a
                 WHERE a.school_id = r.school_id AND a.route_id = r.id
                   AND a.status = 'active')::text AS allocated_students
         FROM transport_routes r
         LEFT JOIN transport_vehicles v ON v.id = r.vehicle_id AND v.school_id = r.school_id
         LEFT JOIN transport_drivers d ON d.id = r.driver_id AND d.school_id = r.school_id
         WHERE r.school_id = $1 ORDER BY r.code`,
        [schoolId],
      );
      const stops = await getPool().query<{
        id: string;
        route_id: string;
        name: string;
        sequence_no: number;
        scheduled_pickup: string | null;
        scheduled_drop: string | null;
        landmark: string | null;
      }>(
        `SELECT id, route_id, name, sequence_no, scheduled_pickup::text,
                scheduled_drop::text, landmark
         FROM transport_stops WHERE school_id = $1 AND retired_at IS NULL
         ORDER BY route_id, sequence_no`,
        [schoolId],
      );
      const byRoute = new Map<string, TransportStop[]>();
      for (const stop of stops.rows) {
        const list = byRoute.get(stop.route_id) ?? [];
        list.push({
          id: stop.id,
          routeId: stop.route_id,
          name: stop.name,
          sequenceNo: stop.sequence_no,
          scheduledPickup: stop.scheduled_pickup
            ? stop.scheduled_pickup.slice(0, 5)
            : null,
          scheduledDrop: stop.scheduled_drop
            ? stop.scheduled_drop.slice(0, 5)
            : null,
          landmark: stop.landmark,
        });
        byRoute.set(stop.route_id, list);
      }
      const items: TransportRoute[] = routes.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        vehicleId: row.vehicle_id,
        vehicleRegistration: row.vehicle_registration,
        driverId: row.driver_id,
        driverName: row.driver_name,
        attendantName: row.attendant_name,
        feeHeadId: row.fee_head_id,
        feeAmount: row.fee_amount === null ? null : toNumber(row.fee_amount),
        status: row.status,
        notes: row.notes,
        stops: byRoute.get(row.id) ?? [],
        allocatedStudents: toNumber(row.allocated_students),
        capacity: row.capacity,
      }));
      return { items };
    },
  );

  app.post(
    "/api/schools/:schoolId/transport/routes",
    { preHandler: requirePermission("transport.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(transportRouteInput, request.body);
      const actor = getActor(request);
      validateStops(input.stops);
      const created = await withTransaction(async (client) => {
        await assertRouteRefs(
          client,
          schoolId,
          input.vehicleId ?? null,
          input.driverId ?? null,
          input.feeHeadId ?? null,
        );
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO transport_routes
             (school_id, code, name, vehicle_id, driver_id, attendant_name, fee_head_id,
              fee_amount, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            schoolId,
            input.code,
            input.name,
            input.vehicleId ?? null,
            input.driverId ?? null,
            input.attendantName ?? null,
            input.feeHeadId ?? null,
            input.feeAmount ?? null,
            input.status,
            input.notes ?? null,
          ],
        );
        const routeId = rows[0]!.id;
        if (
          input.feePeriod &&
          input.feeAmount !== undefined &&
          input.feeAmount !== null
        ) {
          if (!input.feeHeadId || !input.feeEffectiveFrom)
            throw badRequest(
              "A tariff needs a transport fee head and effective start date",
            );
          await addRouteTariff(client, schoolId, actor.userId, {
            routeId,
            feeHeadId: input.feeHeadId,
            period: input.feePeriod,
            amount: input.feeAmount,
            effectiveFrom: input.feeEffectiveFrom,
            effectiveTo: input.feeEffectiveTo ?? null,
            authorityReference: input.feeAuthorityReference,
          });
        }
        for (const stop of input.stops) {
          await client.query(
            `INSERT INTO transport_stops
               (school_id, route_id, name, sequence_no, scheduled_pickup, scheduled_drop, landmark)
             VALUES ($1, $2, $3, $4, $5::time, $6::time, $7)`,
            [
              schoolId,
              routeId,
              stop.name,
              stop.sequenceNo,
              stop.scheduledPickup ?? null,
              stop.scheduledDrop ?? null,
              stop.landmark ?? null,
            ],
          );
        }
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "transport.route_created",
          entityType: "transport_route",
          entityId: routeId,
          outcome: "success",
          after: { code: input.code, stops: input.stops.length },
          ...requestMeta(request),
        });
        return routeId;
      });
      return reply.status(201).send({ id: created });
    },
  );

  app.patch(
    "/api/schools/:schoolId/transport/routes/:id",
    { preHandler: requirePermission("transport.manage") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(transportRouteUpdate, request.body);
      if (input.stops) validateStops(input.stops);
      await withTransaction(async (client) => {
        await client.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [
          schoolId,
        ]);
        const existing = await client.query<{
          code: string;
          name: string;
          vehicle_id: string | null;
          driver_id: string | null;
          attendant_name: string | null;
          fee_head_id: string | null;
          fee_amount: string | null;
          status: TransportRoute["status"];
          notes: string | null;
        }>(
          `SELECT code, name, vehicle_id, driver_id, attendant_name, fee_head_id,
                  fee_amount, status, notes
           FROM transport_routes WHERE school_id = $1 AND id = $2 FOR UPDATE`,
          [schoolId, id],
        );
        const row = existing.rows[0];
        if (!row) throw notFound("Route not found");
        await assertRouteRefs(
          client,
          schoolId,
          input.vehicleId === undefined ? row.vehicle_id : input.vehicleId,
          input.driverId === undefined ? row.driver_id : input.driverId,
          input.feeHeadId === undefined ? row.fee_head_id : input.feeHeadId,
        );
        const chosenVehicle =
          input.vehicleId === undefined ? row.vehicle_id : input.vehicleId;
        if (chosenVehicle) {
          const v = (
            await client.query<{ capacity: number }>(
              "SELECT capacity FROM transport_vehicles WHERE school_id=$1 AND id=$2",
              [schoolId, chosenVehicle],
            )
          ).rows[0];
          const count = Number(
            (
              await client.query<{ count: string }>(
                `SELECT count(*)::text AS count FROM student_transport_allocations a JOIN transport_routes r ON r.school_id=a.school_id AND r.id=a.route_id WHERE a.school_id=$1 AND a.status='active' AND (r.vehicle_id=$2 OR r.id=$3)`,
                [schoolId, chosenVehicle, id],
              )
            ).rows[0]?.count ?? 0,
          );
          if (v && count > v.capacity)
            throw conflict(
              "The chosen vehicle cannot hold the active allocations across these routes",
            );
        }
        await client.query(
          `UPDATE transport_routes SET
             code = $3, name = $4, vehicle_id = $5, driver_id = $6,
             attendant_name = $7, fee_head_id = $8, fee_amount = $9, status = $10, notes = $11
           WHERE school_id = $1 AND id = $2`,
          [
            schoolId,
            id,
            input.code ?? row.code,
            input.name ?? row.name,
            input.vehicleId === undefined ? row.vehicle_id : input.vehicleId,
            input.driverId === undefined ? row.driver_id : input.driverId,
            input.attendantName === undefined
              ? row.attendant_name
              : input.attendantName,
            input.feeHeadId === undefined ? row.fee_head_id : input.feeHeadId,
            input.feeAmount === undefined ? row.fee_amount : input.feeAmount,
            input.status ?? row.status,
            input.notes === undefined ? row.notes : input.notes,
          ],
        );
        if (input.stops) {
          const allocated = await client.query(
            `SELECT 1 FROM student_transport_allocations
             WHERE school_id = $1 AND route_id = $2 AND status = 'active' LIMIT 1`,
            [schoolId, id],
          );
          if (allocated.rowCount) {
            throw conflict(
              "End the route allocations before replacing its stops, so students are not left on a removed stop",
            );
          }
          await client.query(
            "UPDATE transport_stops SET retired_at = now() WHERE school_id = $1 AND route_id = $2 AND retired_at IS NULL",
            [schoolId, id],
          );
          for (const stop of input.stops) {
            await client.query(
              `INSERT INTO transport_stops
                 (school_id, route_id, name, sequence_no, scheduled_pickup, scheduled_drop, landmark)
               VALUES ($1, $2, $3, $4, $5::time, $6::time, $7)`,
              [
                schoolId,
                id,
                stop.name,
                stop.sequenceNo,
                stop.scheduledPickup ?? null,
                stop.scheduledDrop ?? null,
                stop.landmark ?? null,
              ],
            );
          }
        }
        const actor = getActor(request);
        if (input.feePeriod) {
          const feeHeadId = input.feeHeadId ?? row.fee_head_id;
          const amount =
            input.feeAmount ??
            (row.fee_amount === null ? null : Number(row.fee_amount));
          if (!feeHeadId || amount === null || !input.feeEffectiveFrom)
            throw badRequest(
              "A tariff needs amount, transport fee head and effective start date",
            );
          await addRouteTariff(client, schoolId, actor.userId, {
            routeId: id,
            feeHeadId,
            period: input.feePeriod,
            amount,
            effectiveFrom: input.feeEffectiveFrom,
            effectiveTo: input.feeEffectiveTo ?? null,
            authorityReference: input.feeAuthorityReference,
          });
        }
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "transport.route_updated",
          entityType: "transport_route",
          entityId: id,
          outcome: "success",
          after: { code: input.code ?? row.code },
          ...requestMeta(request),
        });
      });
      return { id };
    },
  );

  /* ------------------------------- allocations ----------------------------- */

  app.get(
    "/api/schools/:schoolId/transport/allocations",
    { preHandler: requirePermission("transport.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const query = parseInput(allocationQuery, request.query);
      const params: unknown[] = [schoolId];
      const filters = ["a.school_id = $1"];
      if (query.routeId) {
        params.push(query.routeId);
        filters.push(`a.route_id = $${params.length}`);
      }
      if (query.studentId) {
        params.push(query.studentId);
        filters.push(`a.student_id = $${params.length}`);
      }
      if (query.activeOnly !== "false") filters.push(`a.status = 'active'`);
      const { rows } = await getPool().query<{
        id: string;
        student_id: string;
        first_name: string;
        middle_name: string | null;
        last_name: string | null;
        admission_number: string;
        route_id: string;
        route_name: string;
        stop_id: string;
        stop_name: string;
        effective_from: Date;
        effective_to: Date | null;
        valid_until: Date | null;
        reminder_days: number;
        status: StudentTransportAllocation["status"];
      }>(
        `SELECT a.id, a.student_id, s.first_name, s.middle_name, s.last_name, s.admission_number,
                a.route_id, r.name AS route_name, a.stop_id, st.name AS stop_name,
                a.effective_from, a.effective_to, a.status,a.valid_until,a.reminder_days
         FROM student_transport_allocations a
         JOIN students s ON s.id = a.student_id AND s.school_id = a.school_id
         JOIN transport_routes r ON r.id = a.route_id AND r.school_id = a.school_id
         JOIN transport_stops st ON st.id = a.stop_id AND st.school_id = a.school_id
         WHERE ${filters.join(" AND ")}
         ORDER BY a.effective_from DESC, s.first_name`,
        params,
      );
      const items: StudentTransportAllocation[] = rows.map((row) => ({
        id: row.id,
        studentId: row.student_id,
        studentName: [row.first_name, row.middle_name, row.last_name]
          .filter(Boolean)
          .join(" "),
        admissionNumber: row.admission_number,
        routeId: row.route_id,
        routeName: row.route_name,
        stopId: row.stop_id,
        stopName: row.stop_name,
        effectiveFrom: toIsoDate(row.effective_from),
        validUntil: row.valid_until ? toIsoDate(row.valid_until) : null,
        reminderDays: row.reminder_days,
        effectiveTo: row.effective_to ? toIsoDate(row.effective_to) : null,
        status: row.status,
      }));
      return { items };
    },
  );

  app.post(
    "/api/schools/:schoolId/transport/allocations",
    { preHandler: requirePermission("transport.allocate") },
    idempotentRoute("POST /transport/allocations", async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(transportAllocationInput, request.body);
      const actor = getActor(request);
      const created = await withTransaction(async (client) => {
        const allocationId = await createTransportAllocation(
          client,
          schoolId,
          actor.userId,
          todayInTimeZone(actor.school.timezone),
          input,
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "transport.allocation_created",
          entityType: "student_transport_allocation",
          entityId: allocationId,
          outcome: "success",
          after: {
            studentId: input.studentId,
            routeId: input.routeId,
            stopId: input.stopId,
          },
          ...requestMeta(request),
        });
        return allocationId;
      });
      return reply.status(201).send({ id: created });
    }),
  );

  app.post(
    "/api/schools/:schoolId/transport/allocations/:id/end",
    { preHandler: requirePermission("transport.allocate") },
    async (request) => {
      const { schoolId, id } = parseInput(idParams, request.params);
      const input = parseInput(transportAllocationEndInput, request.body ?? {});
      const actor = getActor(request);
      const effectiveTo =
        input.effectiveTo ?? todayInTimeZone(actor.school.timezone);
      await withTransaction(async (client) => {
        const { rows } = await client.query<{ effective_from: string }>(
          `SELECT effective_from FROM student_transport_allocations
           WHERE school_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
          [schoolId, id],
        );
        const row = rows[0];
        if (!row) throw notFound("Active allocation not found");
        if (effectiveTo < toIsoDate(row.effective_from)) {
          throw badRequest(
            "The end date cannot be before the allocation start",
          );
        }
        await client.query(
          `UPDATE student_transport_allocations SET effective_to = $3::date, status = 'ended'
           WHERE school_id = $1 AND id = $2`,
          [schoolId, id, effectiveTo],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "transport.allocation_ended",
          entityType: "student_transport_allocation",
          entityId: id,
          outcome: "success",
          after: { effectiveTo },
          ...requestMeta(request),
        });
      });
      return { id };
    },
  );

  /* ------------------------------- maintenance ----------------------------- */

  app.get(
    "/api/schools/:schoolId/transport/maintenance",
    { preHandler: requirePermission("transport.view") },
    async (request) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const { rows } = await getPool().query<{
        id: string;
        vehicle_id: string;
        registration_number: string;
        performed_on: Date | null;
        planned_on: Date | null;
        vendor_id: string | null;
        expense_id: string | null;
        audit_details: TransportMaintenance["profile"];
        description: string;
        cost: string;
        status: TransportMaintenance["status"];
        vendor_name: string | null;
      }>(
        `SELECT m.id, m.vehicle_id, v.registration_number, m.performed_on, m.description,
                m.cost, m.status, m.vendor_name,m.planned_on,m.vendor_id,m.expense_id,m.audit_details
         FROM transport_maintenance m
         JOIN transport_vehicles v ON v.id = m.vehicle_id AND v.school_id = m.school_id
         WHERE m.school_id = $1 ORDER BY m.performed_on DESC`,
        [schoolId],
      );
      const items: TransportMaintenance[] = rows.map((row) => ({
        id: row.id,
        vehicleId: row.vehicle_id,
        vehicleRegistration: row.registration_number,
        performedOn: row.performed_on ? toIsoDate(row.performed_on) : null,
        plannedOn: row.planned_on ? toIsoDate(row.planned_on) : null,
        vendorId: row.vendor_id,
        expenseId: row.expense_id,
        profile: row.audit_details,
        description: row.description,
        cost: toNumber(row.cost),
        status: row.status,
        vendorName: row.vendor_name,
      }));
      return { items };
    },
  );

  app.post(
    "/api/schools/:schoolId/transport/maintenance",
    { preHandler: requirePermission("transport.manage") },
    async (request, reply) => {
      const { schoolId } = parseInput(schoolParams, request.params);
      const input = parseInput(transportMaintenanceInput, request.body);
      const actor = getActor(request);
      return withTransaction(async (client) => {
        const vehicle = await client.query(
          "SELECT 1 FROM transport_vehicles WHERE school_id = $1 AND id = $2",
          [schoolId, input.vehicleId],
        );
        if (vehicle.rowCount === 0) throw notFound("Vehicle not found");
        const cost = await validateMaintenanceProfile(
          client,
          schoolId,
          input.profile,
          input.vendorId,
          input.expenseId,
          input.cost,
        );
        const today = todayInTimeZone(actor.school.timezone);
        if (
          input.status === "completed" &&
          input.performedOn &&
          input.performedOn > today
        )
          throw badRequest("Completed maintenance cannot be in the future");
        if (
          input.profile?.nextServiceOn &&
          input.performedOn &&
          input.profile.nextServiceOn < input.performedOn
        )
          throw badRequest("Next service cannot precede the performed date");
        const vendorName = input.vendorId
          ? (
              await client.query<{ name: string }>(
                "SELECT name FROM vendors WHERE school_id=$1 AND id=$2",
                [schoolId, input.vendorId],
              )
            ).rows[0]!.name
          : (input.vendorName ?? null);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO transport_maintenance
           (school_id, vehicle_id, performed_on, description, cost, status, vendor_name, created_by,planned_on,vendor_id,expense_id,audit_details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9,$10,$11,$12) RETURNING id`,
          [
            schoolId,
            input.vehicleId,
            input.status === "completed" ? (input.performedOn ?? null) : null,
            input.description,
            cost,
            input.status,
            vendorName,
            actor.userId,
            input.plannedOn ??
              (input.status === "scheduled" ? input.performedOn : null) ??
              null,
            input.vendorId ?? null,
            input.expenseId ?? null,
            JSON.stringify(input.profile ?? {}),
          ],
        );
        await recordAudit(client, {
          schoolId,
          actorUserId: actor.userId,
          action: "transport.maintenance_recorded",
          entityType: "transport_maintenance",
          entityId: rows[0]!.id,
          outcome: "success",
          after: { ...input, cost },
          ...requestMeta(request),
        });
        return reply.status(201).send({ id: rows[0]!.id });
      });
    },
  );
}

/* --------------------------------- helpers -------------------------------- */

function validateStops(stops: Array<{ sequenceNo: number }>): void {
  const seen = new Set<number>();
  for (const stop of stops) {
    if (seen.has(stop.sequenceNo)) {
      throw badRequest("Each stop needs a unique sequence number", {
        stops: ["Two stops share the same sequence number"],
      });
    }
    seen.add(stop.sequenceNo);
  }
}

async function assertRouteRefs(
  client: {
    query: (
      text: string,
      values?: unknown[],
    ) => Promise<{ rowCount: number | null }>;
  },
  schoolId: string,
  vehicleId: string | null,
  driverId: string | null,
  feeHeadId: string | null,
): Promise<void> {
  if (vehicleId) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM transport_vehicles WHERE school_id = $1 AND id = $2",
      [schoolId, vehicleId],
    );
    if (!rowCount) throw notFound("Vehicle not found");
  }
  if (driverId) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM transport_drivers WHERE school_id = $1 AND id = $2",
      [schoolId, driverId],
    );
    if (!rowCount) throw notFound("Driver not found");
  }
  if (feeHeadId) {
    const { rowCount } = await client.query(
      "SELECT 1 FROM fee_heads WHERE school_id = $1 AND id = $2",
      [schoolId, feeHeadId],
    );
    if (!rowCount) throw notFound("Fee head not found");
  }
}

async function activeAllocationsForVehicle(
  schoolId: string,
  vehicleId: string,
): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM student_transport_allocations a
     JOIN transport_routes r ON r.id = a.route_id AND r.school_id = a.school_id
     WHERE a.school_id = $1 AND r.vehicle_id = $2 AND a.status = 'active'`,
    [schoolId, vehicleId],
  );
  return toNumber(rows[0]?.count);
}
