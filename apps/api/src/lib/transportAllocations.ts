import type pg from "pg";
import { badRequest, conflict, notFound } from "./errors";
export interface AllocationDraft {
  studentId: string;
  routeId: string;
  stopId: string;
  effectiveFrom?: string;
  validUntil?: string | null;
  reminderDays?: number;
}
export async function createTransportAllocation(
  db: pg.PoolClient,
  school: string,
  user: string,
  today: string,
  input: AllocationDraft,
) {
  // One school lock gives bulk and individual requests the same capacity/identity serialization.
  await db.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [school]);
  const from = input.effectiveFrom ?? today;
  if (input.validUntil && input.validUntil < from)
    throw badRequest("Transport validity must end on or after its start");
  if (
    !(
      await db.query(
        `SELECT 1 FROM students WHERE school_id=$1 AND id=$2 AND status IN('active','applicant')`,
        [school, input.studentId],
      )
    ).rowCount
  )
    throw notFound("Student not found");
  const route = (
    await db.query<{
      vehicle_id: string | null;
      capacity: number | null;
      vehicle_status: string | null;
      vehicle_type: string | null;
      registration_number: string | null;
    }>(
      `SELECT r.vehicle_id,v.capacity,v.status AS vehicle_status,mt.code AS vehicle_type,v.registration_number FROM transport_routes r LEFT JOIN transport_vehicles v ON v.id=r.vehicle_id AND v.school_id=r.school_id LEFT JOIN transport_vehicle_profiles vp ON vp.school_id=v.school_id AND vp.vehicle_id=v.id LEFT JOIN institution_masters mt ON mt.school_id=vp.school_id AND mt.id=vp.vehicle_type_id WHERE r.school_id=$1 AND r.id=$2 AND r.status='active' FOR UPDATE OF r`,
      [school, input.routeId],
    )
  ).rows[0];
  if (!route) throw notFound("Active route not found");
  if (route.vehicle_status && route.vehicle_status !== "active")
    throw badRequest("The route vehicle is not active");
  if (
    route.registration_number &&
    /^\d{2}BH/.test(
      route.registration_number.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    )
  )
    throw badRequest(
      "BH-series vehicle requires non-transport use; choose a verified student transport vehicle",
    );
  if (route.vehicle_type === "non_transport")
    throw badRequest(
      "A non-transport/staff vehicle cannot be allocated to student transport",
    );
  if (
    !(
      await db.query(
        "SELECT 1 FROM transport_stops WHERE school_id=$1 AND route_id=$2 AND id=$3 AND retired_at IS NULL",
        [school, input.routeId, input.stopId],
      )
    ).rowCount
  )
    throw notFound("Stop not found on route");
  if (
    (
      await db.query(
        `SELECT 1 FROM student_transport_allocations WHERE school_id=$1 AND student_id=$2 AND status='active'`,
        [school, input.studentId],
      )
    ).rowCount
  )
    throw conflict(
      "Student already has an active transport allocation; end it or renew the current allocation",
    );
  if (route.vehicle_id && route.capacity !== null) {
    const count = Number(
      (
        await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM student_transport_allocations a JOIN transport_routes r ON r.school_id=a.school_id AND r.id=a.route_id WHERE a.school_id=$1 AND r.vehicle_id=$2 AND a.status='active'`,
          [school, route.vehicle_id],
        )
      ).rows[0]?.count ?? 0,
    );
    if (count >= route.capacity)
      throw conflict("Vehicle capacity is fully allocated across its routes");
  }
  return (
    await db.query<{ id: string }>(
      `INSERT INTO student_transport_allocations(school_id,student_id,route_id,stop_id,effective_from,valid_until,reminder_days,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        school,
        input.studentId,
        input.routeId,
        input.stopId,
        from,
        input.validUntil ?? null,
        input.reminderDays ?? 60,
        user,
      ],
    )
  ).rows[0]!.id;
}
