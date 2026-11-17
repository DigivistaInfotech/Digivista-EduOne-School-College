import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import { Button, Card, Field, Input } from "./ui";
interface Subscription {
  assigned: boolean;
  allocation: {
    id: string;
    routeName: string;
    routeCode: string;
    stopName: string;
    vehicleRegistration: string | null;
    driverName: string | null;
    driverPhone: string | null;
    pickup: string | null;
    drop: string | null;
    effectiveFrom: string;
    validUntil: string | null;
    reminderDays: number;
  } | null;
  tariff: {
    period: string;
    amount: string;
    feeHeadName: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  fees: {
    charged: number;
    allocatedPayments: number;
    outstanding: number | null;
    status: string;
    note: string;
  } | null;
  renewals: Array<{
    id: string;
    requestedUntil: string;
    status: string;
    reviewNote: string | null;
  }>;
  daysRemaining?: number | null;
  renewalDue?: boolean;
}
export function TransportSubscriptionPanel({
  studentId,
}: {
  studentId?: string;
}) {
  const school = useSchoolId();
  const qc = useQueryClient();
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const path = studentId
    ? `/api/schools/${school}/portal/children/${studentId}/transport`
    : `/api/schools/${school}/student/transport`;
  const key = ["transport-subscription", school, studentId ?? "self"];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<Subscription>(`${path}/subscription`),
  });
  const renew = useMutation({
    mutationFn: () =>
      api(`${path}/renewals`, {
        method: "POST",
        body: JSON.stringify({ requestedUntil: until, reason }),
      }),
    onSuccess: () => {
      setUntil("");
      setReason("");
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  return (
    <Card>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">
          Transport allocation, fees & renewal
        </h2>
        {query.isPending && <p>Loading the linked transport record…</p>}
        {query.error && <p role="alert">{errorMessage(query.error)}</p>}
        {query.data && !query.data.assigned && (
          <p>No active transport allocation is recorded for this student.</p>
        )}
        {query.data?.allocation && (
          <>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p>
                <strong>Route:</strong> {query.data.allocation.routeName} (
                {query.data.allocation.routeCode})<br />
                <strong>Stop:</strong> {query.data.allocation.stopName}
              </p>
              <p>
                <strong>Vehicle:</strong>{" "}
                {query.data.allocation.vehicleRegistration ?? "Not assigned"}
                <br />
                <strong>Driver:</strong>{" "}
                {query.data.allocation.driverName ?? "Not recorded"}{" "}
                {query.data.allocation.driverPhone ?? ""}
              </p>
              <p>
                <strong>Pickup:</strong>{" "}
                {query.data.allocation.pickup ?? "Not scheduled"}
                <br />
                <strong>Drop:</strong>{" "}
                {query.data.allocation.drop ?? "Not scheduled"}
              </p>
              <p>
                <strong>Active from:</strong>{" "}
                {formatDate(query.data.allocation.effectiveFrom)}
                <br />
                <strong>Valid until:</strong>{" "}
                {query.data.allocation.validUntil
                  ? formatDate(query.data.allocation.validUntil)
                  : "Not recorded — ask the transport desk"}
              </p>
            </div>
            {query.data.renewalDue && (
              <p
                role="status"
                className="rounded-xl bg-amber-50 p-3 font-semibold"
              >
                {(query.data.daysRemaining ?? 0) < 0
                  ? "Transport validity has expired."
                  : "Transport renewal is due soon."}{" "}
                {query.data.daysRemaining} days remaining.
              </p>
            )}
            {query.data.tariff ? (
              <p className="rounded-xl bg-slate-50 p-3 text-sm">
                <strong>Current route tariff:</strong>{" "}
                {formatMoney(Number(query.data.tariff.amount))} /{" "}
                {query.data.tariff.period} · {query.data.tariff.feeHeadName}.
                Effective {formatDate(query.data.tariff.effectiveFrom)}. This
                quoted tariff is separate from actual billed charges.
              </p>
            ) : (
              <p className="text-sm">
                A dated route tariff is not recorded yet; confirm the period and
                rate with the school.
              </p>
            )}
            {query.data.fees && (
              <div className="rounded-xl border p-3 text-sm">
                <p>
                  <strong>Central fee status:</strong>{" "}
                  {query.data.fees.status.replaceAll("_", " ")}
                </p>
                <p>
                  Transport charges: {formatMoney(query.data.fees.charged)} ·
                  Allocated payments:{" "}
                  {formatMoney(query.data.fees.allocatedPayments)} ·
                  Outstanding:{" "}
                  {query.data.fees.outstanding === null
                    ? "Finance review required"
                    : formatMoney(query.data.fees.outstanding)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {query.data.fees.note}
                </p>
              </div>
            )}
            <div className="space-y-3 border-t pt-3">
              <h3 className="font-semibold">Request transport renewal</h3>
              <p className="text-xs">
                A request does not approve renewal or collect a payment. The
                transport desk reviews it. Reminders appear here within the
                configured {query.data.allocation.reminderDays}-day window; no
                external message delivery is promised.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Requested validity until"
                  htmlFor="family-transport-until"
                >
                  <Input
                    id="family-transport-until"
                    type="date"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                </Field>
                <Field
                  label="Reason / notes (optional)"
                  htmlFor="family-transport-reason"
                >
                  <Input
                    id="family-transport-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                </Field>
              </div>
              <Button
                disabled={
                  !until ||
                  renew.isPending ||
                  query.data.renewals.some((r) => r.status === "pending")
                }
                onClick={() => renew.mutate()}
              >
                Submit renewal request
              </Button>
              {renew.error && <p role="alert">{errorMessage(renew.error)}</p>}
              {renew.isSuccess && (
                <p role="status">Renewal request sent for school review.</p>
              )}
              <ul className="space-y-1 text-sm">
                {query.data.renewals.map((r) => (
                  <li key={r.id}>
                    Until {formatDate(r.requestedUntil)}: {r.status}
                    {r.reviewNote ? ` · ${r.reviewNote}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
