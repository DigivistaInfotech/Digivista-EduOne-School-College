import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: FastifyInstance;
let pool: pg.Pool;
let stop: () => Promise<void>;
let schoolId: string;
let admin: string;

let approver: string;
let yearId: string;
let vendorId: string;
let budgetId: string;
let secondBudgetId: string;
let orderId: string;
let billId: string;
async function call(
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  cookie = admin,
  payload?: unknown,
) {
  const res = await app.inject({
    method,
    url: `/api/schools/${schoolId}${path}`,
    headers: { cookie, origin: "http://localhost:5173" },
    payload: payload as never,
  });
  let body: any;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
}
async function login(email: string, password: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return String(res.headers["set-cookie"]).split(";")[0]!;
}
beforeAll(async () => {
  const { startTestDatabase } = await import("@erp/db/test-database");
  const db = await startTestDatabase();
  stop = db.stop;
  process.env.DATABASE_URL = db.url;
  process.env.NODE_ENV = "test";
  const { buildApp } = await import("../src/app");
  const { getPool } = await import("../src/db");
  pool = getPool();
  app = await buildApp();
  await app.ready();
  schoolId = (
    await pool.query(
      "INSERT INTO schools(code,name,timezone) VALUES('PROC_TEST','Procurement Test School','Asia/Kolkata') RETURNING id",
    )
  ).rows[0].id;
  yearId = (
    await pool.query(
      "INSERT INTO academic_years(school_id,code,name,starts_on,ends_on,status) VALUES($1,'2026-27','Procurement test year','2026-04-01','2027-03-31','active') RETURNING id",
      [schoolId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO user_role_assignments(user_id,role_id,school_id,scope_type)
    SELECT u.id,r.id,$1,'school' FROM users u CROSS JOIN roles r WHERE u.email IN('admin@demo.test','auditor@demo.test') AND r.code='main_admin'`,
    [schoolId],
  );
  admin = await login("admin@demo.test", "Admin@12345");
  approver = await login("auditor@demo.test", "Auditor@12345");
});
afterAll(async () => {
  await app?.close();
  const { closePool } = await import("../src/db");
  await closePool();
  await stop?.();
});

async function report() {
  const res = await call("GET", `/budget-report?academicYearId=${yearId}`);
  expect(res.status).toBe(200);
  return res.body;
}
async function approveRequest(requestId: string) {
  expect(
    (
      await call("POST", `/purchase-requests/${requestId}/decision`, admin, {
        decision: "submit",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("POST", `/purchase-requests/${requestId}/decision`, approver, {
        decision: "approve",
      })
    ).status,
  ).toBe(200);
}
async function payBill(id: string) {
  expect(
    (
      await call("POST", `/vendor-bills/${id}/decision`, approver, {
        decision: "approve",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("POST", `/vendor-bills/${id}/pay`, admin, {
        paidOn: "2026-11-06",
      })
    ).status,
  ).toBe(200);
}
describe("School procurement, GST and budget reconciliation", () => {
  it("saves vendor classification, contacts, contract dates and syntactic GSTIN validation", async () => {
    const vendor = await call("POST", "/vendors", admin, {
      name: "Campus Telecom Services",
      category: "telecom",
      serviceType: "amc",
      contactName: "Service desk",
      phone: "+91 98765 43210",
      secondaryPhone: "+91 98765 43211",
      address: "School service office",
      email: "service@example.test",
      gstin: "09abcde1234f1z5",
      contractStartsOn: "2026-04-01",
      contractEndsOn: "2027-03-31",
      notes: "Annual connectivity contract",
    });
    expect(vendor.status).toBe(201);
    vendorId = vendor.body.id;
    const item = (await call("GET", "/vendors")).body.items.find(
      (v: any) => v.id === vendorId,
    );
    expect(item).toMatchObject({
      category: "telecom",
      serviceType: "amc",
      secondaryPhone: "+91 98765 43211",
      gstin: "09ABCDE1234F1Z5",
      contractStartsOn: "2026-04-01",
      contractEndsOn: "2027-03-31",
    });
    expect(
      (
        await call("POST", "/vendors", admin, {
          name: "Bad GST",
          gstin: "invalid",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/vendors", admin, {
          name: "Bad category",
          category: "made_up_category",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/vendors", admin, {
          name: "Bad contract",
          contractStartsOn: "2026-12-01",
          contractEndsOn: "2026-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PATCH", `/vendors/${vendorId}`, admin, {
          contractStartsOn: "2028-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("PATCH", `/vendors/${vendorId}`, admin, {
          secondaryPhone: null,
          serviceType: null,
        })
      ).status,
    ).toBe(200);
    const cleared = (await call("GET", "/vendors")).body.items.find(
      (v: any) => v.id === vendorId,
    );
    expect(cleared.secondaryPhone).toBeNull();
    expect(cleared.serviceType).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT 1 FROM audit_events WHERE school_id=$1 AND entity_id=$2 AND action='procurement.vendor_updated'",
          [schoolId, vendorId],
        )
      ).rowCount,
    ).toBe(1);
    const inactive = await call("POST", "/vendors", admin, {
      name: "Inactive supplier",
      status: "inactive",
    });
    expect(inactive.status).toBe(201);
    await call("PATCH", `/vendors/${inactive.body.id}`, admin, {
      notes: "Do not reactivate by editing a note",
    });
    expect(
      (await call("GET", "/vendors")).body.items.find(
        (v: any) => v.id === inactive.body.id,
      ).status,
    ).toBe("inactive");
  });
  it("uses a canonical head and unique year, department, location and vendor dimensions", async () => {
    const body = {
      academicYearId: yearId,
      name: "Speling mistake internet",
      department: "IT & Communication",
      floor: "Ground floor",
      vendorId,
      expenseHeadCode: "internet_broadband",
      allocatedAmount: 1000,
    };
    const budget = await call("POST", "/procurement-budgets", admin, body);
    expect(budget.status).toBe(201);
    budgetId = budget.body.id;
    expect(
      (
        await call("POST", "/procurement-budgets", admin, {
          ...body,
          name: "Different spelling",
        })
      ).status,
    ).toBe(409);
    const second = await call("POST", "/procurement-budgets", admin, {
      ...body,
      name: "Phone budget",
      expenseHeadCode: "telephone_landline",
    });
    expect(second.status).toBe(201);
    secondBudgetId = second.body.id;
    const budgets = (await report()).budgets;
    expect(budgets.find((b: any) => b.id === budgetId)).toMatchObject({
      name: "Internet / broadband connection",
      department: "IT & Communication",
      floor: "Ground floor",
      vendorId,
      allocatedAmount: 1000,
    });
    expect(
      (
        await call("POST", "/procurement-budgets", admin, {
          ...body,
          floor: "First floor",
          vendorId: "00000000-0000-4000-8000-000000000001",
        })
      ).status,
    ).toBe(404);
  });
  it("calculates gross mixed-GST lines and reserves only the exact request budget even after receipt", async () => {
    const request = await call("POST", "/purchase-requests", admin, {
      title: "School connectivity purchase",
      budgetId,
      department: "Wrong department",
      items: [
        {
          description: "Internet service",
          quantity: 2,
          estimatedUnitPrice: 100,
        },
      ],
    });
    expect(request.status).toBe(201);
    const requestId = request.body.id;
    await approveRequest(requestId);
    expect(
      (
        await call("PATCH", `/procurement-budgets/${budgetId}`, admin, {
          floor: "First floor",
        })
      ).status,
    ).toBe(409);
    const order = await call("POST", "/purchase-orders", admin, {
      vendorId,
      requestId,
      orderDate: "2026-11-01",
      items: [
        {
          description: "Internet service",
          expenseHeadCode: "internet_broadband",
          quantity: 2,
          unitPrice: 100,
          gstPercent: 18,
          hsnSac: "9984",
        },
        {
          description: "No-tax telephone component",
          expenseHeadCode: "telephone_landline",
          quantity: 1,
          unitPrice: 50,
          gstPercent: 0,
        },
        {
          description: "Fractional demonstration line",
          quantity: 0.5,
          unitPrice: 0.05,
          gstPercent: 18,
        },
      ],
    });
    expect(order.status).toBe(201);
    expect(order.body.total).toBe(286.03);
    orderId = order.body.id;
    expect(
      (
        await call("POST", `/purchase-orders/${orderId}/decision`, admin, {
          decision: "approve",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("POST", `/purchase-orders/${orderId}/decision`, approver, {
          decision: "approve",
        })
      ).status,
    ).toBe(200);
    const po = (await call("GET", "/purchase-orders")).body.items.find(
      (p: any) => p.id === orderId,
    );
    expect(po.totalAmount).toBe(286.03);
    expect(
      po.items
        .map((i: any) => i.gstAmount)
        .sort((a: number, b: number) => a - b),
    ).toEqual([0, 0, 36]);
    expect(
      po.items
        .map((i: any) => i.lineTotal)
        .sort((a: number, b: number) => a - b),
    ).toEqual([0.03, 50, 236]);
    let value = await report();
    expect(
      value.budgets.find((b: any) => b.id === budgetId).committedAmount,
    ).toBe(286.03);
    expect(
      value.budgets.find((b: any) => b.id === secondBudgetId).committedAmount,
    ).toBe(0);
    expect(value.totals.available).toBe(1713.97);
    const received = await call("POST", "/goods-receipts", admin, {
      poId: orderId,
      receivedOn: "2026-11-02",
      items: po.items.map((i: any) => ({
        poItemId: i.id,
        quantity: i.quantity,
      })),
    });
    expect(received.status).toBe(201);
    value = await report();
    expect(value.totals.committed).toBe(286.03);
    expect(value.totals.actual).toBe(0);
  });
  it("caps cumulative invoices at gross order value and reconciles paid bill postings once", async () => {
    expect(
      (
        await call("POST", "/vendor-bills", admin, {
          vendorId,
          poId: orderId,
          billNumber: "OVER",
          billDate: "2026-11-03",
          amount: 286.04,
        })
      ).status,
    ).toBe(400);
    const bill = await call("POST", "/vendor-bills", admin, {
      vendorId,
      poId: orderId,
      billNumber: "NET-200",
      billDate: "2026-11-03",
      amount: 200,
    });
    expect(bill.status).toBe(201);
    billId = bill.body.id;
    await payBill(billId);
    let value = await report();
    expect(value.totals).toMatchObject({
      actual: 200,
      pending: 0,
      committed: 86.03,
      available: 1713.97,
    });
    expect(
      (
        await call("POST", "/procurement-expenses", admin, {
          budgetId: secondBudgetId,
          billId,
          description: "Wrong budget link",
          amount: 1,
          spentOn: "2026-11-06",
        })
      ).status,
    ).toBe(400);
    const first = await call("POST", "/procurement-expenses", admin, {
      budgetId,
      billId,
      description: "Partial invoice posting",
      amount: 80,
      spentOn: "2026-11-06",
    });
    expect(first.status).toBe(201);
    value = await report();
    expect(value.totals.actual).toBe(200);
    expect(value.totals.committed).toBe(86.03);
    expect(value.budgets.find((b: any) => b.id === budgetId).spentAmount).toBe(
      200,
    );
    const second = await call("POST", "/procurement-expenses", admin, {
      budgetId,
      billId,
      description: "Remaining invoice posting",
      amount: 120,
      spentOn: "2026-11-06",
    });
    expect(second.status).toBe(201);
    expect(
      (
        await call("POST", "/procurement-expenses", admin, {
          budgetId,
          billId,
          description: "Duplicate bill posting",
          amount: 0.01,
          spentOn: "2026-11-06",
        })
      ).status,
    ).toBe(400);
    const stored = (
      await pool.query(
        "SELECT vendor_id,po_id FROM procurement_expenses WHERE id=$1",
        [first.body.id],
      )
    ).rows[0];
    expect(stored).toMatchObject({ vendor_id: vendorId, po_id: orderId });
    // Old records may reference the bill without a redundant PO ID. The report must still reconcile the order.
    await pool.query("UPDATE procurement_expenses SET po_id=NULL WHERE id=$1", [
      first.body.id,
    ]);
    expect((await report()).totals.committed).toBe(86.03);
    expect(
      (
        await call("POST", "/procurement-expenses", admin, {
          budgetId,
          vendorId,
          description: "Extra unrelated spend over budget",
          amount: 900,
          spentOn: "2026-11-06",
        })
      ).status,
    ).toBe(409);
    const remainder = await call("POST", "/vendor-bills", admin, {
      vendorId,
      poId: orderId,
      billNumber: "NET-REST",
      billDate: "2026-11-04",
      amount: 86.03,
    });
    expect(remainder.status).toBe(201);
    expect(
      (
        await call("POST", "/vendor-bills", admin, {
          vendorId,
          poId: orderId,
          billNumber: "EXTRA",
          billDate: "2026-11-04",
          amount: 0.01,
        })
      ).status,
    ).toBe(400);
    await payBill(remainder.body.id);
    value = await report();
    expect(value.totals).toMatchObject({
      actual: 286.03,
      pending: 0,
      committed: 0,
      available: 1713.97,
    });
  });
  it("distinguishes pending and approved expense and keeps unallocated paid bills visible", async () => {
    const expense = await call("POST", "/procurement-expenses", admin, {
      budgetId: secondBudgetId,
      vendorId,
      description: "Approved school telephone expense",
      amount: 100,
      spentOn: "2026-11-06",
    });
    expect(expense.status).toBe(201);
    let value = await report();
    expect(value.totals).toMatchObject({
      actual: 286.03,
      pending: 100,
      available: 1613.97,
    });
    expect(
      (
        await call(
          "POST",
          `/procurement-expenses/${expense.body.id}/decision`,
          approver,
          { decision: "approve" },
        )
      ).status,
    ).toBe(200);
    value = await report();
    expect(value.totals).toMatchObject({
      actual: 386.03,
      pending: 0,
      available: 1613.97,
    });
    expect(
      (
        await pool.query(
          "SELECT 1 FROM audit_events WHERE school_id=$1 AND entity_id=$2 AND action='procurement.expense_reviewed'",
          [schoolId, expense.body.id],
        )
      ).rowCount,
    ).toBe(1);
    const bill = await call("POST", "/vendor-bills", admin, {
      vendorId,
      billNumber: "UNALLOCATED-50",
      billDate: "2026-11-05",
      amount: 50,
    });
    expect(bill.status).toBe(201);
    await payBill(bill.body.id);
    value = await report();
    expect(value.totals).toMatchObject({
      allocated: 2000,
      actual: 436.03,
      pending: 0,
      committed: 0,
      available: 1563.97,
      unallocatedActual: 50,
    });
    expect(
      value.transactions.find((t: any) => t.id === bill.body.id),
    ).toMatchObject({ budgetId: null, source: "paid_bill", amount: 50 });
    expect(value.budgets.find((b: any) => b.id === budgetId).spentAmount).toBe(
      286.03,
    );
    expect(
      value.budgets.find((b: any) => b.id === secondBudgetId).spentAmount,
    ).toBe(100);
  });
  it("serializes cumulative bill caps when two users submit invoices together", async () => {
    const order = await call("POST", "/purchase-orders", admin, {
      vendorId,
      orderDate: "2026-11-01",
      items: [
        {
          description: "Concurrency cap test",
          quantity: 1,
          unitPrice: 100,
          gstPercent: 0,
        },
      ],
    });
    expect(order.status).toBe(201);
    expect(
      (
        await call(
          "POST",
          `/purchase-orders/${order.body.id}/decision`,
          approver,
          { decision: "approve" },
        )
      ).status,
    ).toBe(200);
    const results = await Promise.all(
      ["RACE-A", "RACE-B"].map((billNumber) =>
        call("POST", "/vendor-bills", admin, {
          vendorId,
          poId: order.body.id,
          billNumber,
          billDate: "2026-11-06",
          amount: 60,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  });
});
