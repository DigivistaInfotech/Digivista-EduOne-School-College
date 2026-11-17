import { useQuery } from "@tanstack/react-query";
import type { VehicleAuditProfile, MaintenanceAuditProfile } from "@erp/shared";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { Field, Input, Select } from "./ui";
export interface TransportLookups {
  masters: Array<{
    id: string;
    kind: string;
    code: string;
    label: string;
    active: boolean;
    notes: string;
  }>;
  feeHeads: Array<{ id: string; code: string; name: string }>;
  vendors: Array<{ id: string; name: string }>;
}
export function useTransportLookups() {
  const school = useSchoolId();
  return useQuery({
    queryKey: ["transport-lookups", school],
    queryFn: () =>
      api<TransportLookups>(`/api/schools/${school}/transport/lookups`),
    staleTime: 60000,
  });
}
export function VehicleAuditFields({
  value,
  onChange,
  newVehicle,
}: {
  value: VehicleAuditProfile;
  onChange: (v: VehicleAuditProfile) => void;
  newVehicle: boolean;
}) {
  const query = useTransportLookups();
  const set = (key: keyof VehicleAuditProfile, v: string | number | null) =>
    onChange({ ...value, [key]: v });
  return (
    <div className="space-y-4 rounded-xl border bg-slate-50 p-4">
      <h3 className="font-semibold">Vehicle classification & audit details</h3>
      <p className="text-xs">
        Select verified master labels. Capacity, fuel and vehicle use must match
        the RC; model family does not establish capacity. Registration
        validation checks syntax only, not VAHAN registration or school-bus
        approval. BH-series is for eligible non-transport vehicles.
      </p>
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["modelId", "vehicle_model", "Model master"],
            ["vehicleTypeId", "vehicle_type", "Vehicle type"],
            ["fuelTypeId", "fuel_type", "Fuel type"],
          ] as const
        ).map(([key, kind, label]) => (
          <Field
            key={key}
            label={label}
            htmlFor={"veh-profile-" + key}
            required={newVehicle}
          >
            <Select
              id={"veh-profile-" + key}
              value={value[key] ?? ""}
              required={newVehicle}
              onChange={(e) => set(key, e.target.value || null)}
            >
              <option value="">
                {newVehicle ? "Select master value" : "Legacy / not classified"}
              </option>
              {query.data?.masters
                .filter(
                  (m) => m.kind === kind && (m.active || m.id === value[key]),
                )
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.active ? "" : " (inactive)"}
                  </option>
                ))}
            </Select>
          </Field>
        ))}
        <Field label="Ownership" htmlFor="veh-ownership">
          <Select
            id="veh-ownership"
            value={value.ownership ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                ownership: e.target.value
                  ? (e.target.value as VehicleAuditProfile["ownership"])
                  : undefined,
              })
            }
          >
            <option value="">Not recorded</option>
            <option value="owned">School owned</option>
            <option value="leased">Leased</option>
            <option value="contracted">Contracted operator</option>
          </Select>
        </Field>
        {(
          [
            ["ownerName", "Owner / operator name"],
            ["rcReference", "RC / document reference"],
            ["insurancePolicyNumber", "Insurance policy number"],
            ["permitNumber", "Permit number"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label} htmlFor={"veh-" + key}>
            <Input
              id={"veh-" + key}
              value={value[key] ?? ""}
              onChange={(e) => set(key, e.target.value)}
              maxLength={key === "ownerName" ? 160 : 100}
            />
          </Field>
        ))}
        {(
          [
            ["permitExpiresOn", "Permit expiry"],
            ["fitnessExpiresOn", "Fitness expiry"],
            ["pucExpiresOn", "PUC expiry"],
            ["taxPaidUntil", "Tax paid until"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label} htmlFor={"veh-" + key}>
            <Input
              id={"veh-" + key}
              type="date"
              value={value[key] ?? ""}
              onChange={(e) => set(key, e.target.value || null)}
            />
          </Field>
        ))}
        {(
          [
            ["manufactureYear", "Manufacture year"],
            ["odometerKm", "Odometer (km)"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label} htmlFor={"veh-" + key}>
            <Input
              id={"veh-" + key}
              type="number"
              min={key === "manufactureYear" ? 1950 : 0}
              max={key === "manufactureYear" ? 2100 : 9999999}
              value={value[key] ?? ""}
              onChange={(e) =>
                set(key, e.target.value === "" ? null : Number(e.target.value))
              }
            />
          </Field>
        ))}
      </div>
    </div>
  );
}
export function MaintenanceAuditFields({
  value,
  onChange,
  vendorId,
  onVendorChange,
  expenseId,
  onExpenseChange,
}: {
  value: MaintenanceAuditProfile;
  onChange: (v: MaintenanceAuditProfile) => void;
  vendorId: string;
  onVendorChange: (id: string, label: string) => void;
  expenseId: string;
  onExpenseChange: (id: string) => void;
}) {
  const query = useTransportLookups();
  const set = (key: keyof MaintenanceAuditProfile, v: string | number | null) =>
    onChange({ ...value, [key]: v });
  const taxable = (value.partsCost ?? 0) + (value.labourCost ?? 0);
  const tax = Math.round(taxable * (value.gstPercent ?? 0)) / 100;
  return (
    <div className="space-y-3 rounded-xl border bg-slate-50 p-4">
      <h3 className="font-semibold">Service, invoice & next-service audit</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Service / job type" htmlFor="mnt-job-type" required>
          <Select
            id="mnt-job-type"
            required
            value={value.serviceTypeId ?? ""}
            onChange={(e) => set("serviceTypeId", e.target.value || null)}
          >
            <option value="">Select job type</option>
            {query.data?.masters
              .filter((m) => m.kind === "maintenance_type" && m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Linked vendor / garage" htmlFor="mnt-vendor-id">
          <Select
            id="mnt-vendor-id"
            value={vendorId}
            onChange={(e) =>
              onVendorChange(
                e.target.value,
                query.data?.vendors.find((v) => v.id === e.target.value)
                  ?.name ?? "",
              )
            }
          >
            <option value="">No linked vendor / use legacy name</option>
            {query.data?.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        {(
          [
            ["jobCardNumber", "Job card / work order"],
            ["invoiceNumber", "Vendor invoice number"],
            ["paymentReference", "Payment / settlement reference"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key} htmlFor={"mnt-" + key}>
            <Input
              id={"mnt-" + key}
              maxLength={key === "paymentReference" ? 120 : 100}
              value={value[key] ?? ""}
              onChange={(e) => set(key, e.target.value)}
            />
          </Field>
        ))}
        {(
          [
            ["odometerKm", "Odometer at service (km)"],
            ["partsCost", "Parts / materials (₹)"],
            ["labourCost", "Labour (₹)"],
            ["gstPercent", "GST from invoice (%)"],
            ["nextServiceKm", "Next service at (km)"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key} htmlFor={"mnt-" + key}>
            <Input
              id={"mnt-" + key}
              type="number"
              min="0"
              max={key === "gstPercent" ? 100 : 9999999}
              step={key === "odometerKm" || key === "nextServiceKm" ? 1 : 0.01}
              value={value[key] ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  [key]:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </Field>
        ))}
        {(
          [
            ["invoiceDate", "Invoice date"],
            ["nextServiceOn", "Next service date"],
            ["warrantyUntil", "Repair warranty until"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key} htmlFor={"mnt-" + key}>
            <Input
              id={"mnt-" + key}
              type="date"
              value={value[key] ?? ""}
              onChange={(e) => set(key, e.target.value || null)}
            />
          </Field>
        ))}
        <Field
          label="Existing expense record ID (optional)"
          htmlFor="mnt-expense-id"
        >
          <Input
            id="mnt-expense-id"
            value={expenseId}
            onChange={(e) => onExpenseChange(e.target.value)}
            placeholder="Link an already recorded expense"
          />
        </Field>
      </div>
      {(value.partsCost !== undefined || value.labourCost !== undefined) && (
        <p className="font-semibold text-sm">
          Subtotal ₹{taxable.toFixed(2)} + GST ₹{tax.toFixed(2)} = ₹
          {(taxable + tax).toFixed(2)}
        </p>
      )}
      <p className="text-xs">
        For a costed service, provide an invoice, job-card or linked expense
        reference. GST comes from the supplier invoice; no default 18% is
        assumed. Recording maintenance does not post an expense or payment. Link
        the existing expense to keep the audit trail without counting it twice.
      </p>
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
    </div>
  );
}

export function SavedVehicleAudit({
  profile,
  masters,
}: {
  profile: VehicleAuditProfile | undefined;
  masters: TransportLookups["masters"];
}) {
  if (!profile || !Object.keys(profile).length) return null;
  const lookup = (id: string | null | undefined) =>
    masters.find((m) => m.id === id)?.label ?? "Not recorded";
  return (
    <details className="mt-1 text-xs font-normal">
      <summary className="cursor-pointer text-teal-700">Audit details</summary>
      <dl className="mt-2 space-y-1">
        <div>
          Type: {lookup(profile.vehicleTypeId)} · Fuel:{" "}
          {lookup(profile.fuelTypeId)}
        </div>
        <div>
          Owner/operator: {profile.ownerName ?? "Not recorded"} ·{" "}
          {profile.ownership ?? "Ownership not recorded"}
        </div>
        <div>
          RC: {profile.rcReference ?? "—"} · Manufacture year:{" "}
          {profile.manufactureYear ?? "—"} · Odometer:{" "}
          {profile.odometerKm ?? "—"} km
        </div>
        <div>Insurance policy: {profile.insurancePolicyNumber ?? "—"}</div>
        <div>
          Permit: {profile.permitNumber ?? "—"} · Expiry:{" "}
          {profile.permitExpiresOn ?? "—"}
        </div>
        <div>
          Fitness: {profile.fitnessExpiresOn ?? "—"} · PUC:{" "}
          {profile.pucExpiresOn ?? "—"} · Tax paid until:{" "}
          {profile.taxPaidUntil ?? "—"}
        </div>
      </dl>
    </details>
  );
}
export function SavedMaintenanceAudit({
  profile,
  vendorId,
  expenseId,
  masters,
}: {
  profile: MaintenanceAuditProfile | undefined;
  vendorId?: string | null;
  expenseId?: string | null;
  masters: TransportLookups["masters"];
}) {
  if (!profile || (!Object.keys(profile).length && !vendorId && !expenseId))
    return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-teal-700">
        Full service audit
      </summary>
      <dl className="mt-2 space-y-1">
        <div>
          Service:{" "}
          {masters.find((m) => m.id === profile.serviceTypeId)?.label ??
            "Legacy / unclassified"}{" "}
          · Odometer: {profile.odometerKm ?? "—"} km
        </div>
        <div>
          Job card: {profile.jobCardNumber ?? "—"} · Invoice:{" "}
          {profile.invoiceNumber ?? "—"} ·{" "}
          {profile.invoiceDate ?? "Date not recorded"}
        </div>
        <div>
          Parts/materials: {profile.partsCost ?? "—"} · Labour:{" "}
          {profile.labourCost ?? "—"} · Invoice GST: {profile.gstPercent ?? "—"}
          %
        </div>
        <div>
          Payment reference: {profile.paymentReference ?? "—"} · Repair
          warranty: {profile.warrantyUntil ?? "—"}
        </div>
        <div>
          Next service: {profile.nextServiceOn ?? "Date not recorded"} /{" "}
          {profile.nextServiceKm ?? "km not recorded"}
        </div>
        <div className="break-all">
          Linked vendor: {vendorId ?? "—"} · Existing expense:{" "}
          {expenseId ?? "Not linked; no expense posted by this record"}
        </div>
      </dl>
    </details>
  );
}
