# Developer release and handover checklist

Use this before sharing a release with an internal tester or customer. Record the commit SHA, environment, date, verifier and evidence in the Excel checklist. Do not mark a check complete based on source code alone.

## Source and onboarding

- [ ] README and current handover document match the checked-out commit.
- [ ] `.env` and all provider/host secrets are absent from Git history; `.env.example` contains placeholders only.
- [ ] Node/npm versions meet `package.json`; clean install works with `npm ci`.
- [ ] New developer follows setup steps using disposable local data.
- [ ] Schema changes use forward migrations; migration order and rollback/restore plan are reviewed.
- [ ] GitHub Actions status is checked for the exact commit; do not infer pass from workflow configuration.

## Security and roles

- [ ] API authorization and record scope are verified for each affected role; UI visibility alone is insufficient.
- [ ] Institution isolation is checked using the actual runtime database role.
- [ ] Owner-only company/trial controls are inaccessible to school admins and staff.
- [ ] Account recovery is verified end-to-end; temporary bootstrap keys are removed immediately.
- [ ] Audit logs avoid secrets, student sensitive data and safeguarding note content.
- [ ] Public repo contains no customer exports, credentials, reset links, backup files, local databases or generated logs.

## Data, operations and release

- [ ] Production variables are copied into the host secret store without replacing unrelated variables.
- [ ] HTTPS, DNS, API health, database connectivity and mail delivery are checked on the real domain.
- [ ] Backup schedule and retention are documented; restore is rehearsed into an isolated database.
- [ ] Rollback release is compatible with the migrated schema and retained data.
- [ ] Named primary and backup operators can restart, deploy and restore without Codex.
- [ ] Data processing, access, retention and incident responsibilities are agreed with the customer.

## Product acceptance

- [ ] Institution package entitlement matrix matches user roles and API permissions.
- [ ] Student, parent, teacher, principal, finance, management and support journeys are reviewed where applicable.
- [ ] Fees, attendance, library, transport, procurement, notices, examinations and reporting are checked against school policy.
- [ ] State/government rules cite an official source and effective date or are clearly marked as school-configurable.
- [ ] Optional features that rely on external services (email, messaging, payment, AI, voice/biometrics) are accurately described.
- [ ] School/college-specific gaps and acceptance feedback are recorded before sale.
