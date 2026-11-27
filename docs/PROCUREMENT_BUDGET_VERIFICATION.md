# Procurement and budget reconciliation verification — 6 November 2026

## Verified scenarios

The Fastify integration fixture uses a new school and academic year inside a disposable PostgreSQL database. It does not reset, migrate or alter the normal configured school database.

- Vendor category/service classification, second contact, contract dates and syntactic GSTIN validation; editing notes preserves an inactive supplier’s status. Explicit nullable supplemental fields can be cleared.
- A school expense selection saves its canonical name. Duplicate year/head/department/location/vendor budgets are rejected while a different head in the same department remains distinct.
- Mixed GST and a fractional line produce the server-calculated taxable/GST/gross amounts; zero means no GST added. Example: ₹200 at18%, ₹50 at0%, and0.5×₹0.05 at18% produce gross₹286.03 under the existing database rounding rule.
- An approved requisition links to one exact budget. Its commitment is not copied onto every budget sharing the department. A requisition cannot generate duplicate active purchase orders.
- Receipt of goods keeps the order committed until its financial amounts are posted/paid; receipt alone does not restore available budget.
- Non-void invoices cumulatively cannot exceed the GST-inclusive issued order total. A concurrent invoice test verifies that two submissions cannot bypass the cap.
- Linked bill/order/vendor/budget references must agree. Bill postings cannot exceed the bill amount, and omitted redundant order/vendor IDs are derived from the bill.
- A paid bill and its full/partial expense postings are counted once. Legacy records that contain the bill ID without a redundant PO ID still reduce the correct order commitment.
- Paid-but-unposted invoices already allocated to a budget count when rejecting additional unrelated spend over that allocation. Posting the same paid invoice does not consume the allocation twice.
- Pending expenses reserve budget; approved expenses become actual. Paid invoices without a budget remain visible as unallocated actual expenditure rather than disappearing from the report.

## Corrections made during verification

| Before | Corrected behaviour |
|---|---|
| UI promised an order-total invoice cap, but vendor-bill POST did not enforce one | Server enforces the cumulative gross cap under an order lock |
| Aggregate caps could be evaluated before a row-lock wait | Locks are acquired first, then a new query reads current committed totals |
| Expense references could point to a different vendor, order or budget | Relationships are checked and canonical linked IDs saved |
| Bill-only expense references could leave a duplicate commitment | Report derives the order reference from the linked bill when needed |
| Fully received orders released their commitment before payment/posting | Received orders remain in open financial commitments |
| Creation defaults could reactivate a vendor or budget on an unrelated PATCH | PATCH fields remove creation defaults |
| Vendor/budget metadata edits and expense decisions lacked complete mutation evidence | Relevant changes and bill payment now record audit evidence in the same transaction |

## Scope and limits

These tests verify application arithmetic, ownership, approval boundaries and reconciliation. They do not certify GST rates, GSTIN registration, tax-invoice compliance or government account codes. The chosen expense catalogue is a convenience master. Actual/available amounts represent budget utilisation and reserves, not a bank balance.

Reconciliation relies on explicit bill and order identifiers. Independently re-entering the same physical purchase without those relationships needs finance review; the system does not guess that two similar descriptions or amounts are the same transaction. Historical ambiguous/unallocated costs remain visible.

## Final targeted result

**6/6 integration tests passed** in60.32seconds. API TypeScript check passed. Targeted ESLint completed without errors or warnings.

## Commands

- `npx vitest run apps/api/test/procurement-budget.test.ts`
- `npx tsc --noEmit -p apps/api/tsconfig.json`
- `npx eslint apps/api/src/routes/procurement.ts apps/api/src/lib/budgetReport.ts apps/api/test/procurement-budget.test.ts`

Final coordinated whole-application test evidence is maintained by the parent task.
