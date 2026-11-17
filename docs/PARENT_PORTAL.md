# Parent & Guardian Portal Specification

## 1. Overview & Objective

The **Parent Portal** (`/portal`) empowers parents and legal guardians to oversee their children's complete school life. Designed for seamless mobile and desktop operation, parents can switch between multiple enrolled wards, view CBSE report cards, monitor real-time attendance compliance, download fee receipts, and submit bank transfer acknowledgements.

---

## 2. Multi-Child Household Architecture

- **Verification Guard:** Parents only see children where their `guardians` record is linked in `student_guardians` with `portal_access_status = 'verified'` and `valid_to IS NULL`.
- **Wards Navigation (`GET /api/schools/:schoolId/portal/children`):**
  - Returns all linked children (e.g. `Aarav Sharma` in Class 1-A and `Diya Sharma` in Class 3-B).
  - Child summary includes Admission Number, Class, Section, Academic Year, and Primary Guardian relationship indicator.

---

## 3. Offline Payment Submission & Verification Queue

To handle the prevalent Indian school fee payment methods (UPI apps like Google Pay/PhonePe/Paytm, NEFT/RTGS bank transfers, Cheque drops, and Demand Drafts):

### 3.1 Parent Submission Workflow (`POST /api/schools/:schoolId/portal/children/:studentId/offline-payments`)
- Parent selects payment method (`upi`, `bank_transfer`, `cheque`, `demand_draft`, `pos_slip`).
- Enters payment date, amount (₹), bank name, transaction reference / UTR number (e.g. `UPI/2026/0415/778899`), notes, and optional screenshot evidence URL.
- Creates an immutable record in `fee_offline_payment_acknowledgements` with initial status `pending`.

### 3.2 Finance Queue Review & Query Workflow (`apps/api/src/routes/offlinePayments.ts`)
- **Queue Inspection (`GET /api/schools/:schoolId/fees/offline-acknowledgements?status=pending`):**
  - Finance managers, accountants, and cashiers filter submissions by status (`pending`, `under_review`, `more_info_needed`, `verified`, `rejected`).
  - Summarizes queue totals and pending amounts.
- **Raise Query / Status Update (`POST /api/schools/:schoolId/fees/offline-acknowledgements/:id/status`):**
  - Allows finance staff to flag discrepancies (e.g., UTR mismatch, short amount deposit).
  - Sets status to `more_info_needed` with explanatory review notes for the parent.
- **Verification & Automatic Receipt Generation (`POST /api/schools/:schoolId/fees/offline-acknowledgements/:id/verify`):**
  - Finance manager validates the transaction against the school's bank statement / branch scroll.
  - Generates official receipt with canonical number (`RCPT-OFF-XXXXXXXX`).
  - Automatically posts confirmed payment into `payments` table and auto-allocates credit against open fee heads (`payment_allocations`).
  - Updates acknowledgement status to `verified` and emits audit events.

---

## 4. Attendance Shortage & Medical Explanation

- Parents are proactively warned when their child's attendance approaches or dips below the CBSE 80% threshold.
- Parents can submit formal written explanations with medical certificates, enabling the Principal and Academic Coordinator to evaluate condonation under CBSE Examination Bylaws.
