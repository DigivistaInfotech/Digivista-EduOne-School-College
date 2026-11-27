import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  ProcurementBudget,
  PurchaseOrder,
  PurchaseRequest,
  Vendor,
} from "@erp/shared";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import {
  createBudget,
  createGoodsReceipt,
  createProcurementExpense,
  createPurchaseOrder,
  createPurchaseRequest,
  createVendor,
  createVendorBill,
  decideProcurementExpense,
  decidePurchaseOrder,
  decidePurchaseRequest,
  decideVendorBill,
  listAcademicYears,
  listBudgets,
  listProcurementExpenses,
  listPurchaseOrders,
  listPurchaseRequests,
  listVendorBills,
  listVendors,
  payVendorBill,
  updateBudget,
  updateVendor,
} from "../lib/endpoints";
import { errorMessage } from "../lib/api";
import { formatDate, formatMoney, todayIso } from "../lib/format";
import { Dialog } from "../components/Dialog";
import { Tabs } from "../components/Tabs";
import { SchoolBudgetDialog as BudgetDialog } from "../components/SchoolBudgetDialog";
import {
  SchoolPurchaseLines as LineItemsEditor,
  lineDescription,
  type PurchaseDraftLine,
} from "../components/SchoolPurchaseLines";
import {
  SCHOOL_EXPENSE_ITEMS,
  VENDOR_CATEGORIES,
  VENDOR_SERVICE_TYPES,
} from "@erp/shared/procurement-catalog";
import { useToast } from "../components/ToastProvider";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
  Textarea,
} from "../components/ui";

type Tab = "vendors" | "budgets" | "requests" | "orders" | "bills" | "expenses";

const VENDOR_STATUSES = ["active", "inactive", "blocked"] as const;

type LineItem = PurchaseDraftLine;

type DialogState =
  | { kind: "vendor"; vendor?: Vendor }
  | { kind: "budget"; budget?: ProcurementBudget }
  | { kind: "request" }
  | { kind: "order"; request?: PurchaseRequest }
  | { kind: "receipt"; order: PurchaseOrder }
  | { kind: "bill"; order?: PurchaseOrder }
  | { kind: "expense" }
  | null;

export function ProcurementPage(): ReactNode {
  const schoolId = useSchoolId();
  const { can, membership } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const canView = can("procurement.view");
  const canRequest = can("procurement.request");
  const canApprove = can("procurement.approve");
  const canManageVendors = can("procurement.vendor.manage");
  const canManageBudgets = can("procurement.budget.manage");
  const canPay = can("procurement.pay");

  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    ["vendors", "budgets", "requests", "orders", "bills", "expenses"].includes(
      searchParams.get("tab") ?? "",
    )
      ? (searchParams.get("tab") as Tab)
      : "vendors",
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [formError, setFormError] = useState("");

  const vendors = useQuery({
    queryKey: ["vendors", schoolId],
    queryFn: () => listVendors(schoolId),
    enabled: canView,
  });
  const years = useQuery({
    queryKey: ["academic-years", schoolId],
    queryFn: () => listAcademicYears(schoolId),
    enabled: canView,
  });
  const budgets = useQuery({
    queryKey: ["procurement-budgets", schoolId],
    queryFn: () => listBudgets(schoolId),
    enabled: canView,
  });
  const requests = useQuery({
    queryKey: ["purchase-requests", schoolId],
    queryFn: () => listPurchaseRequests(schoolId),
    enabled: canView,
  });
  const orders = useQuery({
    queryKey: ["purchase-orders", schoolId],
    queryFn: () => listPurchaseOrders(schoolId),
    enabled: canView,
  });
  const bills = useQuery({
    queryKey: ["vendor-bills", schoolId],
    queryFn: () => listVendorBills(schoolId),
    enabled: canView,
  });
  const expenses = useQuery({
    queryKey: ["procurement-expenses", schoolId],
    queryFn: () => listProcurementExpenses(schoolId),
    enabled: canView,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["vendors", schoolId] });
    void queryClient.invalidateQueries({
      queryKey: ["procurement-budgets", schoolId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["purchase-requests", schoolId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["purchase-orders", schoolId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["vendor-bills", schoolId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["procurement-expenses", schoolId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["budget-report", schoolId],
    });
  };

  function action<TInput, TResult>(
    fn: (input: TInput) => Promise<TResult>,
    message: string,
  ) {
    return useMutation({
      mutationFn: fn,
      onSuccess: () => {
        toast.notify("success", message);
        setDialog(null);
        invalidate();
      },
      onError: (error) => setFormError(errorMessage(error)),
    });
  }

  const saveVendor = action(
    (input: { id?: string; body: Parameters<typeof createVendor>[1] }) =>
      input.id
        ? updateVendor(schoolId, input.id, input.body)
        : createVendor(schoolId, input.body),
    "Vendor saved.",
  );
  const saveBudget = action(
    (input: { id?: string; body: Parameters<typeof createBudget>[1] }) =>
      input.id
        ? updateBudget(schoolId, input.id, input.body)
        : createBudget(schoolId, input.body),
    "Budget saved.",
  );
  const saveRequest = action(
    (body: Parameters<typeof createPurchaseRequest>[1]) =>
      createPurchaseRequest(schoolId, body),
    "Purchase request created.",
  );
  const decideRequest = action(
    (input: {
      id: string;
      decision: "submit" | "approve" | "reject" | "cancel";
    }) =>
      decidePurchaseRequest(schoolId, input.id, { decision: input.decision }),
    "Request updated.",
  );
  const saveOrder = action(
    (body: Parameters<typeof createPurchaseOrder>[1]) =>
      createPurchaseOrder(schoolId, body),
    "Purchase order created.",
  );
  const decideOrder = action(
    (input: { id: string; decision: "approve" | "cancel" }) =>
      decidePurchaseOrder(schoolId, input.id, { decision: input.decision }),
    "Purchase order updated.",
  );
  const saveReceipt = action(
    (body: Parameters<typeof createGoodsReceipt>[1]) =>
      createGoodsReceipt(schoolId, body),
    "Goods receipt recorded.",
  );
  const saveBill = action(
    (body: Parameters<typeof createVendorBill>[1]) =>
      createVendorBill(schoolId, body),
    "Vendor bill recorded.",
  );
  const decideBill = action(
    (input: { id: string; decision: "approve" | "reject" }) =>
      decideVendorBill(schoolId, input.id, { decision: input.decision }),
    "Vendor bill updated.",
  );
  const payBill = action(
    (input: { id: string; paidOn: string }) =>
      payVendorBill(schoolId, input.id, input.paidOn),
    "Bill marked paid.",
  );
  const saveExpense = action(
    (body: Parameters<typeof createProcurementExpense>[1]) =>
      createProcurementExpense(schoolId, body),
    "Expense recorded.",
  );
  const decideExpense = action(
    (input: { id: string; decision: "approve" | "reject" }) =>
      decideProcurementExpense(schoolId, input.id, {
        decision: input.decision,
      }),
    "Expense updated.",
  );

  const vendorOptions = vendors.data?.items ?? [];
  const budgetOptions = budgets.data?.items ?? [];
  const requestOptions = requests.data?.items ?? [];
  const orderOptions = orders.data?.items ?? [];
  const billOptions = bills.data?.items ?? [];

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "vendors", label: "Vendors" },
    { value: "budgets", label: "Budgets" },
    { value: "requests", label: "Requests" },
    { value: "orders", label: "Purchase orders" },
    { value: "bills", label: "Vendor bills" },
    { value: "expenses", label: "Expenses" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement, expenses & budgets"
        description="Two-person approval: a requester cannot approve their own request, order or bill. Budget utilisation is derived from approved expenses and open purchase orders, never stored as a counter."
        actions={
          <div className="flex flex-wrap gap-2">
            {canManageVendors && (
              <>
                {can("imports.manage") && (
                  <Link to="/data-tools?tab=imports&entityType=vendors">
                    <Button variant="secondary">Import vendors</Button>
                  </Link>
                )}
                <Button
                  variant="secondary"
                  onClick={() => setDialog({ kind: "vendor" })}
                >
                  <Icon name="plus" className="h-4 w-4" />
                  New vendor
                </Button>
              </>
            )}
            {canRequest && (
              <Button onClick={() => setDialog({ kind: "request" })}>
                <Icon name="clipboard" className="h-4 w-4" />
                Purchase request
              </Button>
            )}
          </div>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={tabs}
        label="Procurement views"
      />

      {tab === "vendors" && canView && (
        <Card>
          <CardHeader
            title="Vendors"
            description="Codes are generated automatically when left blank."
            actions={
              canManageVendors ? (
                <Button size="sm" onClick={() => setDialog({ kind: "vendor" })}>
                  New vendor
                </Button>
              ) : undefined
            }
          />
          {vendors.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : vendors.isError ? (
            <ErrorState
              message={errorMessage(vendors.error)}
              onRetry={() => void vendors.refetch()}
            />
          ) : vendorOptions.length === 0 ? (
            <EmptyState
              title="No vendors"
              description="Add a vendor before raising purchase orders."
              icon="users"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Vendor</th>
                    <th>Contact</th>
                    <th className="text-right">Open bills</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorOptions.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td className="font-medium text-slate-900">
                        {row.name}
                        <p className="text-xs font-normal text-slate-500">
                          {VENDOR_CATEGORIES.find(
                            ([code]) => code === row.category,
                          )?.[1] ?? "Uncategorised"}
                          {row.serviceType
                            ? ` · ${VENDOR_SERVICE_TYPES.find(([code]) => code === row.serviceType)?.[1] ?? row.serviceType}`
                            : ""}
                        </p>
                      </td>
                      <td className="text-sm text-slate-600">
                        {row.contactName ?? "—"}
                        {row.email && <p className="text-xs">{row.email}</p>}
                        {row.phone && <p className="text-xs">{row.phone}</p>}
                        {row.secondaryPhone && (
                          <p className="text-xs">
                            Alternate: {row.secondaryPhone}
                          </p>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.openBillTotal)}
                      </td>
                      <td>
                        <Badge
                          tone={
                            row.status === "active"
                              ? "success"
                              : row.status === "blocked"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {row.status}
                        </Badge>
                        {row.contractEndsOn && (
                          <p
                            className={`mt-1 text-xs ${row.contractEndsOn < todayIso(membership?.timezone) ? "text-rose-600" : "text-slate-500"}`}
                          >
                            {row.contractEndsOn < todayIso(membership?.timezone)
                              ? "Contract expired"
                              : "Contract ends"}{" "}
                            {formatDate(row.contractEndsOn)}
                          </p>
                        )}
                      </td>
                      <td className="text-right">
                        {canManageVendors && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDialog({ kind: "vendor", vendor: row })
                            }
                          >
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "budgets" && canView && (
        <Card>
          <CardHeader
            title="Procurement budgets"
            description="Available = allocated − actual approved/paid expenses − pending expenses − linked open-order commitments."
            actions={
              canManageBudgets ? (
                <Button size="sm" onClick={() => setDialog({ kind: "budget" })}>
                  New budget
                </Button>
              ) : undefined
            }
          />
          {budgets.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : budgets.isError ? (
            <ErrorState
              message={errorMessage(budgets.error)}
              onRetry={() => void budgets.refetch()}
            />
          ) : budgetOptions.length === 0 ? (
            <EmptyState
              title="No budgets"
              description="Create a budget for an academic year."
              icon="chart"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Budget</th>
                    <th>Year</th>
                    <th className="text-right">Allocated</th>
                    <th className="text-right">Spent</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Committed</th>
                    <th className="text-right">Available</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetOptions.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td>
                        <Link
                          to={`/budget-report?budget=${row.id}`}
                          className="font-medium text-teal-700 hover:underline"
                        >
                          {row.name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {row.department ?? "—"}
                          {row.floor ? ` · ${row.floor}` : ""}
                        </p>
                        {row.vendorId && (
                          <p className="text-xs text-slate-500">
                            {
                              vendorOptions.find(
                                (vendor) => vendor.id === row.vendorId,
                              )?.name
                            }
                          </p>
                        )}
                        {row.expenseHeadCode && (
                          <p className="text-[10px] text-slate-400">
                            {
                              SCHOOL_EXPENSE_ITEMS.find(
                                (item) => item.code === row.expenseHeadCode,
                              )?.groupName
                            }
                          </p>
                        )}
                      </td>
                      <td className="text-sm text-slate-600">
                        {row.academicYearName}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.allocatedAmount)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.spentAmount)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.pendingAmount ?? 0)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.committedAmount)}
                      </td>
                      <td className="text-right tabular-nums">
                        <span
                          className={
                            row.availableAmount < 0 ? "text-rose-600" : ""
                          }
                        >
                          {formatMoney(row.availableAmount)}
                        </span>
                        <p className="text-[10px] text-slate-500">
                          {row.allocatedAmount > 0
                            ? `${Math.round(((row.spentAmount + (row.pendingAmount ?? 0) + row.committedAmount) / row.allocatedAmount) * 100)}% used/reserved`
                            : "No allocation"}
                        </p>
                        {row.availableAmount < 0 ? (
                          <Badge tone="danger">Over budget</Badge>
                        ) : row.allocatedAmount > 0 &&
                          row.availableAmount <= row.allocatedAmount * 0.2 ? (
                          <Badge tone="warning">Low balance</Badge>
                        ) : null}
                      </td>
                      <td className="text-right">
                        {canManageBudgets && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDialog({ kind: "budget", budget: row })
                            }
                          >
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "requests" && canView && (
        <Card>
          <CardHeader
            title="Purchase requests"
            description="Submit for approval, then convert an approved request into a purchase order."
            actions={
              canRequest ? (
                <Button
                  size="sm"
                  onClick={() => setDialog({ kind: "request" })}
                >
                  New request
                </Button>
              ) : undefined
            }
          />
          {requests.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : requests.isError ? (
            <ErrorState
              message={errorMessage(requests.error)}
              onRetry={() => void requests.refetch()}
            />
          ) : requestOptions.length === 0 ? (
            <EmptyState
              title="No requests"
              description="Raise a request with one or more line items."
              icon="clipboard"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Title</th>
                    <th className="text-right">Total</th>
                    <th>Needed by</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requestOptions.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs">{row.requestNumber}</td>
                      <td>
                        <p className="font-medium text-slate-900">
                          {row.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {row.items.length} line
                          {row.items.length === 1 ? "" : "s"} ·{" "}
                          {row.requestedByName ?? "—"}
                        </p>
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.total)}
                      </td>
                      <td>{formatDate(row.neededBy)}</td>
                      <td>
                        <Badge
                          tone={
                            row.status === "approved"
                              ? "success"
                              : row.status === "rejected" ||
                                  row.status === "cancelled"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {row.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-2">
                          {canRequest && row.status === "draft" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                decideRequest.mutate({
                                  id: row.id,
                                  decision: "submit",
                                })
                              }
                            >
                              Submit
                            </Button>
                          )}
                          {canApprove && row.status === "submitted" && (
                            <>
                              <Button
                                size="sm"
                                onClick={() =>
                                  decideRequest.mutate({
                                    id: row.id,
                                    decision: "approve",
                                  })
                                }
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() =>
                                  decideRequest.mutate({
                                    id: row.id,
                                    decision: "reject",
                                  })
                                }
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {canRequest && row.status === "approved" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDialog({ kind: "order", request: row })
                              }
                            >
                              Create order
                            </Button>
                          )}
                          {canRequest &&
                            ["draft", "submitted", "approved"].includes(
                              row.status,
                            ) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  decideRequest.mutate({
                                    id: row.id,
                                    decision: "cancel",
                                  })
                                }
                              >
                                Cancel
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "orders" && canView && (
        <Card>
          <CardHeader
            title="Purchase orders"
            description="Approve an order before receiving goods. Partial receipts are supported."
            actions={
              canRequest ? (
                <Button size="sm" onClick={() => setDialog({ kind: "order" })}>
                  New order
                </Button>
              ) : undefined
            }
          />
          {orders.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : orders.isError ? (
            <ErrorState
              message={errorMessage(orders.error)}
              onRetry={() => void orders.refetch()}
            />
          ) : orderOptions.length === 0 ? (
            <EmptyState
              title="No purchase orders"
              description="Create an order from a vendor."
              icon="clipboard"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Vendor</th>
                    <th className="text-right">Total</th>
                    <th>Expected</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orderOptions.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs">{row.poNumber}</td>
                      <td>
                        <p className="font-medium text-slate-900">
                          {row.vendorName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {row.items.length} lines
                        </p>
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.totalAmount)}
                      </td>
                      <td>{formatDate(row.expectedOn)}</td>
                      <td>
                        <Badge
                          tone={
                            row.status === "received" || row.status === "closed"
                              ? "success"
                              : row.status === "cancelled"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {row.status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-2">
                          {canApprove && row.status === "draft" && (
                            <Button
                              size="sm"
                              onClick={() =>
                                decideOrder.mutate({
                                  id: row.id,
                                  decision: "approve",
                                })
                              }
                            >
                              Approve
                            </Button>
                          )}
                          {canRequest &&
                            ["issued", "partially_received"].includes(
                              row.status,
                            ) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setDialog({ kind: "receipt", order: row })
                                }
                              >
                                Receive
                              </Button>
                            )}
                          {canPay && row.status === "received" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDialog({ kind: "bill", order: row })
                              }
                            >
                              Bill
                            </Button>
                          )}
                          {canApprove &&
                            ["draft", "issued"].includes(row.status) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  decideOrder.mutate({
                                    id: row.id,
                                    decision: "cancel",
                                  })
                                }
                              >
                                Cancel
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "bills" && canView && (
        <Card>
          <CardHeader
            title="Vendor bills"
            description="Bills are recorded, approved, then marked paid. The bill amount must not exceed the linked order total."
            actions={
              canPay ? (
                <Button size="sm" onClick={() => setDialog({ kind: "bill" })}>
                  Record bill
                </Button>
              ) : undefined
            }
          />
          {bills.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : bills.isError ? (
            <ErrorState
              message={errorMessage(bills.error)}
              onRetry={() => void bills.refetch()}
            />
          ) : billOptions.length === 0 ? (
            <EmptyState
              title="No bills"
              description="Record a vendor bill against an order."
              icon="clipboard"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Vendor</th>
                    <th className="text-right">Amount</th>
                    <th>Bill date</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {billOptions.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono text-xs">{row.billNumber}</td>
                      <td className="font-medium text-slate-900">
                        {row.vendorName}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.amount)}
                      </td>
                      <td>{formatDate(row.billDate)}</td>
                      <td>{formatDate(row.dueOn)}</td>
                      <td>
                        <Badge
                          tone={
                            row.status === "paid"
                              ? "success"
                              : row.status === "void"
                                ? "neutral"
                                : "warning"
                          }
                        >
                          {row.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-2">
                          {canApprove && row.status === "recorded" && (
                            <>
                              <Button
                                size="sm"
                                onClick={() =>
                                  decideBill.mutate({
                                    id: row.id,
                                    decision: "approve",
                                  })
                                }
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() =>
                                  decideBill.mutate({
                                    id: row.id,
                                    decision: "reject",
                                  })
                                }
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {canPay && row.status === "approved" && (
                            <Button
                              size="sm"
                              onClick={() =>
                                payBill.mutate({
                                  id: row.id,
                                  paidOn: todayIso(),
                                })
                              }
                            >
                              Mark paid
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "expenses" && canView && (
        <Card>
          <CardHeader
            title="Expenses"
            description="Expenses reduce the available budget once approved."
            actions={
              canPay ? (
                <Button
                  size="sm"
                  onClick={() => setDialog({ kind: "expense" })}
                >
                  Record expense
                </Button>
              ) : undefined
            }
          />
          {expenses.isPending ? (
            <TableSkeleton rows={5} columns={5} />
          ) : expenses.isError ? (
            <ErrorState
              message={errorMessage(expenses.error)}
              onRetry={() => void expenses.refetch()}
            />
          ) : (expenses.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="No expenses"
              description="Record spend against a budget."
              icon="chart"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Budget</th>
                    <th>Description</th>
                    <th>Vendor</th>
                    <th className="text-right">Amount</th>
                    <th>Spent on</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.data!.items.map((row) => (
                    <tr key={row.id}>
                      <td className="text-sm text-slate-700">
                        <Link
                          to={`/budget-report?budget=${row.budgetId}`}
                          className="text-teal-700 hover:underline"
                        >
                          {row.budgetName}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {
                            budgetOptions.find(
                              (budget) => budget.id === row.budgetId,
                            )?.department
                          }
                          {budgetOptions.find(
                            (budget) => budget.id === row.budgetId,
                          )?.floor
                            ? ` · ${budgetOptions.find((budget) => budget.id === row.budgetId)?.floor}`
                            : ""}
                        </p>
                      </td>
                      <td className="font-medium text-slate-900">
                        {row.description}
                      </td>
                      <td className="text-sm text-slate-600">
                        {row.vendorName ?? "—"}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(row.amount)}
                      </td>
                      <td>{formatDate(row.spentOn)}</td>
                      <td>
                        <Badge
                          tone={
                            row.status === "approved"
                              ? "success"
                              : row.status === "void"
                                ? "neutral"
                                : "warning"
                          }
                        >
                          {row.status}
                        </Badge>
                      </td>
                      <td>
                        {canApprove && row.status === "recorded" && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() =>
                                decideExpense.mutate({
                                  id: row.id,
                                  decision: "approve",
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() =>
                                decideExpense.mutate({
                                  id: row.id,
                                  decision: "reject",
                                })
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
          )}
        </Card>
      )}

      {dialog?.kind === "vendor" && (
        <VendorDialog
          key={dialog.vendor?.id ?? "new-vendor"}
          vendor={dialog.vendor}
          error={formError}
          saving={saveVendor.isPending}
          onClose={() => {
            setDialog(null);
            setFormError("");
          }}
          onSave={(body) => saveVendor.mutate({ id: dialog.vendor?.id, body })}
        />
      )}

      {dialog?.kind === "budget" && (
        <BudgetDialog
          vendors={vendorOptions}
          key={dialog.budget?.id ?? "new-budget"}
          budget={dialog.budget}
          years={years.data?.items ?? []}
          error={formError}
          saving={saveBudget.isPending}
          onClose={() => {
            setDialog(null);
            setFormError("");
          }}
          onSave={(body) => saveBudget.mutate({ id: dialog.budget?.id, body })}
        />
      )}

      {dialog?.kind === "request" && (
        <RequestDialog
          budgets={budgetOptions}
          error={formError}
          saving={saveRequest.isPending}
          onClose={() => {
            setDialog(null);
            setFormError("");
          }}
          onSave={(body) => saveRequest.mutate(body)}
        />
      )}

      {dialog?.kind === "order" && (
        <OrderDialog
          budgets={budgetOptions}
          initialRequest={dialog.request}
          vendors={vendorOptions}
          requests={requestOptions.filter((row) => row.status === "approved")}
          error={formError}
          saving={saveOrder.isPending}
          onClose={() => {
            setDialog(null);
            setFormError("");
          }}
          onSave={(body) => saveOrder.mutate(body)}
        />
      )}

      {dialog?.kind === "receipt" && (
        <ReceiptDialog
          order={dialog.order}
          error={formError}
          saving={saveReceipt.isPending}
          onClose={() => {
            setDialog(null);
            setFormError("");
          }}
          onSave={(body) => saveReceipt.mutate(body)}
        />
      )}

      {dialog?.kind === "bill" && (
        <BillDialog
          order={dialog.order}
          vendors={vendorOptions}
          orders={orderOptions}
          error={formError}
          saving={saveBill.isPending}
          onClose={() => {
            setDialog(null);
            setFormError("");
          }}
          onSave={(body) => saveBill.mutate(body)}
        />
      )}

      {dialog?.kind === "expense" && (
        <ExpenseDialog
          budgets={budgetOptions}
          vendors={vendorOptions}
          error={formError}
          saving={saveExpense.isPending}
          onClose={() => {
            setDialog(null);
            setFormError("");
          }}
          onSave={(body) => saveExpense.mutate(body)}
        />
      )}
    </div>
  );
}

function VendorDialog({
  vendor,
  error,
  saving,
  onClose,
  onSave,
}: {
  vendor?: Vendor;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createVendor>[1]) => void;
}): ReactNode {
  const [name, setName] = useState(vendor?.name ?? "");
  const [contactName, setContactName] = useState(vendor?.contactName ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [category, setCategory] = useState(vendor?.category ?? "");
  const [serviceType, setServiceType] = useState(
    vendor?.serviceType ?? "goods_services",
  );
  const [secondaryPhone, setSecondaryPhone] = useState(
    vendor?.secondaryPhone ?? "",
  );
  const [contractStartsOn, setContractStartsOn] = useState(
    vendor?.contractStartsOn ?? "",
  );
  const [contractEndsOn, setContractEndsOn] = useState(
    vendor?.contractEndsOn ?? "",
  );
  const [gstin, setGstin] = useState(vendor?.gstin ?? "");
  const [notes, setNotes] = useState(vendor?.notes ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [status, setStatus] = useState<(typeof VENDOR_STATUSES)[number]>(
    vendor?.status ?? "active",
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={vendor ? "Edit vendor" : "New vendor"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="vendor-form" loading={saving}>
            Save vendor
          </Button>
        </>
      }
    >
      <form
        id="vendor-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            name,
            contactName: contactName || undefined,
            email: email || undefined,
            phone: phone || undefined,
            address: address || undefined,
            status,
            category: category || null,
            serviceType: serviceType as
              "goods" | "services" | "goods_services" | "contractor" | "amc",
            secondaryPhone: secondaryPhone || null,
            contractStartsOn: contractStartsOn || null,
            contractEndsOn: contractEndsOn || null,
            gstin: gstin || null,
            notes: notes || undefined,
          });
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Name" htmlFor="ven-name" required>
          <Input
            id="ven-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vendor category"
            htmlFor="ven-category"
            required={!vendor || !!vendor.category}
          >
            <Select
              id="ven-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              required={!vendor || !!vendor.category}
            >
              <option value="">
                {vendor ? "Uncategorised (existing)" : "Select vendor category"}
              </option>
              {VENDOR_CATEGORIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Supply / service type" htmlFor="ven-service">
            <Select
              id="ven-service"
              value={serviceType}
              onChange={(event) => setServiceType(event.target.value)}
            >
              {VENDOR_SERVICE_TYPES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" htmlFor="ven-contact">
            <Input
              id="ven-contact"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
            />
          </Field>
          <Field label="Status" htmlFor="ven-status">
            <Select
              id="ven-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as typeof status)
              }
            >
              {VENDOR_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Email" htmlFor="ven-email">
            <Input
              id="ven-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Primary phone" htmlFor="ven-phone">
            <Input
              id="ven-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field label="Secondary phone" htmlFor="ven-secondary">
            <Input
              id="ven-secondary"
              type="tel"
              value={secondaryPhone}
              onChange={(event) => setSecondaryPhone(event.target.value)}
            />
          </Field>
          <Field label="GSTIN (optional)" htmlFor="ven-gstin">
            <Input
              id="ven-gstin"
              value={gstin}
              maxLength={15}
              onChange={(event) => setGstin(event.target.value.toUpperCase())}
            />
          </Field>
          <Field
            label="Contract starts (optional)"
            htmlFor="ven-contract-start"
          >
            <Input
              id="ven-contract-start"
              type="date"
              value={contractStartsOn}
              onChange={(event) => setContractStartsOn(event.target.value)}
            />
          </Field>
          <Field label="Contract ends (optional)" htmlFor="ven-contract-end">
            <Input
              id="ven-contract-end"
              type="date"
              min={contractStartsOn || undefined}
              value={contractEndsOn}
              onChange={(event) => setContractEndsOn(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Address" htmlFor="ven-address">
          <Textarea
            id="ven-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </Field>
        <Field label="Service scope / notes" htmlFor="ven-notes">
          <Textarea
            id="ven-notes"
            value={notes}
            maxLength={1000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Coverage, renewal terms, support hours or delivery instructions"
          />
        </Field>
      </form>
    </Dialog>
  );
}

function RequestDialog({
  budgets,
  error,
  saving,
  onClose,
  onSave,
}: {
  budgets: ProcurementBudget[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createPurchaseRequest>[1]) => void;
}): ReactNode {
  const [title, setTitle] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const [department, setDepartment] = useState("");
  const [justification, setJustification] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { description: "", quantity: "1", price: "" },
  ]);

  return (
    <Dialog
      open
      onClose={onClose}
      title="New purchase request"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="request-form" loading={saving}>
            Create request
          </Button>
        </>
      }
    >
      <form
        id="request-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            title,
            budgetId: budgetId || null,
            department: department || undefined,
            justification: justification || undefined,
            neededBy: neededBy || null,
            items: items.map((item) => ({
              description: lineDescription(item),
              quantity: Number(item.quantity),
              estimatedUnitPrice: Number(item.price),
            })),
          });
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label="Budget / expense head (optional)"
          htmlFor="req-budget"
          hint="Link an exact budget so an approved order reserves only that head and cost centre."
        >
          <Select
            id="req-budget"
            value={budgetId}
            onChange={(event) => {
              setBudgetId(event.target.value);
              setDepartment(
                budgets.find((budget) => budget.id === event.target.value)
                  ?.department ?? "",
              );
            }}
          >
            <option value="">Not linked to a budget</option>
            {budgets
              .filter((budget) => budget.active)
              .map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name} · {budget.department || "Whole school"}
                  {budget.floor ? ` · ${budget.floor}` : ""}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="req-title" required>
            <Input
              id="req-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </Field>
          <Field label="Department" htmlFor="req-dept">
            <Input
              id="req-dept"
              value={department}
              readOnly={!!budgetId}
              onChange={(event) => setDepartment(event.target.value)}
            />
          </Field>
          <Field label="Needed by" htmlFor="req-needed">
            <Input
              id="req-needed"
              type="date"
              value={neededBy}
              onChange={(event) => setNeededBy(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Justification" htmlFor="req-just">
          <Textarea
            id="req-just"
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
          />
        </Field>
        <Field label="Line items" required>
          <LineItemsEditor
            items={items}
            onChange={setItems}
            priceLabel="Est. unit price"
          />
        </Field>
      </form>
    </Dialog>
  );
}

function OrderDialog({
  budgets,
  initialRequest,
  vendors,
  requests,
  error,
  saving,
  onClose,
  onSave,
}: {
  budgets: ProcurementBudget[];
  initialRequest?: PurchaseRequest;
  vendors: Vendor[];
  requests: PurchaseRequest[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createPurchaseOrder>[1]) => void;
}): ReactNode {
  const [vendorId, setVendorId] = useState("");
  const [requestId, setRequestId] = useState(initialRequest?.id ?? "");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [expectedOn, setExpectedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>(
    initialRequest
      ? initialRequest.items.map((item) => ({
          description: item.description,
          expenseHeadCode: "custom",
          gstPercent: "0",
          quantity: String(item.quantity),
          price: String(item.estimatedUnitPrice),
        }))
      : [{ description: "", quantity: "1", price: "" }],
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="New purchase order"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="order-form" loading={saving}>
            Create order
          </Button>
        </>
      }
    >
      <form
        id="order-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            vendorId,
            requestId: requestId || null,
            orderDate,
            expectedOn: expectedOn || null,
            notes: notes || undefined,
            items: items.map((item) => ({
              description: lineDescription(item),
              quantity: Number(item.quantity),
              unitPrice: Number(item.price),
              expenseHeadCode:
                item.expenseHeadCode && item.expenseHeadCode !== "custom"
                  ? item.expenseHeadCode
                  : null,
              hsnSac: item.hsnSac || null,
              gstPercent: Number(item.gstPercent || 0),
            })),
          });
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="ord-vendor" required>
            <Select
              id="ord-vendor"
              value={vendorId}
              onChange={(event) => setVendorId(event.target.value)}
              required
            >
              <option value="">Select vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name} ({vendor.status})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Approved purchase request"
            htmlFor="ord-request"
            hint="This is the internal requisition approval, not vendor approval. Selecting one loads its items."
          >
            <Select
              id="ord-request"
              value={requestId}
              onChange={(event) => {
                setRequestId(event.target.value);
                const selected = requests.find(
                  (request) => request.id === event.target.value,
                );
                if (selected) {
                  setItems(
                    selected.items.map((item) => ({
                      description: item.description,
                      quantity: String(item.quantity),
                      price: String(item.estimatedUnitPrice),
                      expenseHeadCode: "custom",
                      gstPercent: "0",
                    })),
                  );
                  const vendor = budgets.find(
                    (budget) => budget.id === selected.budgetId,
                  )?.vendorId;
                  if (vendor) setVendorId(vendor);
                }
              }}
            >
              <option value="">No request</option>
              {requests.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.requestNumber} · {row.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order date" htmlFor="ord-date">
            <Input
              id="ord-date"
              type="date"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </Field>
          <Field label="Expected on" htmlFor="ord-expected">
            <Input
              id="ord-expected"
              type="date"
              value={expectedOn}
              onChange={(event) => setExpectedOn(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="ord-notes">
          <Textarea
            id="ord-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <Field label="Line items" required>
          <LineItemsEditor items={items} onChange={setItems} includeGST />
        </Field>
      </form>
    </Dialog>
  );
}

function ReceiptDialog({
  order,
  error,
  saving,
  onClose,
  onSave,
}: {
  order: PurchaseOrder;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createGoodsReceipt>[1]) => void;
}): ReactNode {
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      order.items.map((item) => [
        item.id,
        String(Math.max(0, item.quantity - item.receivedQuantity)),
      ]),
    ),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Receive goods · ${order.poNumber}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="receipt-form" loading={saving}>
            Record receipt
          </Button>
        </>
      }
    >
      <form
        id="receipt-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            poId: order.id,
            receivedOn,
            notes: notes || undefined,
            items: order.items
              .map((item) => ({
                poItemId: item.id,
                quantity: Number(quantities[item.id] ?? "0"),
              }))
              .filter((item) => item.quantity > 0),
          });
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received on" htmlFor="rcv-date">
            <Input
              id="rcv-date"
              type="date"
              value={receivedOn}
              onChange={(event) => setReceivedOn(event.target.value)}
            />
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Ordered</th>
                <th className="text-right">Already received</th>
                <th className="w-32">Receive now</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td className="text-right tabular-nums">{item.quantity}</td>
                  <td className="text-right tabular-nums">
                    {item.receivedQuantity}
                  </td>
                  <td>
                    <Input
                      aria-label={`Receive quantity for ${item.description}`}
                      type="number"
                      min={0}
                      max={item.quantity - item.receivedQuantity}
                      step="0.01"
                      value={quantities[item.id] ?? "0"}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Field label="Notes" htmlFor="rcv-notes">
          <Textarea
            id="rcv-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function BillDialog({
  order,
  vendors,
  orders,
  error,
  saving,
  onClose,
  onSave,
}: {
  order?: PurchaseOrder;
  vendors: Vendor[];
  orders: PurchaseOrder[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createVendorBill>[1]) => void;
}): ReactNode {
  const [vendorId, setVendorId] = useState(order?.vendorId ?? "");
  const [poId, setPoId] = useState(order?.id ?? "");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayIso());
  const [dueOn, setDueOn] = useState("");
  const [amount, setAmount] = useState(order ? String(order.totalAmount) : "");
  const [notes, setNotes] = useState("");

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record vendor bill"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="bill-form" loading={saving}>
            Record bill
          </Button>
        </>
      }
    >
      <form
        id="bill-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            vendorId,
            poId: poId || null,
            billNumber,
            billDate,
            dueOn: dueOn || null,
            amount: Number(amount),
            notes: notes || undefined,
          });
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="bill-vendor" required>
            <Select
              id="bill-vendor"
              value={vendorId}
              onChange={(event) => setVendorId(event.target.value)}
              required
            >
              <option value="">Select vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Purchase order" htmlFor="bill-po">
            <Select
              id="bill-po"
              value={poId}
              onChange={(event) => setPoId(event.target.value)}
            >
              <option value="">No order</option>
              {orders.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.poNumber} · {row.vendorName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bill number" htmlFor="bill-number" required>
            <Input
              id="bill-number"
              value={billNumber}
              onChange={(event) => setBillNumber(event.target.value)}
              required
            />
          </Field>
          <Field label="Bill date" htmlFor="bill-date" required>
            <Input
              id="bill-date"
              type="date"
              value={billDate}
              onChange={(event) => setBillDate(event.target.value)}
              required
            />
          </Field>
          <Field label="Due on" htmlFor="bill-due">
            <Input
              id="bill-due"
              type="date"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </Field>
          <Field label="Amount" htmlFor="bill-amount" required>
            <Input
              id="bill-amount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="bill-notes">
          <Textarea
            id="bill-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function ExpenseDialog({
  budgets,
  vendors,
  error,
  saving,
  onClose,
  onSave,
}: {
  budgets: ProcurementBudget[];
  vendors: Vendor[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createProcurementExpense>[1]) => void;
}): ReactNode {
  const [budgetId, setBudgetId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(todayIso());

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record expense"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" loading={saving}>
            Record expense
          </Button>
        </>
      }
    >
      <form
        id="expense-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            budgetId,
            vendorId: vendorId || null,
            description,
            amount: Number(amount),
            spentOn,
          });
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Budget" htmlFor="exp-budget" required>
          <Select
            id="exp-budget"
            value={budgetId}
            onChange={(event) => {
              setBudgetId(event.target.value);
              setVendorId(
                budgets.find((budget) => budget.id === event.target.value)
                  ?.vendorId ?? "",
              );
            }}
            required
          >
            <option value="">Select budget</option>
            {budgets.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name} · {budget.department || "Whole school"}
                {budget.floor ? ` · ${budget.floor}` : ""} · available{" "}
                {formatMoney(budget.availableAmount)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" htmlFor="exp-vendor">
            <Select
              id="exp-vendor"
              value={vendorId}
              disabled={
                !!budgets.find((budget) => budget.id === budgetId)?.vendorId
              }
              onChange={(event) => setVendorId(event.target.value)}
            >
              <option value="">No vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Spent on" htmlFor="exp-date" required>
            <Input
              id="exp-date"
              type="date"
              value={spentOn}
              onChange={(event) => setSpentOn(event.target.value)}
              required
            />
          </Field>
          <Field label="Amount" htmlFor="exp-amount" required>
            <Input
              id="exp-amount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="exp-desc" required>
          <Input
            id="exp-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </Field>
      </form>
    </Dialog>
  );
}
