import type {
  BudgetReport,
  BudgetTransaction,
  BudgetCommitment,
  ProcurementBudget,
} from "@erp/shared";
import { getPool } from "../db";
import { notFound } from "./errors";

const cents = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};
const money = (value: bigint) => Number(value) / 100;
const zero = () => ({ actual: 0n, pending: 0n, committed: 0n });

/** One consistent snapshot; paid bills and their expense postings count once. */
export async function getBudgetReport(
  schoolId: string,
  academicYearId?: string,
  allYears = false,
): Promise<BudgetReport> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const years = await client.query<{
      id: string;
      name: string;
      starts_on: string;
      ends_on: string;
    }>(
      `SELECT id,name,starts_on::text,ends_on::text FROM academic_years WHERE school_id=$1 AND ($2::uuid IS NULL OR id=$2) ORDER BY (status='active') DESC,starts_on DESC`,
      [schoolId, academicYearId ?? null],
    );
    if (academicYearId && !years.rows[0])
      throw notFound("Academic year not found");
    const year = years.rows[0];
    const selected = allYears ? null : (year?.id ?? null);
    const rawBudgets = await client.query<{
      id: string;
      academic_year_id: string;
      academic_year_name: string;
      code: string;
      name: string;
      department: string | null;
      floor: string | null;
      vendor_id: string | null;
      expense_head_code: string | null;
      allocated_amount: string;
      active: boolean;
    }>(
      `SELECT b.*,y.name AS academic_year_name FROM procurement_budgets b JOIN academic_years y ON y.school_id=b.school_id AND y.id=b.academic_year_id WHERE b.school_id=$1 AND ($2::uuid IS NULL OR b.academic_year_id=$2) ORDER BY y.starts_on DESC,b.name`,
      [schoolId, selected],
    );
    const expenses = await client.query<{
      id: string;
      budget_id: string;
      po_id: string | null;
      bill_id: string | null;
      description: string;
      amount: string;
      spent_on: string;
      status: "recorded" | "approved";
      vendor_name: string | null;
    }>(
      `SELECT e.*,coalesce(e.po_id,linked_bill.po_id) AS po_id,e.spent_on::text,v.name AS vendor_name FROM procurement_expenses e LEFT JOIN vendor_bills linked_bill ON linked_bill.school_id=e.school_id AND linked_bill.id=e.bill_id JOIN procurement_budgets b ON b.school_id=e.school_id AND b.id=e.budget_id LEFT JOIN vendors v ON v.school_id=e.school_id AND v.id=e.vendor_id
       WHERE e.school_id=$1 AND e.status<>'void' AND ($2::uuid IS NULL OR b.academic_year_id=$2)`,
      [schoolId, selected],
    );
    const bills = await client.query<{
      id: string;
      po_id: string | null;
      budget_id: string | null;
      vendor_name: string;
      amount: string;
      bill_number: string;
      paid_on: string;
      posted_total: string;
      in_period: boolean;
    }>(
      `SELECT vb.id,vb.po_id,r.budget_id,v.name AS vendor_name,vb.amount,vb.bill_number,vb.paid_on::text,
       coalesce((SELECT sum(e.amount) FROM procurement_expenses e WHERE e.school_id=vb.school_id AND e.bill_id=vb.id AND e.status<>'void'),0)::text AS posted_total,
       ($2::uuid IS NULL OR b.academic_year_id=$2 OR (r.budget_id IS NULL AND vb.paid_on BETWEEN $3::date AND $4::date)) AS in_period FROM vendor_bills vb
       JOIN vendors v ON v.school_id=vb.school_id AND v.id=vb.vendor_id LEFT JOIN purchase_orders po ON po.school_id=vb.school_id AND po.id=vb.po_id
       LEFT JOIN purchase_requests r ON r.school_id=po.school_id AND r.id=po.request_id LEFT JOIN procurement_budgets b ON b.school_id=r.school_id AND b.id=r.budget_id
       WHERE vb.school_id=$1 AND vb.status='paid'`,
      [schoolId, selected, year?.starts_on ?? null, year?.ends_on ?? null],
    );
    const orders = await client.query<{
      id: string;
      po_number: string;
      department: string | null;
      budget_id: string | null;
      vendor_name: string;
      total_amount: string;
    }>(
      `SELECT po.id,po.po_number,r.department,r.budget_id,v.name AS vendor_name,po.total_amount FROM purchase_orders po
       JOIN vendors v ON v.school_id=po.school_id AND v.id=po.vendor_id LEFT JOIN purchase_requests r ON r.school_id=po.school_id AND r.id=po.request_id
       LEFT JOIN procurement_budgets b ON b.school_id=r.school_id AND b.id=r.budget_id WHERE po.school_id=$1 AND po.status IN('issued','partially_received','received')
       AND ($2::uuid IS NULL OR b.academic_year_id=$2 OR (r.budget_id IS NULL AND po.order_date BETWEEN $3::date AND $4::date))`,
      [schoolId, selected, year?.starts_on ?? null, year?.ends_on ?? null],
    );
    await client.query("COMMIT");
    const budgetMap = new Map(
      rawBudgets.rows.map((budget) => [budget.id, budget]),
    );
    const paidBills = new Set(bills.rows.map((bill) => bill.id));
    const byBudget = new Map(
      rawBudgets.rows.map((budget) => [budget.id, zero()]),
    );
    const byOrder = new Map<string, bigint>();
    const transactions: BudgetTransaction[] = [];
    let actual = 0n,
      pending = 0n,
      committed = 0n,
      unallocatedActual = 0n;
    for (const expense of expenses.rows) {
      const amount = cents(expense.amount);
      const budget = budgetMap.get(expense.budget_id)!;
      const approved =
        expense.status === "approved" ||
        (!!expense.bill_id && paidBills.has(expense.bill_id));
      if (approved) {
        actual += amount;
        byBudget.get(budget.id)!.actual += amount;
      } else {
        pending += amount;
        byBudget.get(budget.id)!.pending += amount;
      }
      if (expense.po_id)
        byOrder.set(expense.po_id, (byOrder.get(expense.po_id) ?? 0n) + amount);
      transactions.push({
        id: expense.id,
        source: "expense",
        budgetId: budget.id,
        budgetName: budget.name,
        expenseHeadCode: budget.expense_head_code,
        department: budget.department,
        location: budget.floor,
        vendorName: expense.vendor_name,
        description: expense.description,
        amount: money(amount),
        date: expense.spent_on,
        status: approved ? "approved" : "recorded",
        poId: expense.po_id,
      });
    }
    for (const bill of bills.rows) {
      if (!bill.in_period) continue;
      const remaining = cents(bill.amount) - cents(bill.posted_total);
      if (remaining <= 0n) continue;
      const budget = bill.budget_id ? budgetMap.get(bill.budget_id) : undefined;
      actual += remaining;
      if (budget) byBudget.get(budget.id)!.actual += remaining;
      else unallocatedActual += remaining;
      if (bill.po_id)
        byOrder.set(bill.po_id, (byOrder.get(bill.po_id) ?? 0n) + remaining);
      transactions.push({
        id: bill.id,
        source: "paid_bill",
        budgetId: budget?.id ?? null,
        budgetName: budget?.name ?? "Unallocated paid bill",
        expenseHeadCode: budget?.expense_head_code ?? null,
        department: budget?.department ?? null,
        location: budget?.floor ?? null,
        vendorName: bill.vendor_name,
        description: `Paid vendor bill ${bill.bill_number}`,
        amount: money(remaining),
        date: bill.paid_on,
        status: "approved",
        poId: bill.po_id,
      });
    }
    const commitments: BudgetCommitment[] = [];
    for (const order of orders.rows) {
      const remaining =
        cents(order.total_amount) - (byOrder.get(order.id) ?? 0n);
      if (remaining <= 0n) continue;
      let budgetId = order.budget_id;
      if (!budgetId) {
        const legacy = rawBudgets.rows.filter(
          (budget) =>
            !budget.expense_head_code && budget.department === order.department,
        );
        if (legacy.length === 1) budgetId = legacy[0]!.id;
      }
      if (budgetId && byBudget.has(budgetId))
        byBudget.get(budgetId)!.committed += remaining;
      committed += remaining;
      commitments.push({
        id: order.id,
        budgetId,
        poNumber: order.po_number,
        vendorName: order.vendor_name,
        amount: money(remaining),
      });
    }
    let allocated = 0n;
    const budgets: Array<ProcurementBudget & { pendingAmount: number }> =
      rawBudgets.rows.map((budget) => {
        const allocation = cents(budget.allocated_amount);
        allocated += allocation;
        const values = byBudget.get(budget.id)!;
        return {
          id: budget.id,
          academicYearId: budget.academic_year_id,
          academicYearName: budget.academic_year_name,
          code: budget.code,
          name: budget.name,
          department: budget.department,
          expenseHeadCode: budget.expense_head_code,
          floor: budget.floor,
          vendorId: budget.vendor_id,
          active: budget.active,
          allocatedAmount: money(allocation),
          spentAmount: money(values.actual),
          pendingAmount: money(values.pending),
          committedAmount: money(values.committed),
          availableAmount: money(
            allocation - values.actual - values.pending - values.committed,
          ),
        };
      });
    const available = allocated - actual - pending - committed;
    return {
      academicYearId: allYears ? null : (year?.id ?? null),
      academicYearName: allYears
        ? "All academic years"
        : (year?.name ?? "No academic year"),
      budgets,
      transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)),
      commitments,
      totals: {
        allocated: money(allocated),
        actual: money(actual),
        pending: money(pending),
        committed: money(committed),
        available: money(available),
        overspent: money(available < 0n ? -available : 0n),
        unallocatedActual: money(unallocatedActual),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
