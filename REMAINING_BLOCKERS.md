# Remaining Blockers & External Dependencies

## 1. Zero Internal Technical Blockers

There are currently **zero** internal code, database, build, or test blockers in the School ERP repository:
- `npm test`: 142 / 142 tests pass cleanly across all modules and workflows (including Parent Portal, Student Portal, and Advanced Attendance).
- `npm run build`: Vite production bundle builds cleanly in 5.8s.
- `npm run lint`: ESLint passes with 0 errors.
- `tsc --noEmit`: 0 TypeScript errors across all 5 npm workspaces.

---

## 2. External Organizational Blockers (Awaiting Client / Management Input)

The following items are blocked solely on client-side business decisions and external vendor accounts:

| Blocker ID | Dependency Domain | Specific Requirement | Owner |
|---|---|---|---|
| **BLK-001** | Payment Gateway Credentials | Commercial merchant API keys for Razorpay / PayU to enable automated webhooks. | School Management / Finance |
| **BLK-002** | DLT SMS / WhatsApp Gateway | DLT registered Principal Entity ID and SMS gateway credentials for outbound telecom delivery. | School Administration |
| **BLK-003** | Cloud Production Hosting | Domain DNS delegation (`erp.school.edu.in`), SSL certificates, and AWS/Cloud PostgreSQL instance. | IT Administrator |
| **BLK-004** | Statutory Payroll Parameters | Formal confirmation of school trust PF / ESI exemption or deduction rules. | Trust Auditor / Accountant |
