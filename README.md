# DIGI Education Management Suite

A TypeScript monorepo for a school ERP, developed by Digivista Infotech. The user interface is React + Vite, the API is Node.js + Fastify, and PostgreSQL schema and seed tooling live in `packages/db`. Shared validation and permission models are in `packages/shared`.

This working project includes database-backed identity and access, academic structure, admissions, attendance, timetables, fees, examinations, staff/HR, notices, safeguarding, reports, parent/student portals, transport, procurement, library, activities and institution configuration. See the module inventory in this README and the developer handover for architecture and setup.

> **Scope and release status:** This is an evolving product, not a claim of complete statutory or university compliance. Payroll rules, payment gateways, messaging, full university progression, state-specific government codes, live AI/voice/biometric functions and some provider integrations need validation or additional implementation. Role controls and tenant boundaries require ongoing security review. Review [Known Risks](KNOWN_RISKS.md), [Implementation Status](IMPLEMENTATION_STATUS.md), [Remaining Work](REMAINING_WORK.md) and the dated [Verification Report](TEST_VERIFICATION_REPORT.md) before a customer rollout.

## Start here

1. Read [Developer Handover](docs/DEVELOPER_HANDOVER_2026_11_17.md).
2. Install Node.js 22 or later; run `npm ci`.
3. Copy `.env.example` to `.env` and configure a disposable local database. Never commit `.env`.
4. Follow database setup in [Supabase Setup](docs/SUPABASE_SETUP.md) or the local embedded PostgreSQL scripts described in the handover.
5. Start the API and web app with `npm run dev:api` and `npm run dev:web`.
6. For synthetic local demo data only, use `npm run db:seed:demo` against a disposable database.

Useful commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. GitHub Actions is configured in `.github/workflows/ci.yml` for pushes to `main` and pull requests; inspect the Actions tab to confirm a specific commit passed.

## Project documents

- [Developer handover](docs/DEVELOPER_HANDOVER_2026_11_17.md)
- [Product decisions and request history](docs/PRODUCT_DECISIONS_AND_REQUEST_HISTORY.md) — sanitized project requirements, not a raw conversation dump
- [Release checklist](docs/DEVELOPER_RELEASE_CHECKLIST.md)
- [Excel developer checklist](docs/School_ERP_Developer_Checklist_2026-11-17.xlsx)
- [Application gap review](docs/APPLICATION_GAP_REVIEW.md)
- [Password reset setup](docs/PASSWORD_RESET_SETUP.md)
- [Hosted trial and deployment](docs/HOSTED_TRIAL.md)
- [Owner support handover](docs/OWNER_SUPPORT_HANDOVER.md)
- [Known risks](KNOWN_RISKS.md)
- [Requirement traceability](REQUIREMENTS_TO_IMPLEMENTATION_MATRIX.md)
- [Test verification history](TEST_VERIFICATION_REPORT.md)

## Repository hygiene

Commit source, migrations, documentation, lockfiles, and required static assets. Do not commit `.env`, credentials, school exports, database files, backups, `node_modules`, build output, local logs or temporary preview configuration. Review any seed or operations script before running it against a non-disposable database.
