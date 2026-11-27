# DIGI Education ERP — AI review handoff

**Prepared:** 2026-11-27
**Project:** DigiVista Infotech School ERP
**Review purpose:** Independent review for defects, missing requirements, security/data-integrity risks, and prioritized improvements before broader customer testing.

## 1. Project overview

This is a TypeScript monorepo for a school ERP aimed initially at Nursery–Class XII, with institution settings and extension points intended for college/university workflows. It is an evolving product; the module directory contains scope descriptions, and those descriptions are not proof that each listed feature is implemented.

### Architecture

- **Frontend:** React 19, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS.
- **Backend:** Node.js, Fastify 5, TypeScript, Zod request validation, cookie sessions and server-side permission checks.
- **Database:** PostgreSQL; SQL migrations, reference data and demo seeding are in `packages/db`.
- **Shared rules:** `packages/shared` contains shared schemas, types, roles and permissions.
- **Core services:** `packages/core` contains security and domain utilities such as password hashing.
- **Workspace layout:** `apps/web`, `apps/api`, `packages/shared`, `packages/db`, `packages/core`, `scripts`, `docs`.
- **Tenant model:** records are school-scoped; review every query and mutation for cross-school isolation.

## 2. Current module inventory

The navigation currently includes:

- **Home & setup:** overview, institution masters, module directory, pain points.
- **Academic & learning:** academic years, classes/stages, sections, subjects/electives, timetable/substitutions, student attendance, shortage/eligibility, lesson plans/homework, activities, GK/subject practice, paper builder, exams/question bank.
- **Students & operations:** student/guardian master, admissions/enrolment, transport, library, procurement/vendors, concerns, notices.
- **Finance & reports:** assigned fee collection, student policy centre, budget vs actual, fees/payment ledger, refunds, reports/CSV exports, saved views/batch data.
- **People & HR:** staff directory/payroll, staff attendance, recruitment/onboarding.
- **Portals, access & security:** parent and student portals, safeguarding, identity/access (RBAC), audit, configuration studio.
- **Help & training:** staff user manual.

For implementation-level routing, consult `apps/web/src/App.tsx` and `apps/web/src/lib/navigation.ts`. API route handlers are in `apps/api/src/routes/`.

## 3. Recent verified work

### Data integrity baseline

- Admission number uniqueness and guardian matching conflict protections are covered in the API suite.
- Added API coverage for rejecting duplicate staff employee numbers, auditing staff corrections, and preventing hard deletion of students, guardians and salary-linked staff.
- The API suite passed **74/74** in the latest full focused run; API typecheck passed at that time.
- The local database was empty before local school setup. No hosted database was changed.

### Notice metadata increment

- Added standard notice categories and priority (`low`, `normal`, `high`, `urgent`) to the shared schema/type, PostgreSQL schema, API read/write flow and Notices UI.
- New notice records default to General / Normal; existing records receive those defaults through migration `0046_notice_metadata.sql`.
- The focused notices API test passed; full workspace typecheck passed; production web build succeeded.
- The local migration was applied. The app is **not deployed** from this change.
- Current notice functionality already includes basic draft/publish/archive, attachments and per-user read receipts. Do not describe advanced notice features below as live.

## 4. Local preview state

- Local web preview: `http://127.0.0.1:5173/` (notice page: `/notices`).
- Local API: `http://127.0.0.1:4000`.
- Local PostgreSQL: `127.0.0.1:5433`, database `school_erp`.
- Local blank institution **Digi-School** and one `main_admin` account have been created to let the owner inspect the app. Do not include, print, reset or change its password in the review report.
- No student, guardian or staff demo records were added. The user intends to enter records manually for workflow evaluation.
- Do not run destructive database commands (`db:reset`, schema drops, reseeding over an existing DB) or use hosted credentials.
- The application and latest edits are local only. No Hostinger/GitHub deploy or push was performed as part of this change.

## 5. Document-driven backlog

The uploaded source specifications are summarized in `docs/product-roadmap/School-ERP-Document-Backlog.md`. The original source files were:

- `School ERP (1).docx` — academic structure, exams, assessment, result processing, report cards and analytics.
- `Notice Module of my School ERP into a professional.docx` — notices, recipients, approvals, templates, scheduling, attachments, read/delivery/acknowledgement tracking, integrations and reports.

Important remaining work includes:

- Notice audience targeting and recipient preview/deduplication.
- Admin-managed notice categories and permission-controlled urgent publishing.
- Notice templates, maker-checker approvals, backend scheduling/expiry, acknowledgements, dashboard and report exports.
- Academic year rollover, stream/division setup, class-subject/elective mapping, practical/lab allocations and academic reports.
- Marks submission/verification/correction controls, result locking/publication, report-card templates, admit cards and reconciled analytics.
- Consistent manual and import admission rules.
- Complete end-to-end synthetic-data workflow review before real student data is entered.

Some requirements in the source documents are broad product requests. Confirm existing behavior before classifying a requirement as missing. Mark an item Complete only after it is implemented and verified.

## 6. Existing project references

Start with these documents before making recommendations:

- `README.md`
- `docs/DEVELOPER_HANDOVER_2026_11_17.md`
- `docs/APPLICATION_GAP_REVIEW.md`
- `docs/PRODUCT_DECISIONS_AND_REQUEST_HISTORY.md`
- `docs/product-roadmap/School-ERP-Document-Backlog.md`
- `KNOWN_RISKS.md`
- `IMPLEMENTATION_STATUS.md`
- `REMAINING_WORK.md`
- `REQUIREMENTS_TO_IMPLEMENTATION_MATRIX.md`
- `TEST_VERIFICATION_REPORT.md`
- `docs/DEVELOPER_RELEASE_CHECKLIST.md`
- `docs/School_ERP_Developer_Checklist_2026-11-17.xlsx`

## 7. Review tasks

1. Inspect the code and migrations; do not infer feature status from UI labels or roadmap descriptions alone.
2. Review tenant isolation, authentication/session lifecycle, permissions, audit coverage, sensitive data exposure and delete/update semantics.
3. Trace major workflows end to end: admission/import → enrollment → attendance → fees/receipts → exams/results/reports; and notice draft → publish → audience access → read tracking.
4. Compare those workflows with the uploaded specifications and the project backlog; identify completed, partial, missing and unverified requirements separately.
5. Check dashboard/report metrics against database queries and filters. Flag placeholder, stale, or unreconciled counts.
6. Check migration safety, import/manual validation parity, duplicate handling, performance hotspots and failure/retry behavior.
7. Run appropriate non-destructive checks against a disposable/local test database only. Report exact commands, suites, pass/fail counts and limitations.
8. Return a prioritized findings list with severity, affected module/files, evidence, user impact, recommended fix and acceptance criteria.

## 8. Change constraints

- Preserve existing workflows and records; prefer additive, backward-compatible changes.
- Do not delete, reset, merge or reseed school data without explicit authorization.
- Do not deploy, push commits, contact third parties, or modify hosted services.
- Do not expose passwords, `.env` values, tokens, SMTP configuration or personal/student data.
- Do not claim SMS, email, WhatsApp, push, AI, biometric, statutory, government-code or university functionality works unless verified with the actual provider/rules and code path.
- Keep UI redesign as a later phase; make only necessary presentation changes for current functionality.
- Provide recommendations first. Make code changes only for specifically authorized scope.

## 9. Copy-ready request for the reviewing agent

> Independently review the DIGI Education ERP using this handoff and the referenced project documents. Inspect the current code, migrations, permissions, tests and UI routes. First return an evidence-backed gap and risk report with prioritized findings and acceptance criteria. Separate implemented, partial, upcoming and unverified behavior. Do not change code, seed/reset data, deploy, push or access hosted services. Do not include credentials or student data. If later asked to implement, preserve existing records and behavior, work in small backward-compatible increments and report exact verification results.
