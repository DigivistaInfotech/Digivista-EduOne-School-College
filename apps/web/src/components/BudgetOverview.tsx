import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { BudgetReport } from "@erp/shared";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatMoney } from "../lib/format";
import { Button, Card, CardHeader, ErrorState, TableSkeleton } from "./ui";

// Financial summaries must refresh after changes made in another tab or session.
export const BUDGET_REFRESH_OPTIONS = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
  refetchInterval: 30_000,
};

export function BudgetRefresh({
  fetching,
  updatedAt,
  refresh,
}: {
  fetching: boolean;
  updatedAt: number;
  refresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span role="status" className="text-xs text-slate-500">
        {fetching
          ? "Updating figures…"
          : updatedAt
            ? `Updated ${new Date(updatedAt).toLocaleTimeString()} · auto-refresh every 30s`
            : "Waiting for figures"}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={fetching}
        onClick={refresh}
      >
        Refresh figures
      </Button>
    </div>
  );
}

export const fetchBudgetReport = (schoolId: string, year?: string) =>
  api<BudgetReport>(
    `/api/schools/${schoolId}/budget-report${year ? `?academicYearId=${encodeURIComponent(year)}` : ""}`,
  );

export function BudgetOverview() {
  const schoolId = useSchoolId();
  const report = useQuery({
    ...BUDGET_REFRESH_OPTIONS,
    queryKey: ["budget-report", schoolId, "active"],
    queryFn: () => fetchBudgetReport(schoolId),
  });
  return (
    <Card>
      <CardHeader
        title="Budget, expense & balance"
        description={
          report.data
            ? `${report.data.academicYearName} · live school records`
            : "Live school records"
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <BudgetRefresh
              fetching={report.isFetching}
              updatedAt={report.dataUpdatedAt}
              refresh={() => void report.refetch()}
            />
            <Link
              to="/budget-report"
              className="text-sm font-bold text-teal-700"
            >
              Full breakdown & graphs →
            </Link>
          </div>
        }
      />
      {report.isPending ? (
        <TableSkeleton rows={2} columns={4} />
      ) : report.isError ? (
        <ErrorState
          message={errorMessage(report.error)}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Budget allocated", report.data.totals.allocated],
              ["Actual expense", report.data.totals.actual],
              [
                "Pending / committed",
                report.data.totals.pending + report.data.totals.committed,
              ],
              [
                "Available balance (after reserves)",
                report.data.totals.available,
              ],
            ].map(([label, value]) => (
              <Link
                to="/budget-report"
                key={label}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 hover:border-teal-600"
              >
                <p className="text-xs font-semibold text-slate-500">{label}</p>
                <p
                  className={`mt-2 text-xl font-extrabold ${Number(value) < 0 ? "text-rose-600" : "text-slate-900"}`}
                >
                  {formatMoney(Number(value))}
                </p>
              </Link>
            ))}
          </div>
          <div className="space-y-3">
            {report.data.budgets.slice(0, 4).map((budget) => {
              const max = Math.max(
                budget.allocatedAmount,
                budget.spentAmount,
                1,
              );
              return (
                <Link
                  key={budget.id}
                  to={`/budget-report?budget=${budget.id}`}
                  className="block rounded-lg p-2 hover:bg-slate-50"
                >
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="font-bold">
                      {budget.name} · {budget.department || "Whole school"}
                    </span>
                    <span>
                      {formatMoney(budget.spentAmount)} /{" "}
                      {formatMoney(budget.allocatedAmount)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full ${budget.spentAmount > budget.allocatedAmount ? "bg-rose-500" : "bg-teal-600"}`}
                      style={{
                        width: `${Math.min(100, (budget.spentAmount / max) * 100)}%`,
                      }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">
            Actual = approved expenses and paid bills, counted once. Pending
            expenses and open orders reserve budget separately. Budget balance
            is not your bank balance.
          </p>
        </div>
      )}
    </Card>
  );
}
