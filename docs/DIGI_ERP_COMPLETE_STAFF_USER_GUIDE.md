# DIGI Education ERP — Complete Staff User Guide

This guide follows the current application routes and visible workflows. Menu items and actions depend on the permissions assigned to your account. Use the selected institution carefully; records and reports are scoped to that school.

## 1. Quick start: how this ERP saves time

1. Open `/login`, sign in with your assigned account, and choose the institution on `/select-institution` if prompted.
2. Check the active institution in the application header. In each workflow, select the correct academic year before creating or reviewing records. Some pages remember their own year filter; changing one page does not necessarily change every other page.
3. Enter shared information once. A student admission creates the student, guardian links, and enrollment; that enrollment then supplies the attendance register, fee assignment, examination lists, and reports. Recorded payments create ledger allocations and receipts. Marks feed result cards only after the exam workflow is complete.

```text
Institution + academic year
  ├─ Classes → Sections → Subjects → Timetable
  └─ Admission → Student + Guardian + Enrollment
                    ├─ Attendance → shortage / eligibility → attendance report
                    ├─ Fee structure → charge → payment ledger → receipt / refund
                    └─ Exam → subjects → marks → publish / lock → result card
Notices → audience + category + priority → publish → read receipts
Finance records → budget vs actual → reports / CSV / print
```

![SCREENSHOT PLACEHOLDER: Login and institution selection with Digi-School selected]

## 2. Role-based daily checklists

These are practical role suggestions, not automatic job assignments. A user's actual access is determined by their granted permissions. Ask an administrator if an expected menu item is missing.

| Team | Daily | Weekly / periodic |
|---|---|---|
| Front Office / Admissions | Review Student & guardian master; use **Admissions & enrolment** for a new student; confirm year, section, guardian contact, and document checklist. | Review incomplete admission details and enrollment history; print the admission summary when a paper record is needed. |
| Class Teachers | Open **Student attendance**, choose year, section and date; mark and save the register. Use correction requests for saved marks. | Review **Shortage & eligibility** cases and report missing/incorrect records to the authorized reviewer. |
| Exam Cell | In **Exams & question bank**, create or review exam setup, subjects and marks; check incomplete marks before requesting publication. | Verify results, publish only after approval, and print the correct student result card or transcript. |
| Accounts / Admin | In **Fees & payment ledger**, review charges and record/verify payments as allowed; open and print receipts; monitor refund status. | Reconcile **Reports & CSV exports** and **Budget vs actual expense** with source records. Review pending refunds and unallocated items. |
| Principal / Management | Review the Overview, attendance shortage, exam status, notices and finance summaries visible to your role. | Review reports, audit history and role access; confirm notices have the intended audience and published status. |

## 3. Screen-by-screen guides

### A. Institution and academic setup

**Exact screens & routes:** Home & Setup → **Institution masters** (`/institution-masters`); Academic & Learning → **Academic years** (`/academic/years`), **Classes & stages** (`/academic/classes`), **Sections** (`/academic/sections`), **Subjects & electives** (`/academic/subjects`), **Timetable & substitutes** (`/academic/timetable`).

![SCREENSHOT PLACEHOLDER: Academic years list showing the active year and New academic year action]

**How to enter:** Start with the academic year and its dates. Use **New academic year**, enter the year name/code and start/end dates, then save. Activate the intended year only after checking the confirmation; activation closes the previous active year while preserving its enrollment history. Add classes with their name/code/grade order, then sections for the year and class. Add subjects/electives and configure timetable periods, rooms, lessons and substitute coverage on their screens. In **Institution masters**, select the category and institution type, enter a stable code and display name, then choose **Add master value**.

**Why it matters:** Sections, enrollment, attendance and results reference academic setup records. Reusing master values reduces spelling variants and broken mappings.

**Troubleshooting:** If a section is absent during admission or attendance, verify that it belongs to the selected year and is active. If you cannot add/edit setup, ask for the relevant academic management permission. Activating the wrong year affects which year is marked active; review the confirmation first.

### B. Students, guardians and admission summary

**Exact screens & routes:** Students & Operations → **Student & guardian master** (`/students`), **Admissions & enrolment** (`/students/new`), then open a student record at `/students/:id`.

![SCREENSHOT PLACEHOLDER: New admission form with student details, placement and guardian sections]

**How to enter:** Select **Admissions & enrolment → New admission**. Required fields are first name, date of birth, gender, home address, city, state, PIN code, emergency contact, academic year, class/section, enrollment start date, and the primary guardian's first name and relationship. A guardian must have an email or phone so the record can be matched. Leave admission number blank to use the school sequence. Aadhaar is optional: enter only the last four digits. Add a second guardian if available. Set each admission-document checklist status to `received`, `verified`, `not provided`, or `not applicable` as appropriate. Review placement and capacity warning, then choose **Admit student**. The application opens the new student profile after saving.

Demo values for a safe test: academic year `2026-27 [DEMO]`, class/section such as `Class 6-A`, and the existing demo admission numbers `ADM-DEMO-101` to `ADM-DEMO-103`. Do not use real sensitive identifiers in demo records.

On the student profile, review **Profile**, **Guardians**, **Address and safety**, **Admission documents**, and **Enrollment history**. Choose **Print admission summary** for the printable profile.

**Why it matters:** One admission creates the linked student, guardian and enrollment records used by attendance, fees, exams and reports. Avoid creating the same student again from a generic data tool.

**Troubleshooting:** If no year exists, use **Academic years** first. If no section appears, check year/class setup. Duplicate admission number or guardian contact validation means review the existing student/guardian master before retrying. The document checklist records status; it does not upload files.

### C. Daily attendance and shortage

**Exact screens & routes:** Academic & Learning → **Student attendance** (`/attendance`) and **Shortage & eligibility** (`/attendance/shortages`).

![SCREENSHOT PLACEHOLDER: Attendance register with year, section, date, student rows and Save action]

**How to enter:** Choose academic year, section and date. The register lists students whose enrollment covers that date. Mark each status using the available row controls; use the bulk action only after confirming the section and date. Save the register. A saved mark is not edited in place: submit a correction request, and an authorized different user reviews it. Use the shortage page to review below-threshold cases and record only supported warning/explanation/eligibility actions.

**Why it matters:** Attendance is keyed by section, date and enrollment. Correct year/section selection prevents marks being attached to the wrong class; the correction flow keeps a review trail.

**Troubleshooting:** A student may not appear if their enrollment does not cover the selected date. Future dates, dates outside the academic year and inactive sections can be read-only or blocked. If you cannot approve a correction you created, ask a second authorized reviewer.

### D. Fees, receipts, refunds and CSV exports

**Exact screens & routes:** Finance & Reports → **Fees & payment ledger** (`/fees`); **Assigned fee collection** (`/fee-collection`) for users with collection permission; **Reports & CSV exports** (`/reports`).

![SCREENSHOT PLACEHOLDER: Fees page on Charges tab with year selected and a student charge row]

**How to enter:** Select the academic year. Under **Fee heads & structures**, configure the school's existing fee heads and class/year structures. Under **Charges**, use **Generate charges** for the configured structure or **Add charge** for an individual student. Check student, fee head, due date and net amount before saving. Under **Record payment**, select the student, payment date/method and allocation details shown in the dialog, then save. The receipt number is generated by the system; after saving, the page opens **Payments** and offers **Open receipt**. The Payments row also has **Receipt**, **Refund** (when permitted), and **Ledger** actions. Refund requests remain separate from the original payment and require the authorized review flow. Reports exposes fee summaries and **Export fee ledger CSV**.

**Why it matters:** Charges, allocations, concessions/write-offs, receipts and refunds are separate ledger events. Read the balance and refund status separately; do not treat a refund request as a payment reversal until it is approved/recorded.

**Troubleshooting:** Confirm the year and student before posting. If no charges exist, build the fee structure or add/generate charges first. If the receipt does not open, allow the browser's new tab/popup and use the Receipt action from Payments. CSV results follow your permission and selected report scope.

### E. Budget vs actual and expenses

**Exact screens & routes:** Finance & Reports → **Budget vs actual expense** (`/budget-report`); Procurement & vendor → budget management at `/procurement?tab=budgets`.

![SCREENSHOT PLACEHOLDER: Budget vs actual page showing KPI cards, budget bars and item-wise expense table]

**How to enter/review:** On the budget report, select the academic year, expense group, department and location as needed. Click a budget row/bar to scope the report to that allocation. Click **Allocated budget**, **Actual approved / paid expense**, **Pending recorded expense**, **Open-order commitments**, **Available after reserves**, or **Over budget / unallocated shortfall** to jump to the related breakdown. The item table identifies expense/budget, department/location, vendor, description, status/source and amount. Use **Show unallocated items** to inspect paid bills without an exact budget allocation. Use **Print budget report** for a paper/PDF view; **Manage budgets** opens the existing procurement budget screen.

**Why it matters:** This view compares budget allocation with approved expense, pending expense and remaining purchase commitments. Availability is an allocation balance, not bank/cash balance. Linked bills and expenses are counted once according to the report's matching logic.

**Troubleshooting:** If an expense is missing, confirm academic year, status and budget assignment; check unallocated items and filters. A red balance is an over-budget/shortfall signal; review the item rows before changing the allocation.

### F. Exams, marks, result locking and report cards

**Exact screen & route:** Academic & Learning → **Exams & question bank** (`/exams`).

![SCREENSHOT PLACEHOLDER: Exams page showing selected year, exam list and Draft status]

**How to enter:** Select the academic year. Create a grading scheme if required, then create an exam and add its subjects with maximum and passing marks. Open mark entry for a subject and section; enter marks within the displayed maximum, or mark a student absent where applicable. Save marks and review incomplete rows. Publishing requires the exam subjects to be ready and changes the exam to published/locked. To correct published marks, use the authorized unpublish flow, revise, then publish again. Open **Report cards**, select a student, review the status banner and choose **Print result card**. Use **Print transcript** for the student's published-exam transcript.

Demo example: select `2026-27 [DEMO]`, then the existing demo students. Verify a draft result says `DRAFT · not published`; published results say `Published · marks locked`.

**Why it matters:** The marks sheet, result calculation and report card share the same exam records. Locking prevents unnoticed edits after publication.

**Troubleshooting:** No marks rows usually means no active enrollment in the selected section or no exam subject. An incomplete report card indicates a subject without marks. If the exam is published, marks are intentionally locked until an authorized unpublish action.

### G. Notices and read receipts

**Exact screen & route:** Students & Operations → **Notices & broadcast** (`/notices`).

![SCREENSHOT PLACEHOLDER: New notice form with audience, category, priority, expiry and attachment controls]

**How to enter:** Choose **New notice**, enter its title and body, select the audience, category and priority, and set an expiry date/pin or attachment only if needed. Save as draft to review it first. From **Drafts**, choose **Publish** when the text and audience are correct. The Published list shows published notices; use the read status/receipts on the notice to see recorded acknowledgements. Archive a notice when it should no longer remain active; unpublish returns it to Drafts. **Print notice report** prints the current list.

**Why it matters:** The audience and published/expiry state control who can see the notice. Category and priority help staff sort and respond consistently.

**Troubleshooting:** A draft is not visible to families. A notice may disappear from active views after expiry or archive. Publishing does not mean SMS, WhatsApp or email delivery; external delivery is not represented as available here. After publish/archive/unpublish, the application now opens the corresponding status tab.

### H. Reports, permissions and audit logs

**Exact screens & routes:** Finance & Reports → **Reports & CSV exports** (`/reports`); Portals, Access & Security → **Identity & access (RBAC)** (`/users`) and **Audit trail & security** (`/audit`).

![SCREENSHOT PLACEHOLDER: Reports page with date/year filters, summary cards and CSV export buttons]

**How to review:** On Reports, choose the available academic-year/date filters, inspect attendance, fee, class and collection summaries, then use the relevant **Export … CSV** action. Use **Print report** for the current report view. In Identity & access, review each user's assigned roles and permissions and grant only what the user's work requires. Audit trail is for authorized reviewers to inspect recorded administrative actions. Dashboard role previews illustrate layouts and do not change real permissions.

**Why it matters:** Reports should be checked against the chosen scope and source records. Least-privilege access reduces accidental exposure, while audit history supports follow-up.

**Troubleshooting:** A missing menu or empty report can mean the role lacks permission, filters exclude the records, or no source records exist. Ask an administrator to verify both permission and school/year scope; do not share another user's login.

## 4. Printable slips and reports reference

| Output | Exact clicks | Notes |
|---|---|---|
| Admission summary | Student & guardian master → open student → **Print admission summary** | Includes available profile, admission number, enrollment, guardian and checklist data. |
| Fee receipt | Fees & payment ledger → **Payments** → row **Receipt**; after recording, **Open receipt** | Receipt view reflects the saved payment and linked ledger details. Refund status is a separate record. |
| Result card / marksheet | Exams & question bank → exam → **Report cards** → choose student → **Print result card** | The card labels draft vs published/locked status. Confirm publication status before sharing as final. |
| Student transcript | Same report-card dialog → **Print transcript** | Covers published exams for the selected academic year. |
| Attendance / fee summary | Reports & CSV exports → select report scope → **Print report** or relevant **Export … CSV** | Printed/exported output follows selected filters and access permissions. |
| Budget summary | Budget vs actual expense → filters / KPI drill-down → **Print budget report** | Check the displayed year and selected budget scope. |
| Notice list | Notices & broadcast → choose status tab → **Print notice report** | Prints the currently selected notice view. |

## Current workflow boundaries

- Menu access and actions vary with role permissions; dashboard preview selection does not grant access.
- Admission document statuses are a checklist, not uploaded files.
- Notices are in-app records; do not promise SMS, WhatsApp or email delivery based on this guide.
- Demo records are for walkthroughs only. Validate local policy, report scope and recipient selection before using any output operationally.
