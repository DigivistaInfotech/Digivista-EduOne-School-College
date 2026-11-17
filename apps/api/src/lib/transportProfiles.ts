import type pg from "pg";
import type { VehicleAuditProfile, MaintenanceAuditProfile } from "@erp/shared";
import { badRequest, notFound } from "./errors";
export async function assertTransportMaster(
  db: pg.PoolClient,
  school: string,
  id: string,
  kind: string,
  allowInactive = false,
) {
  const row = (
    await db.query<{ label: string; code: string }>(
      `SELECT label,code FROM institution_masters WHERE school_id=$1 AND id=$2 AND kind=$3 AND (active OR $4)`,
      [school, id, kind, allowInactive],
    )
  ).rows[0];
  if (!row)
    throw badRequest("Select an active transport master", {
      [kind]: ["Master is missing, inactive or belongs to another school"],
    });
  return row;
}
export async function saveVehicleProfile(
  db: pg.PoolClient,
  school: string,
  vehicle: string,
  profile: VehicleAuditProfile | undefined,
  registration: string,
) {
  if (!profile) return;
  const old = (
    await db.query<{
      audit_details: VehicleAuditProfile;
      model_id: string | null;
      vehicle_type_id: string | null;
      fuel_type_id: string | null;
    }>(
      "SELECT * FROM transport_vehicle_profiles WHERE school_id=$1 AND vehicle_id=$2",
      [school, vehicle],
    )
  ).rows[0];
  const supplied = Object.fromEntries(
    Object.entries(profile).filter(([, v]) => v !== undefined),
  ) as VehicleAuditProfile;
  const value = {
    ...(old?.audit_details ?? {}),
    modelId: old?.model_id,
    vehicleTypeId: old?.vehicle_type_id,
    fuelTypeId: old?.fuel_type_id,
    ...supplied,
  };
  let modelLabel: string | undefined;
  for (const [key, kind] of [
    ["modelId", "vehicle_model"],
    ["vehicleTypeId", "vehicle_type"],
    ["fuelTypeId", "fuel_type"],
  ] as const) {
    const id = value[key];
    if (!id) continue;
    const master = await assertTransportMaster(
      db,
      school,
      id,
      kind,
      id ===
        (key === "modelId"
          ? old?.model_id
          : key === "vehicleTypeId"
            ? old?.vehicle_type_id
            : old?.fuel_type_id),
    );
    if (key === "modelId") modelLabel = master.label;
    if (
      key === "vehicleTypeId" &&
      /^\d{2}BH/.test(
        registration.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      ) &&
      master.code !== "non_transport"
    )
      throw badRequest(
        "BH-series is not approval for a school transport vehicle. Select non-transport use and verify the RC.",
      );
  }
  await db.query(
    `INSERT INTO transport_vehicle_profiles(school_id,vehicle_id,model_id,vehicle_type_id,fuel_type_id,audit_details) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(school_id,vehicle_id) DO UPDATE SET model_id=excluded.model_id,vehicle_type_id=excluded.vehicle_type_id,fuel_type_id=excluded.fuel_type_id,audit_details=excluded.audit_details`,
    [
      school,
      vehicle,
      value.modelId ?? null,
      value.vehicleTypeId ?? null,
      value.fuelTypeId ?? null,
      JSON.stringify(value),
    ],
  );
  if (modelLabel)
    await db.query(
      "UPDATE transport_vehicles SET model=$3 WHERE school_id=$1 AND id=$2",
      [school, vehicle, modelLabel],
    );
}
export async function validateMaintenanceProfile(
  db: pg.PoolClient,
  school: string,
  profile: MaintenanceAuditProfile | undefined,
  vendorId: string | null | undefined,
  expenseId: string | null | undefined,
  cost: number,
) {
  if (profile?.serviceTypeId)
    await assertTransportMaster(
      db,
      school,
      profile.serviceTypeId,
      "maintenance_type",
    );
  if (
    vendorId &&
    !(
      await db.query(
        `SELECT 1 FROM vendors WHERE school_id=$1 AND id=$2 AND status='active'`,
        [school, vendorId],
      )
    ).rowCount
  )
    throw notFound("Active vendor not found");
  let total = cost;
  if (
    profile &&
    (profile.partsCost !== undefined || profile.labourCost !== undefined)
  ) {
    const taxable = (profile.partsCost ?? 0) + (profile.labourCost ?? 0);
    total =
      Math.round(
        (taxable + Math.round(taxable * (profile.gstPercent ?? 0)) / 100) * 100,
      ) / 100;
  }
  if (
    profile &&
    total > 0 &&
    !profile.invoiceNumber &&
    !profile.jobCardNumber &&
    !expenseId
  )
    throw badRequest(
      "A costed maintenance entry needs an invoice, job-card or existing expense reference",
    );
  if (
    profile?.nextServiceKm !== undefined &&
    profile.nextServiceKm !== null &&
    profile.odometerKm !== undefined &&
    profile.odometerKm !== null &&
    profile.nextServiceKm <= profile.odometerKm
  )
    throw badRequest(
      "Next service kilometre reading must exceed the current odometer",
    );
  if (
    profile &&
    total > 0 &&
    !profile.invoiceNumber &&
    !profile.jobCardNumber &&
    !expenseId
  )
    throw badRequest(
      "A costed maintenance entry needs an invoice, job-card or existing expense reference",
    );
  if (expenseId) {
    const expense = (
      await db.query<{
        amount: string;
        vendor_id: string | null;
        status: string;
      }>(
        "SELECT amount,vendor_id,status FROM procurement_expenses WHERE school_id=$1 AND id=$2",
        [school, expenseId],
      )
    ).rows[0];
    if (!expense || expense.status === "void")
      throw notFound("Active expense not found");
    if (Math.round(Number(expense.amount) * 100) !== Math.round(total * 100))
      throw badRequest(
        "Linked expense amount must equal the maintenance total",
      );
    if (vendorId && expense.vendor_id !== vendorId)
      throw badRequest(
        "Linked expense vendor must match the maintenance vendor",
      );
  }
  return total;
}
