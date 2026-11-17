import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatDate, formatMoney, todayIso } from "../lib/format";
import { Button, Card, Field, Input, Select, Textarea } from "./ui";
import { useTransportLookups } from "./TransportAuditFields";
interface Route {
  id: string;
  name: string;
}
interface Tariff {
  id: string;
  routeName: string;
  feeHeadName: string;
  period: string;
  amount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  authorityReference: string | null;
}
export function TransportTariffs({ routes }: { routes: Route[] }) {
  const school = useSchoolId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const lookups = useTransportLookups();
  const [route, setRoute] = useState("");
  const [head, setHead] = useState("");
  const [period, setPeriod] = useState("monthly");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(todayIso());
  const [until, setUntil] = useState("");
  const [reference, setReference] = useState("");
  const [closeDate, setCloseDate] = useState(todayIso());
  const query = useQuery({
    queryKey: ["transport-tariffs", school],
    queryFn: () =>
      api<{ items: Tariff[] }>(`/api/schools/${school}/transport/tariffs`),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${school}/transport/tariffs`, {
        method: "POST",
        body: JSON.stringify({
          routeId: route,
          feeHeadId: head,
          period,
          amount: Number(amount),
          effectiveFrom: from,
          effectiveTo: until || null,
          authorityReference: reference || undefined,
        }),
      }),
    onSuccess: () => {
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["transport-tariffs", school] });
    },
  });
  const close = useMutation({
    mutationFn: (id: string) =>
      api(`/api/schools/${school}/transport/tariffs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ effectiveTo: closeDate }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["transport-tariffs", school] });
    },
  });
  return (
    <Card>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">Route tariff master</h2>
        <p className="text-sm">
          A route tariff is an approved price and period, separate from the
          actual student fee ledger. It never marks a student paid and never
          creates a second charge automatically. Keep previous tariffs as
          history; close their date range before a new rate starts.
        </p>
        {can("transport.manage") && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Route" htmlFor="tariff-route" required>
                <Select
                  id="tariff-route"
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                >
                  <option value="">Select route</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Transport fee head" htmlFor="tariff-head" required>
                <Select
                  id="tariff-head"
                  value={head}
                  onChange={(e) => setHead(e.target.value)}
                >
                  <option value="">Select transport head</option>
                  {lookups.data?.feeHeads.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Billing period" htmlFor="tariff-period" required>
                <Select
                  id="tariff-period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  {["monthly", "term", "annual", "one_time"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount (₹)" htmlFor="tariff-amount" required>
                <Input
                  id="tariff-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Effective from" htmlFor="tariff-from" required>
                <Input
                  id="tariff-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="Effective until (optional)" htmlFor="tariff-until">
                <Input
                  id="tariff-until"
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </Field>
              <Field
                label="Approval / policy reference (optional)"
                htmlFor="tariff-ref"
              >
                <Input
                  id="tariff-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
            </div>
            <Button
              disabled={
                !route || !head || amount === "" || !from || save.isPending
              }
              onClick={() => save.mutate()}
            >
              Add tariff period
            </Button>
            <Field label="Close a previous tariff on" htmlFor="tariff-close">
              <Input
                id="tariff-close"
                type="date"
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
              />
            </Field>
          </>
        )}
        {(query.error || save.error || close.error) && (
          <p role="alert">
            {errorMessage(query.error || save.error || close.error)}
          </p>
        )}
        <div className="overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Route / fee head</th>
                <th>Amount / period</th>
                <th>Effective dates</th>
                <th>Reference</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.routeName}
                    <small className="block">{t.feeHeadName}</small>
                  </td>
                  <td>
                    {formatMoney(Number(t.amount))} / {t.period}
                  </td>
                  <td>
                    {formatDate(t.effectiveFrom)} —{" "}
                    {t.effectiveTo ? formatDate(t.effectiveTo) : "Open-ended"}
                  </td>
                  <td>{t.authorityReference ?? "—"}</td>
                  <td>
                    {can("transport.manage") && (
                      <Button
                        variant="secondary"
                        disabled={!closeDate || close.isPending}
                        onClick={() => close.mutate(t.id)}
                      >
                        Close date range
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
interface BulkRow {
  row: number;
  admissionNumber: string;
  studentName: string;
  routeName: string;
  stopName: string;
  action: string;
  paymentReference: string;
  paymentVerified: boolean;
  errors: string[];
}
interface BulkPreview {
  valid: boolean;
  createCount: number;
  unchangedCount: number;
  created?: number;
  rows: BulkRow[];
}
export function TransportBulkImport() {
  const school = useSchoolId();
  const qc = useQueryClient();
  const [csv, setCsv] = useState(
    "admission_number,route_code,stop_sequence,effective_from,valid_until,reminder_days,payment_reference\n",
  );
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [applied, setApplied] = useState(false);
  const mutation = useMutation({
    mutationFn: (mode: "preview" | "commit") =>
      api<BulkPreview>(`/api/schools/${school}/transport/allocations/bulk`, {
        method: "POST",
        body: JSON.stringify({ csv, mode, confirmPreview: mode === "commit" }),
      }),
    onSuccess: (data, mode) => {
      setPreview(data);
      setApplied(mode === "commit");
      if (mode === "commit") {
        void qc.invalidateQueries({
          queryKey: ["transport-allocations", school],
        });
        void qc.invalidateQueries({ queryKey: ["transport-routes", school] });
        void qc.invalidateQueries({ queryKey: ["transport-due", school] });
      }
    },
  });
  return (
    <Card>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-bold">Bulk transport allocation</h2>
        <p className="text-sm">
          Use existing admission numbers, route codes and stop sequence numbers.
          Preview checks duplicates, dates and capacity across every route
          sharing a vehicle. Existing identical allocations remain unchanged;
          use renewal/change workflow for their dates. A paid flag is never
          imported; optional payment_reference is checked against recorded
          transport payments.
        </p>
        <Field label="Upload allocation CSV" htmlFor="transport-csv-file">
          <Input
            id="transport-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                setCsv(await file.text());
                setPreview(null);
                setApplied(false);
              }
            }}
          />
        </Field>
        <Field label="CSV content / template" htmlFor="transport-csv">
          <Textarea
            id="transport-csv"
            rows={7}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
              setApplied(false);
            }}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={mutation.isPending || !csv.trim()}
            onClick={() => mutation.mutate("preview")}
          >
            Preview import
          </Button>
          <Button
            disabled={!preview?.valid || mutation.isPending || applied}
            onClick={() => mutation.mutate("commit")}
          >
            Apply reviewed allocations
          </Button>
        </div>
        {mutation.error && <p role="alert">{errorMessage(mutation.error)}</p>}
        {preview && (
          <>
            <p role="status">
              {applied
                ? `Applied ${preview.created ?? preview.createCount} new allocations.`
                : `Preview: ${preview.createCount} new; ${preview.unchangedCount} unchanged.`}{" "}
              {preview.valid
                ? "No row errors."
                : "Correct the row errors before applying."}
            </p>
            <div className="overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row / student</th>
                    <th>Route / stop</th>
                    <th>Action</th>
                    <th>Payment reference</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.row}>
                      <td>
                        {r.row} · {r.admissionNumber}
                        <small className="block">{r.studentName}</small>
                      </td>
                      <td>
                        {r.routeName} · {r.stopName}
                      </td>
                      <td>{r.action}</td>
                      <td>
                        {r.paymentReference
                          ? r.paymentVerified
                            ? "Reference verified"
                            : "Unverified reference"
                          : "Not supplied"}
                      </td>
                      <td>{r.errors.join("; ") || "Valid"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
interface Renewal {
  id: string;
  studentName: string;
  admissionNumber: string;
  routeName: string;
  requestedUntil: string;
  validUntil: string | null;
  reason: string;
  status: string;
}
interface Due {
  today: string;
  allocations: Array<{
    id: string;
    studentName: string;
    admissionNumber: string;
    routeName: string;
    validUntil: string;
    daysRemaining: number;
    reminderDays: number;
  }>;
  vehicles: Array<{
    id: string;
    registrationNumber: string;
    insuranceExpiresOn: string | null;
    profile?: {
      permitExpiresOn?: string;
      fitnessExpiresOn?: string;
      pucExpiresOn?: string;
    };
  }>;
}
export function TransportRenewals() {
  const school = useSchoolId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const renewals = useQuery({
    queryKey: ["transport-renewals", school],
    queryFn: () =>
      api<{ items: Renewal[] }>(`/api/schools/${school}/transport/renewals`),
  });
  const due = useQuery({
    queryKey: ["transport-due", school],
    queryFn: () => api<Due>(`/api/schools/${school}/transport/renewal-due`),
  });
  const review = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "reject" }) =>
      api(`/api/schools/${school}/transport/renewals/${v.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: v.decision, note }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["transport-renewals", school] });
      void qc.invalidateQueries({ queryKey: ["transport-due", school] });
      void qc.invalidateQueries({
        queryKey: ["transport-allocations", school],
      });
    },
  });
  const upcoming = (date: string | null | undefined) =>
    !!date &&
    !!due.data &&
    date <=
      new Date(Date.parse(due.data.today + "T00:00:00Z") + 60 * 86400000)
        .toISOString()
        .slice(0, 10);
  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-5">
          <h2 className="text-lg font-bold">Transport renewal due list</h2>
          <p className="text-sm">
            Per-allocation reminder window is normally 30 or 60 days. Expired
            and soon-due records appear here and in the family portal. No
            external SMS/WhatsApp/email has been sent.
          </p>
          <div className="overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Route</th>
                  <th>Valid until</th>
                  <th>Days remaining</th>
                </tr>
              </thead>
              <tbody>
                {due.data?.allocations.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.studentName}
                      <small className="block">{a.admissionNumber}</small>
                    </td>
                    <td>{a.routeName}</td>
                    <td>{formatDate(a.validUntil)}</td>
                    <td>
                      {a.daysRemaining < 0
                        ? `${-a.daysRemaining} days overdue`
                        : a.daysRemaining}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="font-semibold">
            Vehicle document dates within 60 days / overdue
          </h3>
          <ul className="space-y-1 text-sm">
            {due.data?.vehicles.flatMap((v) =>
              [
                ["Insurance", v.insuranceExpiresOn],
                ["Permit", v.profile?.permitExpiresOn],
                ["Fitness", v.profile?.fitnessExpiresOn],
                ["PUC", v.profile?.pucExpiresOn],
              ]
                .filter(([, date]) => upcoming(date))
                .map(([label, date]) => (
                  <li key={v.id + label}>
                    {v.registrationNumber} · {label}: {formatDate(date)}
                  </li>
                )),
            )}
          </ul>
        </div>
      </Card>
      <Card>
        <div className="space-y-3 p-5">
          <h2 className="text-lg font-bold">Renewal requests</h2>
          {can("transport.allocate") && (
            <Field
              label="Review note for approval / rejection"
              htmlFor="renewal-review-note"
              required
            >
              <Input
                id="renewal-review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            </Field>
          )}
          <div className="overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student / route</th>
                  <th>Current validity</th>
                  <th>Requested until</th>
                  <th>Reason</th>
                  <th>Status / review</th>
                </tr>
              </thead>
              <tbody>
                {renewals.data?.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.studentName}
                      <small className="block">
                        {r.admissionNumber} · {r.routeName}
                      </small>
                    </td>
                    <td>{formatDate(r.validUntil)}</td>
                    <td>{formatDate(r.requestedUntil)}</td>
                    <td>{r.reason || "—"}</td>
                    <td>
                      {r.status}
                      {can("transport.allocate") && r.status === "pending" && (
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            disabled={
                              note.trim().length < 3 || review.isPending
                            }
                            onClick={() =>
                              review.mutate({ id: r.id, decision: "approve" })
                            }
                          >
                            Approve renewal
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              note.trim().length < 3 || review.isPending
                            }
                            onClick={() =>
                              review.mutate({ id: r.id, decision: "reject" })
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(due.error || renewals.error || review.error) && (
            <p role="alert">
              {errorMessage(due.error || renewals.error || review.error)}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
