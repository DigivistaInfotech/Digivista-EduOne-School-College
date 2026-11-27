import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  SCHOOL_EXPENSE_GROUPS,
  SCHOOL_EXPENSE_ITEMS,
} from "@erp/shared/procurement-catalog";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import {
  BUDGET_REFRESH_OPTIONS,
  BudgetRefresh,
  fetchBudgetReport,
} from "../components/BudgetOverview";
import { listAcademicYears } from "../lib/endpoints";
import { errorMessage } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Select,
  TableSkeleton,
} from "../components/ui";

export function BudgetReportPage() {
  const { membership } = useAuth();
  const schoolId = useSchoolId();
  const [params, setParams] = useSearchParams();
  const [year, setYear] = useState("");
  const [group, setGroup] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [detailFilter, setDetailFilter] = useState<"all" | "actual" | "pending" | "commitments" | "available" | "overspent">("all");
  const selected = params.get("budget") ?? "";
  const years = useQuery({
    queryKey: ["academic-years", schoolId],
    queryFn: () => listAcademicYears(schoolId),
  });
  const report = useQuery({
    ...BUDGET_REFRESH_OPTIONS,
    queryKey: ["budget-report", schoolId, year || "active"],
    queryFn: () => fetchBudgetReport(schoolId, year || undefined),
  });
  if (report.isPending) return <TableSkeleton rows={6} columns={5} />;
  if (report.isError)
    return (
      <ErrorState
        message={errorMessage(report.error)}
        onRetry={() => void report.refetch()}
      />
    );
  const data = report.data;
  const budgets = data.budgets.filter(
    (budget) =>
      (!group ||
        SCHOOL_EXPENSE_ITEMS.find(
          (item) => item.code === budget.expenseHeadCode,
        )?.groupCode === group) &&
      (!department || budget.department === department) &&
      (!location || budget.floor === location) &&
      (!selected || budget.id === selected) &&
      (detailFilter !== "available" || budget.availableAmount >= 0) &&
      (detailFilter !== "overspent" || budget.availableAmount < 0),
  );
  const ids = new Set(budgets.map((budget) => budget.id));
  const overall = !group && !department && !location && !selected && detailFilter !== "available" && detailFilter !== "overspent";
  const transactions = data.transactions.filter((row) =>
    (detailFilter === "actual" ? row.status === "approved" : detailFilter === "pending" ? row.status === "recorded" : true) &&
    (selected === "unallocated"
      ? !row.budgetId
      : row.budgetId
        ? ids.has(row.budgetId)
        : overall || detailFilter === "overspent"),
  );
  const commitments = data.commitments.filter((row) =>
    selected === "unallocated"
      ? !row.budgetId
      : row.budgetId
        ? ids.has(row.budgetId)
        : overall || detailFilter === "overspent",
  );
  const totals = overall
    ? data.totals
    : {
        allocated: budgets.reduce((sum, row) => sum + row.allocatedAmount, 0),
        actual: transactions
          .filter((row) => row.status === "approved")
          .reduce((sum, row) => sum + row.amount, 0),
        pending: transactions
          .filter((row) => row.status === "recorded")
          .reduce((sum, row) => sum + row.amount, 0),
        committed: commitments.reduce((sum, row) => sum + row.amount, 0),
        available: 0,
        overspent: 0,
        unallocatedActual: 0,
      };
  if (!overall) {
    totals.available =
      totals.allocated - totals.actual - totals.pending - totals.committed;
    totals.overspent = Math.max(0, -totals.available);
  }
  return (
    <div className="print-surface space-y-6">
      <PageHeader
        title="Budget, expense & balance"
        description="Live budget-versus-actual figures, with paid bills and matching expense postings counted once. Click a graph row to inspect the underlying items."
        actions={
          <div className="print-hide flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => window.print()}>
              Print budget report
            </Button>
            <BudgetRefresh
              fetching={report.isFetching}
              updatedAt={report.dataUpdatedAt}
              refresh={() => void report.refetch()}
            />
            <Link
              to="/procurement?tab=budgets"
              className="text-sm font-bold text-teal-700"
            >
              Manage budgets →
            </Link>
          </div>
        }
      />
      <div className="print-only mb-5 hidden border-b border-slate-300 pb-3">
        <p className="text-xl font-bold">
          {membership?.schoolName ?? "School"}
        </p>
        <p className="text-sm">
          Budget, expense & balance · {data.academicYearName}
        </p>
      </div>
      <Card className="print-hide">
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Academic year" htmlFor="report-year">
            <Select
              id="report-year"
              value={year || data.academicYearId || ""}
              onChange={(event) => {
                setYear(event.target.value);
                setParams({});
              }}
            >
              {years.data?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expense group" htmlFor="report-group">
            <Select
              id="report-group"
              value={group}
              onChange={(event) => {
                setGroup(event.target.value);
                setParams({});
              }}
            >
              <option value="">All groups</option>
              {SCHOOL_EXPENSE_GROUPS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department" htmlFor="report-department">
            <Select
              id="report-department"
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value);
                setParams({});
              }}
            >
              <option value="">All departments</option>
              {[
                ...new Set(
                  data.budgets.map((row) => row.department).filter(Boolean),
                ),
              ].map((value) => (
                <option key={value!}>{value}</option>
              ))}
            </Select>
          </Field>
          <Field label="Location / area" htmlFor="report-location">
            <Select
              id="report-location"
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
                setParams({});
              }}
            >
              <option value="">All locations</option>
              {[
                ...new Set(
                  data.budgets.map((row) => row.floor).filter(Boolean),
                ),
              ].map((value) => (
                <option key={value!}>{value}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Allocated budget", totals.allocated],
          ["Actual approved / paid expense", totals.actual],
          ["Pending recorded expense", totals.pending],
          ["Open-order commitments", totals.committed],
          ["Available after reserves", totals.available],
          ["Over budget / unallocated shortfall", totals.overspent],
        ].map(([label, value]) => (
          <button
            type="button"
            key={label}
            aria-label={`Show ${String(label).toLowerCase()} details`}
            onClick={() => {
              const next = label === "Actual approved / paid expense" ? "actual"
                : label === "Pending recorded expense" ? "pending"
                : label === "Open-order commitments" ? "commitments"
                : label === "Available after reserves" ? "available"
                : label === "Over budget / unallocated shortfall" ? "overspent" : "all";
              setDetailFilter(next);
              window.setTimeout(() => document.getElementById(next === "commitments" ? "budget-commitments" : next === "available" || next === "overspent" || next === "all" ? "budget-breakdown" : "budget-items")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
            }}
            className={`rounded-2xl border bg-white p-5 text-left transition hover:border-teal-600 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${detailFilter === (label === "Actual approved / paid expense" ? "actual" : label === "Pending recorded expense" ? "pending" : label === "Open-order commitments" ? "commitments" : label === "Available after reserves" ? "available" : label === "Over budget / unallocated shortfall" ? "overspent" : "all") ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}
          >
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p
              className={`mt-2 text-2xl font-extrabold ${Number(value) < 0 || (label === "Over budget / unallocated shortfall" && Number(value) > 0) ? "text-rose-600" : "text-slate-900"}`}
            >
              {formatMoney(Number(value))}
            </p>
          </button>
        ))}
      </div>
      {data.totals.unallocatedActual > 0 && (
        <Alert tone="warning">
          {formatMoney(data.totals.unallocatedActual)} of paid bills has no
          exact budget allocation.{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => {
              setGroup("");
              setDepartment("");
              setLocation("");
              setDetailFilter("all");
              setParams({ budget: "unallocated" });
            }}
          >
            Show unallocated items
          </button>
        </Alert>
      )}
      {(selected || group || department || location || detailFilter !== "all") && (
        <Button
          className="print-hide"
          variant="secondary"
          onClick={() => {
            setGroup("");
            setDepartment("");
            setLocation("");
            setDetailFilter("all");
            setParams({});
          }}
        >
          Clear breakdown filters
        </Button>
      )}
      <Card id="budget-breakdown">
        <CardHeader
          title="Budget vs actual — select a row for details"
          description="Grey = allocation scale; teal = actual; amber = pending expense; violet = remaining order commitment. Over-budget amounts are red."
        />
        <div className="space-y-5 p-5">
          {budgets.map((budget) => {
            const pending = budget.pendingAmount;
            const used = budget.spentAmount + pending + budget.committedAmount;
            const max = Math.max(budget.allocatedAmount, used, 1);
            return (
              <button
                type="button"
                key={budget.id}
                onClick={() => setParams({ budget: budget.id })}
                className="block w-full rounded-xl border border-slate-200 p-4 text-left hover:border-teal-600"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{budget.name}</p>
                    <p className="text-xs text-slate-500">
                      {budget.department || "Whole school"} ·{" "}
                      {budget.floor || "All areas"} · {budget.academicYearName}
                    </p>
                  </div>
                  <Badge
                    tone={
                      budget.availableAmount < 0
                        ? "danger"
                        : budget.availableAmount <= budget.allocatedAmount * 0.2
                          ? "warning"
                          : "success"
                    }
                  >
                    {budget.availableAmount < 0 ? "Over budget" : "Available"}{" "}
                    {formatMoney(budget.availableAmount)}
                  </Badge>
                </div>
                <div
                  className="mt-3 flex h-4 overflow-hidden rounded-full bg-slate-100"
                  aria-label={`${budget.name}: allocated ${budget.allocatedAmount}, actual ${budget.spentAmount}, pending ${pending}, committed ${budget.committedAmount}`}
                >
                  <span
                    className={
                      used > budget.allocatedAmount
                        ? "bg-rose-500"
                        : "bg-teal-600"
                    }
                    style={{ width: `${(budget.spentAmount / max) * 100}%` }}
                  />
                  <span
                    className="bg-amber-400"
                    style={{ width: `${(pending / max) * 100}%` }}
                  />
                  <span
                    className="bg-violet-400"
                    style={{
                      width: `${(budget.committedAmount / max) * 100}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Allocated {formatMoney(budget.allocatedAmount)} · Actual{" "}
                  {formatMoney(budget.spentAmount)} · Pending{" "}
                  {formatMoney(pending)} · Committed{" "}
                  {formatMoney(budget.committedAmount)}
                </p>
              </button>
            );
          })}
          {!budgets.length && (
            <EmptyState
              title={
                selected === "unallocated"
                  ? "Unallocated cost breakdown"
                  : "No budgets in this selection"
              }
              description="Use the item details below or adjust your filters."
            />
          )}
        </div>
      </Card>
      <Card id="budget-items">
        <CardHeader
          title="Item-wise expense details"
          description={`${transactions.length} matching records · ${data.academicYearName}`}
        />
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Expense item / budget</th>
                <th>Department / location</th>
                <th>Vendor</th>
                <th>Details</th>
                <th>Status / source</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((row) => (
                <tr key={`${row.source}:${row.id}`}>
                  <td>{formatDate(row.date)}</td>
                  <td>{row.budgetName}</td>
                  <td>
                    {row.department || "Unallocated"}
                    <p className="text-xs text-slate-500">
                      {row.location || "—"}
                    </p>
                  </td>
                  <td>{row.vendorName || "—"}</td>
                  <td>{row.description}</td>
                  <td>
                    <Badge
                      tone={row.status === "approved" ? "success" : "warning"}
                    >
                      {row.status === "approved" ? "Actual" : "Pending"}
                    </Badge>
                    <p className="text-xs text-slate-500">
                      {row.source === "paid_bill"
                        ? "Paid bill — unposted balance"
                        : "Expense posting"}
                    </p>
                  </td>
                  <td className="text-right tabular-nums">
                    {formatMoney(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!transactions.length && (
          <p className="p-5 text-sm text-slate-500">
            No expense items in this selection.
          </p>
        )}
      </Card>
      {!!commitments.length && (
        <Card id="budget-commitments">
          <CardHeader
            title="Remaining order commitments"
            description="Only the unpaid/unposted remainder is reserved; matching bill and expense amounts are not counted again."
          />
          <div className="space-y-2 p-5">
            {commitments.map((row) => (
              <div key={row.id} className="flex justify-between gap-3 text-sm">
                <span>
                  {row.poNumber} · {row.vendorName}
                  {row.budgetId ? "" : " · Unallocated"}
                </span>
                <strong>{formatMoney(row.amount)}</strong>
              </div>
            ))}
          </div>
        </Card>
      )}
      <p className="text-xs text-slate-500">
        Budget availability is an allocation balance, not cash or bank balance.
        Inactive budgets remain visible for accounting history. Voided expenses
        are excluded.
      </p>
    </div>
  );
}
