import type pg from "pg";
import { badRequest } from "./errors";
import { createTransportAllocation } from "./transportAllocations";
export function parseTransportCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      if (cell !== "") throw badRequest("Quote must start a CSV cell");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (quoted) throw badRequest("Unclosed CSV quote");
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
interface PreviewRow {
  row: number;
  admissionNumber: string;
  studentName: string;
  routeName: string;
  stopName: string;
  studentId: string;
  routeId: string;
  stopId: string;
  effectiveFrom: string;
  validUntil: string | null;
  reminderDays: number;
  action: "create" | "unchanged";
  paymentReference: string;
  paymentVerified: boolean;
  errors: string[];
}
export async function previewTransportBulk(
  db: pg.PoolClient,
  school: string,
  csv: string,
  today: string,
) {
  const raw = parseTransportCsv(csv);
  const header = raw.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const allowed = [
    "admission_number",
    "route_code",
    "stop_sequence",
    "effective_from",
    "valid_until",
    "reminder_days",
    "payment_reference",
  ];
  if (
    !["admission_number", "route_code", "stop_sequence"].every((k) =>
      header.includes(k),
    )
  )
    throw badRequest(
      "CSV needs admission_number, route_code and stop_sequence headers",
    );
  if (
    new Set(header).size !== header.length ||
    header.some((k) => !allowed.includes(k))
  )
    throw badRequest(
      "Use only the template headers. Paid flags are not accepted; payment_reference is checked against the central ledger.",
    );
  if (raw.length < 1 || raw.length > 500)
    throw badRequest("Import between 1 and 500 rows");
  const result: PreviewRow[] = [];
  const studentsSeen = new Set<string>();
  const vehicleAdds = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const values = raw[i]!;
    const cell = (k: string) => values[header.indexOf(k)]?.trim() ?? "";
    const from = cell("effective_from") || today;
    const until = cell("valid_until") || null;
    const reminder = Number(cell("reminder_days") || 60);
    const item: PreviewRow = {
      row: i + 2,
      admissionNumber: cell("admission_number"),
      studentName: "",
      routeName: "",
      stopName: "",
      studentId: "",
      routeId: "",
      stopId: "",
      effectiveFrom: from,
      validUntil: until,
      reminderDays: reminder,
      action: "create",
      paymentReference: cell("payment_reference"),
      paymentVerified: false,
      errors: [],
    };
    if (values.length !== header.length)
      item.errors.push("Column count differs from header");
    if (!isDate(from) || (until && !isDate(until)))
      item.errors.push("Use valid YYYY-MM-DD dates");
    if (until && until < from)
      item.errors.push("Validity ends before allocation starts");
    if (!Number.isInteger(reminder) || reminder < 1 || reminder > 180)
      item.errors.push("Reminder days must be 1–180");
    const students = (
      await db.query<{ id: string; name: string }>(
        `SELECT id,concat_ws(' ',first_name,last_name) AS name FROM students WHERE school_id=$1 AND lower(admission_number)=lower($2) AND status IN('active','applicant')`,
        [school, item.admissionNumber],
      )
    ).rows;
    if (students.length !== 1)
      item.errors.push("Admission number is missing, ambiguous or inactive");
    else {
      item.studentId = students[0]!.id;
      item.studentName = students[0]!.name;
      if (studentsSeen.has(item.studentId))
        item.errors.push("Student appears twice in import");
      studentsSeen.add(item.studentId);
    }
    const routes = (
      await db.query<{
        id: string;
        name: string;
        vehicle_id: string | null;
        capacity: number | null;
        status: string | null;
        registration_number: string | null;
        vehicle_type: string | null;
      }>(
        `SELECT r.id,r.name,r.vehicle_id,v.capacity,v.status,v.registration_number,mt.code AS vehicle_type FROM transport_routes r LEFT JOIN transport_vehicles v ON v.school_id=r.school_id AND v.id=r.vehicle_id LEFT JOIN transport_vehicle_profiles vp ON vp.school_id=v.school_id AND vp.vehicle_id=v.id LEFT JOIN institution_masters mt ON mt.school_id=vp.school_id AND mt.id=vp.vehicle_type_id WHERE r.school_id=$1 AND lower(r.code)=lower($2) AND r.status='active'`,
        [school, cell("route_code")],
      )
    ).rows;
    const route = routes.length === 1 ? routes[0] : undefined;
    if (!route) item.errors.push("Active route code not found");
    else {
      item.routeId = route.id;
      item.routeName = route.name;
      if (
        route.vehicle_type === "non_transport" ||
        (route.registration_number &&
          /^\d{2}BH/.test(
            route.registration_number
              .replace(/[^A-Za-z0-9]/g, "")
              .toUpperCase(),
          ))
      )
        item.errors.push(
          "Choose a student transport vehicle; non-transport/BH use is not eligible",
        );
      if (route.status && route.status !== "active")
        item.errors.push("Vehicle is not active");
      const sequence = Number(cell("stop_sequence"));
      const stop = (
        await db.query<{ id: string; name: string }>(
          "SELECT id,name FROM transport_stops WHERE school_id=$1 AND route_id=$2 AND sequence_no=$3 AND retired_at IS NULL",
          [school, route.id, Number.isInteger(sequence) ? sequence : -1],
        )
      ).rows[0];
      if (!stop) item.errors.push("Stop sequence is not on this route");
      else {
        item.stopId = stop.id;
        item.stopName = stop.name;
      }
    }
    if (item.studentId) {
      const existing = (
        await db.query<{ route_id: string; stop_id: string }>(
          `SELECT route_id,stop_id FROM student_transport_allocations WHERE school_id=$1 AND student_id=$2 AND status='active'`,
          [school, item.studentId],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.route_id === item.routeId &&
          existing.stop_id === item.stopId
        )
          item.action = "unchanged";
        else
          item.errors.push(
            "Student already has a different active allocation; use the end/change workflow",
          );
      }
    }
    if (
      route?.vehicle_id &&
      route.capacity !== null &&
      item.action === "create"
    ) {
      const existingCount = Number(
        (
          await db.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM student_transport_allocations a JOIN transport_routes r ON r.school_id=a.school_id AND r.id=a.route_id WHERE a.school_id=$1 AND r.vehicle_id=$2 AND a.status='active'`,
            [school, route.vehicle_id],
          )
        ).rows[0]?.count ?? 0,
      );
      const additions = (vehicleAdds.get(route.vehicle_id) ?? 0) + 1;
      vehicleAdds.set(route.vehicle_id, additions);
      if (existingCount + additions > route.capacity)
        item.errors.push("Batch would exceed vehicle capacity across routes");
    }
    if (item.paymentReference && item.studentId) {
      item.paymentVerified = !!(
        await db.query(
          `SELECT 1 FROM payments p JOIN payment_allocations pa ON pa.school_id=p.school_id AND pa.payment_id=p.id JOIN student_charges c ON c.school_id=pa.school_id AND c.id=pa.charge_id JOIN fee_heads f ON f.school_id=c.school_id AND f.id=c.fee_head_id WHERE p.school_id=$1 AND p.student_id=$2 AND p.status='recorded' AND (p.reference=$3 OR p.receipt_number=$3) AND (f.code ILIKE '%transport%' OR f.name ILIKE '%transport%')`,
          [school, item.studentId, item.paymentReference],
        )
      ).rowCount;
      if (!item.paymentVerified)
        item.errors.push(
          "Payment reference is not a recorded transport payment for this student",
        );
    }
    result.push(item);
  }
  return {
    rows: result,
    valid: result.every((r) => r.errors.length === 0),
    createCount: result.filter(
      (r) => r.action === "create" && r.errors.length === 0,
    ).length,
    unchangedCount: result.filter(
      (r) => r.action === "unchanged" && r.errors.length === 0,
    ).length,
  };
}
export async function commitTransportBulk(
  db: pg.PoolClient,
  school: string,
  user: string,
  csv: string,
  today: string,
) {
  await db.query("SELECT id FROM schools WHERE id=$1 FOR UPDATE", [school]);
  const preview = await previewTransportBulk(db, school, csv, today);
  if (!preview.valid)
    throw badRequest("Import has errors. Preview again before applying.");
  let created = 0;
  for (const row of preview.rows) {
    if (row.action === "unchanged") continue;
    await createTransportAllocation(db, school, user, today, row);
    created++;
  }
  return { ...preview, created };
}
function isDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
