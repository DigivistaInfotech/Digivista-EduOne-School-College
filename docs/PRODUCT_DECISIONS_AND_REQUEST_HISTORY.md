# Product decisions and request history

Sanitized engineering notes from the project discussion, current through 2026-11-17. These are design intentions, not proof that every item is implemented. Check the code, tests and risk register before promising a capability.

## Confirmed product direction

- Brand: DIGI Education Management Suite by Digivista Infotech. Keep the existing application colors; the desired positioning line is “One school, one connected future.”
- Institution coverage: three access packages—Nursery–Grade 5, Grades 6–12, and College/University—plus an all-institution option. Packages should scope access to modules appropriate for the institution; Digivista Infotech retains a separate company-level administration layer across institutions. Validate the exact entitlements and tenant isolation before sale.
- Geography: India first, with state selected per institution. Admin-configurable heads and policies should be supported. Do not preload or claim every state’s legal/government code as verified without official sources and effective dates.
- Workflow additions requested over time: role/access visibility for quick testing; teacher substitution when absent; voice attendance as an optional input method; institution-specific fee collection workflows; student admission/readmission policies; class and subject-aware library catalogue; central student/staff identity; transport routes, vehicle audit/maintenance and renewals; purchase orders with item, quantity, rate and GST; budget versus expense drill-down; school activities/GK/question-paper generation; multilingual support.
- Existing workflows should remain stable where possible. Prefer additive, separately testable extensions and focused bug fixes.
- Trial operations: one owner-only console for creating institutions/trials and extending access periods, separate from school accounts. Each institution must have isolated records and credentials; trial access must not grant owner rights.

## Engineering safeguards

- Treat verified school data as sensitive. Use synthetic data for demos, least-privilege access, audit trails, tested backup/restore, and institution-scoped authorization.
- Keep passwords, password-reset tokens, SMTP/API credentials, database URLs, bootstrap keys and real student/staff records out of GitHub and chat transcripts.
- Email/SMS/WhatsApp, payment, voice recognition, biometrics/face matching and AI-generated educational content depend on external providers, explicit consent/policy, or further implementation; do not present these as fully operational based on a UI alone.
- Salary, government fee/fund heads, attendance penalties, termination/readmission rules, GST and state compliance require school policy and/or official source verification. The application should support configuration, review and effective dating rather than silently applying unverified rules.
- The architecture discussed for customer sales is hosted browser access with separate institution data and license duration. Local/offline installation is a different support/security model and exposes more implementation detail to the operator of that machine.

## Open decisions before broad rollout

1. Define entitlement matrix and test each package against every module and API permission.
2. Decide if College/University is a limited pilot or supported product; complete programme, term/semester, credit, course registration and academic progression workflows before selling it as complete.
3. Confirm data ownership, controller/processor responsibilities, retention, breach response, support access and backup/restore responsibilities in contracts with qualified counsel.
4. Confirm state-specific rules only with official source, jurisdiction, applicable school category and effective date.
5. Run a representative school/college acceptance pilot with teachers, management, parents and students; collect feedback without production personal data until the controls and agreements are ready.
6. Confirm production database isolation, least-privileged runtime role, secrets rotation, recovery email delivery, monitoring and an actual restore drill.

## Source of these notes

This document summarizes the owner's project requirements and decisions in the Codex discussion. It intentionally does not reproduce the raw chat, personal login details, reset links, host credentials or any secret values.
