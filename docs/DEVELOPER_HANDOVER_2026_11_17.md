# Developer handover — 2026-11-17

## Project at a glance

DIGI Education Management Suite is a TypeScript monorepo for a school ERP. The user interface is React + Vite; the API uses Node.js, Fastify and TypeScript; PostgreSQL migrations and database utilities live in `packages/db`. Shared validation, permission, policy and domain types are in `packages/shared`; common authorization and password utilities are in `packages/core`.

The live site discussed in this project is `https://schoolerp.digivistainfotech.in/`. The repo documents a managed Node.js deployment using `server.js` and PostgreSQL. The repository itself is the developer source; it does not contain production environment values, the live database, or a recoverable copy of customer data.

## Start locally

Requirements: Node.js 22 or later, npm, and the database configuration for the intended environment. Do not copy production secrets into a developer machine or commit them.

1. Clone the repository and run `npm ci`.
2. Copy `.env.example` to `.env` and set safe local database and application values. Keep `.env` private.
3. For an embedded local PostgreSQL workflow, use `npm run dev:db`; for an already configured PostgreSQL database, run `npm run db:setup` or `npm run db:migrate` as appropriate.
4. Start API and web with `npm run dev:api` and `npm run dev:web` (or `npm run dev` where the embedded DB setup is appropriate).
5. Use `npm run db:seed:demo` only against a disposable local database. It creates synthetic demo data; never point this at production.

Common commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. The GitHub Actions workflow at `.github/workflows/ci.yml` runs these checks on pushes to `main` and pull requests. A configured workflow is not the same as a passing run; check the Actions tab for the commit you are reviewing.

## Repository map

- `apps/web/` — React pages, components, routes, styling, client API and translations.
- `apps/api/` — Fastify application, authentication/authorization, API routes and integration tests.
- `packages/db/migrations/` — ordered PostgreSQL schema migrations; never edit an applied migration to change production schema, add a forward migration.
- `packages/db/src/` — database setup, migration runner, seeds and JSON backup/restore helpers.
- `packages/shared/` — shared schemas, permission catalogue, institution policies and domain types.
- `packages/core/` — reusable authentication and authorization logic.
- `scripts/` — bootstrap, synthetic data, trial console, previews and maintenance utilities. Read a script before running it; some require a database and can write data.
- `docs/` — workflow, deployment, recovery, risks, product decisions and verification notes.

## Architecture and data safety

The API is the authority for access decisions. Roles and permissions are assigned with institution, section or linked-student scope. Preserve server-side guards when adding UI access; hiding a button is not authorization. Sensitive changes should continue to write sanitized audit events. Database migrations and seeds must use a clearly selected target database.

The application includes school and higher-education concepts, but this is not a claim of complete university functionality or compliance for every Indian state. Configure institution-specific rules only after the institution confirms them. Government attendance, payroll, fee, transport and statutory codes must be checked against official rules before being treated as authoritative.

## Deployment and support

Read [HOSTED_TRIAL.md](HOSTED_TRIAL.md), [PASSWORD_RESET_SETUP.md](PASSWORD_RESET_SETUP.md), and [OWNER_SUPPORT_HANDOVER.md](OWNER_SUPPORT_HANDOVER.md) before a release or account recovery. Use the exact deployment/environment settings from the hosting account's secret store. Do not commit `.env`, SMTP credentials, bootstrap secrets, database URLs, biometric keys, passwords, reset links, trial credentials or customer exports.

For live service recovery, first identify the affected school, release and time; inspect health and sanitized service logs; preserve the database; and test a restore into a separate database before any production restore. A rollback must be compatible with the database schema. Keep at least one trained backup operator who can deploy a tagged release without Codex.

## Product decisions captured from the project discussion

See [PRODUCT_DECISIONS_AND_REQUEST_HISTORY.md](PRODUCT_DECISIONS_AND_REQUEST_HISTORY.md) for the sanitized, developer-oriented decisions and open items. The conversation itself is not copied verbatim: it contained account recovery and hosting details that do not belong in public source control.

## Current handover status

This repository snapshot is updated as of 2026-11-17. The latest project verification notes are in [TEST_VERIFICATION_REPORT.md](../TEST_VERIFICATION_REPORT.md); they describe dated local checks, not a fresh test run for this upload. Review [KNOWN_RISKS.md](../KNOWN_RISKS.md), [REMAINING_BLOCKERS.md](../REMAINING_BLOCKERS.md), and the checklist workbook before customer rollout. The live deployment, DNS, SMTP delivery, account provisioning, backups and restore drill must be verified in the actual Hostinger account; source publication alone does not verify them.
