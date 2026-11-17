import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeeLedger } from "@erp/shared";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatMoney, todayIso } from "../lib/format";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from "../components/ui";
interface Collection {
  policy: {
    management: string;
    collectionEnabled: boolean;
    feeCollectionMode: string;
  };
  students: Array<{
    id: string;
    name: string;
    admissionNumber: string;
    className: string;
    sectionName: string;
  }>;
  entries: Array<{
    id: string;
    studentId: string;
    amount: string;
    reference: string;
    date: string;
    status: string;
  }>;
}
export function FeeCollectionPage() {
  const school = useSchoolId();
  const qc = useQueryClient();
  const [student, setStudent] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(todayIso("Asia/Kolkata"));
  const [method, setMethod] = useState("cash");
  const query = useQuery({
    queryKey: ["fee-collection", school],
    queryFn: () => api<Collection>(`/api/schools/${school}/fee-collection`),
  });
  const ledger = useQuery({
    queryKey: ["fee-collection-ledger", school, student],
    queryFn: () =>
      api<FeeLedger>(`/api/schools/${school}/fee-collection/${student}/ledger`),
    enabled: !!student,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${school}/fee-collection`, {
        method: "POST",
        body: JSON.stringify({
          studentId: student,
          amount: Number(amount),
          reference,
          date,
          method,
        }),
      }),
    onSuccess: () => {
      setAmount("");
      setReference("");
      void qc.invalidateQueries({ queryKey: ["fee-collection", school] });
      void qc.invalidateQueries({
        queryKey: ["fee-collection-ledger", school],
      });
    },
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Assigned fee collection"
        description="Select an existing student from your permitted scope. Collection entries join the existing finance verification queue; no duplicate student or payment ledger is created."
      />
      {query.data && (
        <p className="rounded-xl bg-teal-50 p-4">
          {query.data.policy.management} ·{" "}
          {query.data.policy.feeCollectionMode === "assigned_teacher"
            ? "Assigned teacher collection"
            : "Central collection department"}{" "}
          ·{" "}
          {query.data.policy.collectionEnabled
            ? "Configured; effective date and authority checked on save"
            : "Collection disabled until authorised in Institution masters"}
        </p>
      )}
      <Card>
        <div className="space-y-4 p-5">
          <Field
            label="Student / admission number"
            htmlFor="collection-student"
          >
            <Select
              id="collection-student"
              value={student}
              onChange={(e) => setStudent(e.target.value)}
            >
              <option value="">Select student</option>
              {query.data?.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.admissionNumber} · {s.name} · {s.className} {s.sectionName}
                </option>
              ))}
            </Select>
          </Field>
          {ledger.data && (
            <>
              <p className="font-bold">
                Verified ledger balance: {formatMoney(ledger.data.balance)}
              </p>
              <ul className="text-sm">
                {ledger.data.charges.map((c) => (
                  <li key={c.id}>
                    {c.feeHeadName} · {formatMoney(c.amount)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount collected (₹)" htmlFor="collection-amount">
              <Input
                id="collection-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Collection date" htmlFor="collection-date">
              <Input
                id="collection-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Payment method" htmlFor="collection-method">
              <Select
                id="collection-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {[
                  "cash",
                  "cheque",
                  "bank_transfer",
                  "upi",
                  "demand_draft",
                  "pos_slip",
                  "other",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Unique collection / bank reference"
              htmlFor="collection-reference"
            >
              <Input
                id="collection-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          </div>
          <Button
            disabled={
              !student ||
              Number(amount) <= 0 ||
              reference.trim().length < 2 ||
              !query.data?.policy.collectionEnabled ||
              save.isPending
            }
            onClick={() => save.mutate()}
          >
            Record for finance verification
          </Button>
          <p className="text-xs text-slate-600">
            This creates a pending acknowledgement. A different finance officer
            verifies the collection before a receipt and ledger posting are
            issued. Pending submissions reduce the amount you can record again.
          </p>
          {save.isSuccess && (
            <p role="status">
              Collection recorded — pending independent finance verification.
            </p>
          )}
        </div>
      </Card>
      {(query.error || ledger.error || save.error) && (
        <p role="alert">
          {errorMessage(query.error || ledger.error || save.error)}
        </p>
      )}
      <Card>
        <div className="overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Reference</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    {query.data?.students.find((s) => s.id === e.studentId)
                      ?.name ?? "Student record"}
                  </td>
                  <td>{e.reference}</td>
                  <td>{e.date}</td>
                  <td>{formatMoney(Number(e.amount))}</td>
                  <td>{e.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
