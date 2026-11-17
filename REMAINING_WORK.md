# Remaining Work & Handover Roadmap

## 1. Core Feature Status

All functional features targeted by the School ERP — Rang-Biranga Edition specification, including the **Parent Portal**, **Student Portal (Age-Tiered Views)**, and **Advanced Attendance Management for Classes 6–12 (PDF specification)** are implemented, connected end-to-end to PostgreSQL, and verified through automated test suites (**142 / 142 passing tests** across 4 suites) and production builds (0 type errors, clean Vite production bundle).

---

## 2. Completed Scope Summary

1. **Parent Portal (Module 1):**
   - Multi-child switcher (Aarav Sharma Class 6-A & Anaya Sharma Class 3-B) with dynamic child-scoped state refresh.
   - Comprehensive dashboard layout matching the reference mockup (`media_1793353573256_cfc3af63.png`).
   - Fees & Payments with UPI demo modal, breakdown (Tuition ₹5,000 + Transport ₹1,500), verified receipts (`RCPT-2026-001`), and pending offline acknowledgment (₹2,000).
   - School Bus & Safety with assigned vehicle (`UP 32 CZ 8901`), Route 2 Bus 07, Community Gate stop, pickup/drop timings (`07:15` / `14:45`), 5-stop route timeline, and live notification toggles.
   - Today at school, direct teacher notices, leave request submission modal, authorized pickup persons management modal, school documents/consents, and upcoming events calendar.
2. **Student Portal (Module 2):**
   - Welcoming age-appropriate header ("Hello, Aarav! Let's learn something wonderful today.") matching reference mockup (`media_1793353595607_7741334d.png`).
   - 6 large illustrated module cards with subtle pastel hover states: My Profile, Attendance, Homework, My Timetable, Learning Corner, Notices & Calendar.
   - Bottom "Today's homework" ticker with subject icons and quick action pill.
   - Age-tiered navigation spanning Primary (Nursery–G2), Elementary (G3–G5), Middle (G6–G8), and Senior Secondary (G9–G12).
   - Real interactive tabs for Timetable, Homework Submission, AI Curriculum Assistant, Demographics Profile Correction, and Student Pastoral Concerns.
3. **Advanced Attendance Management (Module 3):**
   - Cumulative donut showing exact PDF-specified statistics: 80% rate, 77 present days, 19 absent days, 96 total working days.
   - Month-wise progression cards (Jul–Oct).
   - 8 daily periods table featuring CBSE teacher employee codes (`EMP1034`, `EMP1048`, `EMP1066`, `EMP1075`, `EMP1102`, `EMP1121`).
   - Teacher substitution tracking (Period 4 Social Science substitution by `EMP1121` Ms. Ritu Saxena).
   - Subject-wise breakdown table and CBSE 80% attendance shortage threshold alert.

---

## 3. Recommended Follow-ups & External Commercial Integrations

### 3.1 External Gateway Integrations (Requires School Merchant Credentials)
1. **Online Payment Gateway:**
   - *Current State:* Supported via the Offline Payment Verification Queue (parents submit UPI/bank transfer details; finance office verifies against bank scroll and issues canonical receipts).
   - *Follow-up:* Plug in Razorpay or PayU Webhook listeners once the school signs its commercial merchant agreement.
2. **Telecommunication (SMS / WhatsApp):**
   - *Current State:* Notices, circulars, fee reminders, and attendance shortage alerts are delivered in-app to student and parent portal accounts.
   - *Follow-up:* Bind an SMS/WhatsApp gateway (e.g. MSG91, Gupshup) using the existing notification hooks once DLT registration is approved.
3. **Live GPS Hardware Telematics:**
   - *Current State:* Full transport allocation, vehicle fleet (Indian and BH series), stops, schedules, route timeline, and parent notification preferences are fully active and wired. GPS tracking displays an honest `DEMO GPS - NOT LIVE` label in compliance with project rules.
   - *Follow-up:* Connect hardware AIS-140 GPS telematics or mobile driver app websockets when vehicles are fitted with approved devices.

### 3.2 Statutory Compliance & Financial Reconciliations
1. **Payroll Statutory Deductions:**
   - *Current State:* Payroll run computes allowances, overtime, and explicit deductions.
   - *Follow-up:* Confirm school-specific Provident Fund (PF), ESI, and Tax Deducted at Source (TDS) percentages with the school management committee (see `CLIENT_DECISIONS.md`).

### 3.3 Production Infrastructure
1. **Managed Database Provisioning:**
   - Migrate from local/embedded PostgreSQL to AWS RDS PostgreSQL or DigitalOcean Managed Database with automated point-in-time recovery (PITR).
2. **Object Storage:**
   - Point document and homework attachment uploads to S3-compatible cloud storage (e.g. AWS S3, Cloudflare R2).
