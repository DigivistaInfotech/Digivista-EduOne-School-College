# Automated Test Verification Report

## Hosted trial preparation — 9 November 2026

- The complete local regression run passed **248/248 tests in 16 files** (`hosted-trial-full-regression.log`). It used disposable PostgreSQL databases and a 300-second startup allowance for the slow Windows test host.
- The private trial console passed local checks for owner authentication, cross-origin request rejection, duplicate trial IDs and independent school renewal.
- Disposable PostgreSQL integration verified login for all 15 role presets, account-management protection, expiry of existing sessions, renewal without restart and fail-closed handling when the expiry file is missing.
- The trial expiry, hosted trial roles and existing access and teacher substitution suites passed 4/4 tests across three files (`hosted-trial-verification.log`). API, database and web TypeScript checks passed.
- The production web build passed and the development quick-login UI and passwords were absent from the built assets. Hosted HTTPS and live role smoke tests still require a provisioned target. See [Hosted trial](docs/HOSTED_TRIAL.md).
- The local demo was brought back using a recovered copy of its PostgreSQL data directory. The existing demo budget, expense and library loan rows were present, and the preview API health check passed. No reseed was used for this recovery.

## Follow-up verification — budget refresh and library mapping

After the 241-test baseline below, budget figures gained refresh-on-mount/focus, visible 30-second refresh and a manual refresh/status control. The library gained explicit subject/class offerings, automatic central member codes and corrected independent book/copy/member checkout lookup.

- Subject/class and identity suite: **5/5 passed**; existing module suite: **36/36 passed** (library-followup-tests.log).
- New central member/circulation suite: **3/3 passed** (library-circulation-final.log), after fixing a test-only permission fixture column. It covers student/staff codes, duplicate/legacy identities, active-copy/person checks, past due dates, concurrent checkout and scoped teacher delegation.
- Latest API and web TypeScript checks passed; targeted ESLint passed with no findings; production build passed (library-api-typecheck.log, library-web-typecheck.log, library-followup-lint.log, library-followup-build.log).
- Budget-specific web typecheck/build and targeted lint passed; browser manual refresh advanced its updated timestamp. Current user-added budgets and pending expenses were retained and reflected in the dashboard.
- Migration 0044 was applied only to the existing disposable preview; the Supabase bundle was regenerated with **44 migrations**. No configured school database was migrated or reset.
- Browser verified the user-confirmed Biology → Classes 11–12 offering, auto-filled STU-ADM-2026-00001 from an existing demo student, independent checkout while catalogue was class-filtered, and copy ACC-00029 issued then immediately returned with a verification note. No duplicate person or phantom stock was created.

Early follow-up test launches timed out while starting disposable databases under severe memory pressure. Sequential runs with a 300-second startup allowance completed; the repository default timeout was not changed. These are targeted follow-up results, not a claim that the earlier complete 241-test suite was rerun after the follow-up. Details: docs/LIBRARY_WORKFLOW_FIXES_2026_11_06.md.

## Verified baseline before the follow-up — 6 November 2026

| Check                                      | Result                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Full integration suite (`npm test`)        | **241 passed / 241; all 13 files passed**, no skipped tests; exit 0            |
| Workspace TypeScript (`npm run typecheck`) | Passed across all 5 workspaces; latest recheck recorded in final-typecheck.log |
| Production web build (`npm run build`)     | Passed; exit 0                                                                 |
| ESLint (`npm run lint`)                    | **0 errors, 93 warnings**; exit 0; warnings remain                             |
| Database schema bundle                     | Regenerated successfully with all 43 migrations                                |

The final integration run completed in 726.29 seconds on disposable PostgreSQL databases. Evidence: final-tests-verified.log, final-typecheck.log, final-build.log and final-lint.log. The earlier combined run exposed invalid legacy student seed scopes, an obsolete test startup timeout and a library test role that no longer met the role/scope rules. These were corrected without relaxing authorization; the complete suite was then rerun successfully. Additional regressions cover mixed-role permission scopes, real zero-record dashboards and distinct subject attendance counts.

Manual browser smoke checks used the isolated synthetic preview on 127.0.0.1:5173 with the disposable API on port 4000: DIGI branding and unchanged palette, live teacher access inspection, master selectors, class-specific/shared library filtering with zero-stock demo titles, vehicle/maintenance audit forms, vendor-category persistence, PO draft quantity/price/GST totals, budget graph/item filtering, academic term create/edit and actual parent/student portals. PO draft arithmetic was ₹200 + ₹36 GST = ₹236; no order or payment was submitted. The final student screen shows Not recorded/Not marked yet and no invented homework when records are empty.

These checks do not establish universal user acceptance, a production deployment, live microphone recognition accuracy, registry verification, external message delivery, GPS tracking or model-backed AI tutoring. No configured school database or real role grants were changed. Existing institutions require an upgrade preflight for role scopes, secrets/templates and migrations, then a representative user pilot and restore drill. See docs/APPLICATION_GAP_REVIEW.md and KNOWN_RISKS.md.

## Previous baseline verification — 6 November 2026 (before current additions)

Verified on Windows with Node.js 24.19.0 and npm 11.17.0:

| Check                                      | Current result                                        |
| ------------------------------------------ | ----------------------------------------------------- |
| Full integration suite (`npm test`)        | **202 passed / 202**, all 7 files passed              |
| Workspace TypeScript (`npm run typecheck`) | Passed across all 5 workspaces                        |
| Production build (`npm run build`)         | Passed                                                |
| ESLint (`npm run lint`)                    | **0 errors, 94 warnings**; warnings remain unresolved |

The initial recheck found 4 failing tests and 3 accessibility lint errors. Fixes
align library issue/return/fine dates, transport allocation dates, parent/student
dashboard attendance, demo attendance generation, and test date inputs with the
school timezone. Transport allocation closure now validates its dates before
writing, and saves the change and its audit record in one transaction. Audit page
filter labels now explicitly reference their controls.

The added 18 integration tests cover India-only settings and validation, version
rollback, club capacity and section scoping, activity results and certificate
locking/access/HTML escaping, class-bound practice with hidden answers,
current-affairs expiry, four question types and printable paper variants, and
administrator student policies, independent withdrawal review and readmission
without replacing the admission number or ledger.

These checks use disposable test databases and all 36 migrations. An initial
backend launch was rejected by automatic approval review. A safer, loopback-only
preview was subsequently started with its own disposable synthetic database via
`npm run preview:demo`, resolving the browser-testing blocker. Browser smoke checks
verified login, the India flag, saving MP with Hindi navigation, per-user English
override, the Activities Hub and demo participation certificate, policy centre,
and generation of four distinct 20-mark Class 8 GK papers with separate staff
answer-key links. The printable question paper was inspected separately.

The full suite completed in 203.43 seconds. Production build and workspace
TypeScript checks passed after the additions. ESLint still has 94 existing
warnings and no errors. Vite reports two non-fatal annotations in Zod dependency
comments; the production build succeeds. The initial web JS bundle is now
387.37 kB (116.85 kB gzip); larger question-editor validation code is split into a
separate chunk.

See `docs/ADDITIONS_2026_11_06.md` for new routes, operating instructions and
remaining scope. These results do not establish production readiness or
compliance with every state-specific school accounting or payroll rule.

The report below is historical and describes the earlier 30 October verification.

---

**Execution Timestamp:** 2026-10-30T17:05:00Z  
**Test Runner:** Vitest v4.1.12  
**Database:** Embedded PostgreSQL 18.4 (dynamic isolated loopback port per run)  
**Node.js Version:** v25.4.0  
**Operating System:** Windows (`win32`)

---

## 1. Summary of Execution Results

| Test Suite File                                   | Module Domains Tested                                                                                                                                                         | Tests Executed | Tests Passed | Tests Failed | Execution Duration | Status        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------ | ------------ | ------------------ | ------------- |
| `apps/api/test/parent-student-attendance.test.ts` | Complete Parent Portal (Multi-Child Aarav/Anaya), Student Portal (Age-Tiered Views), Advanced Attendance (Classes 6-12 PDF matching with 8 periods, EMP codes, substitutions) | 12             | 12           | 0            | 28.8s              | ✅ PASSED     |
| `apps/api/test/rang-biranga.test.ts`              | Indian Validation, High-Scale Seed (1,224 students), Student Portal, Offline Queue, 80% Shortage Register, Config Studio, Teacher Eligibility                                 | 24             | 24           | 0            | 34.0s              | ✅ PASSED     |
| `apps/api/test/modules.test.ts`                   | Shifts/Biometric, Recruitment, Procurement, Bank Reconciliation, CSV Import                                                                                                   | 36             | 36           | 0            | 25.4s              | ✅ PASSED     |
| `apps/api/test/api.test.ts`                       | Auth, RBAC, Academic, Admissions, Attendance, Fees, Exams, Reports, RLS                                                                                                       | 70             | 70           | 0            | 31.3s              | ✅ PASSED     |
| **Total Automated Suites**                        | **Complete School ERP Platform**                                                                                                                                              | **142**        | **142**      | **0**        | **119.5s**         | **100% PASS** |

---

## 2. Production Build & TypeScript Verification

| Scope                      | Command Executed                                                                                        | Duration | Result    | Output Summary                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------- |
| Workspace Typecheck        | `npm run typecheck` across 5 workspaces (`@erp/api`, `@erp/web`, `@erp/core`, `@erp/db`, `@erp/shared`) | 12.4s    | ✅ Code 0 | 0 type errors across all packages                                                                    |
| Frontend Production Bundle | `npm run build -w @erp/web` (Vite v7.3.7)                                                               | 6.0s     | ✅ Code 0 | 139 modules transformed; `PortalPage`: 43.18 kB, `StudentPortalPage`: 46.95 kB, `FeesPage`: 50.70 kB |

---

## 3. Detailed Breakdown of Test Suites

### 3.1 Parent Portal, Student Portal & Advanced Attendance (`parent-student-attendance.test.ts`)

- **Parent Portal: Multi-Child Dashboard & Access Scoping (3 tests):**
  - `allows parent to view Aarav dashboard with attendance, fees, transport and homework`: Verifies Aarav Sharma (Class 6-A, roll 15, admission 24A015), attendance rate, pending homework count, fee breakdown (₹5,000 tuition + ₹1,500 transport), verified receipt (`RCPT-2026-001`), pending offline acknowledgment (₹2,000), assigned vehicle (`UP 32 CZ 8901`), Route 2 Bus 07, stop ("Community Gate"), pickup (`07:15`), drop (`14:45`), active timeline, and next class.
  - `allows parent to switch child selector to Anaya with distinct class and fee information`: Switches child selector to Anaya Sharma (Class 3-B, admission 24A032), asserting separate class, section, roll number, and distinct fee structure (₹3,500 tuition).
  - `strictly enforces tenant & family isolation: parent cannot access unlinked student`: Attempts access to unlinked student; confirms rejection with privacy preservation (404/403).
- **Advanced Period-Wise Attendance — Classes 6 to 12 (`parent-student-attendance.test.ts`) (4 tests):**
  - `Aarav accesses advanced attendance matching PDF`: Verifies cumulative attendance donut (80% rate, 77 present, 19 absent, 96 working days), month-wise progression (Jul–Oct), 8 distinct periods with CBSE teacher employee codes (`EMP1034`, `EMP1048`, `EMP1066`, `EMP1075`, `EMP1102`, `EMP1121`), substitute teacher identification for Period 4 (Social Science by `EMP1121` Ms. Ritu Saxena), and subject-wise breakdown.
  - `Parent can access linked child advanced attendance`: Confirms verified guardian can retrieve the identical detailed attendance record for their child.
  - `Cross-student denial: Aarav cannot view Kabir advanced attendance`: Enforces student-level isolation across different enrolled students.
  - `Coordinator assigns substitute teacher for a timetable slot and records substitution`: Allows academic coordinator to create an active substitution record for an absent teacher.
- **Student Portal Dashboard: Age-Tiered Navigation (2 tests):**
  - `Aarav (Grade 6) accesses middle school dashboard tier with homework ticker`: Asserts `tier: 'middle_g6_g8'`, `statusToday: 'Present today'`, overall 80% rate, and populated homework ticker items.
  - `Kabir (Grade 10) accesses senior secondary dashboard tier`: Asserts `tier: 'senior_g9_g12'`, senior CBSE exam focus, and subject stream alignment.
- **Parent Self-Service Requests & Transport Preferences (3 tests):**
  - `Parent submits a planned student leave request`: Submits medical leave request with date range and reason; verifies database insertion and status tracking.
  - `Parent registers and subsequently revokes an authorised pickup person`: Adds authorized family member with Aadhaar verification; subsequently revokes authorisation.
  - `Parent updates transport alert toggles and marks message as read`: Toggles live notification preferences (boarding, dropOff, busApproaching) and confirms mark-as-read on teacher notices.

### 3.2 Rang-Biranga Edition & Core CBSE Integrations (`rang-biranga.test.ts`)

- **Universal Data Validation Engine (3 tests):** Validates and normalizes Indian mobile numbers (`+91`), Indian vehicle plates (State & BH series), and IFSC / Postal PIN codes.
- **High-Scale CBSE Demo Dataset (3 tests):** Verifies 1,224 students across Classes 1–12, 85 staff eligibility profiles, and transport fleet.
- **Student Portal Legacy Workflows (7 tests):** Kabir Menon profile, timetable, attendance, homework submissions, AI learning assistant guardrails, pastoral concerns, and profile correction workflows.
- **Offline Payment Verification Queue (3 tests):** Parent submission, finance manager review with `more_info_needed`, and dual-party verification with official auto-numbered receipt generation.
- **Attendance Compliance 80% Policy & Shortage Register (3 tests):** Computed rolling attendance shortage cases (< 80%), progressive formal warnings, and Principal condonation orders.
- **Configuration Studio (3 tests):** Dynamic setting updates, automatic schema versioning, and zero-downtime rollback.
- **Teacher Eligibility & Assignment Validation (2 tests):** PRT/TGT/PGT grade restrictions and assignment boundaries.

### 3.3 Operational Modules (`modules.test.ts`)

- **36 integration tests** covering staff biometric shifts, overtime calculations, separation checklist gates, purchase order dual approvals, bank statement reconciliation, and CSV bulk import preview/commit.

### 3.4 Core Foundation & Academic Workflows (`api.test.ts`)

- **70 integration tests** validating authentication, password hashing, session tokens, TOTP MFA, RBAC permissions, academic years, terms, classes, sections, admissions, fee structures, exam scheduling, grade calculations, and Row-Level Security tenant boundaries.
