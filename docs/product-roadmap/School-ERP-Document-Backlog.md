# School ERP document backlog

Last reviewed: 2026-11-27

This is the working checklist for product work requested in the uploaded School ERP and Notice documents. A feature marked **Upcoming** is not represented as a working feature in the customer demo. Update its status only after implementation and verification.

## Source documents

- `School ERP (1).docx` — academic setup, exams, assessment, results, report cards and reporting requirements.
- `Notice Module of my School ERP into a professional.docx` — notice lifecycle, recipients, approvals, templates, delivery/read/acknowledgement tracking, portals, dashboards and reports.

The original documents remain the source for detailed requirements. This list is a concise implementation tracker, not a replacement for them.

## Status summary

| Workstream | Status | Notes |
|---|---|---|
| Data integrity baseline | Complete | Duplicate staff number, audited correction, linked-record delete protection and guardian identity conflict checks covered. API suite: 74 passed; API typecheck passed. |
| Consistent manual/import admission rules | Upcoming | Resume after the document-based scope has been reviewed and prioritized. |
| Notice and communication upgrades | In progress | Standard notice categories and priority are now stored and returned by the API. Recipient targeting, templates, approvals, scheduling and reports remain upcoming. |
| Academic setup upgrades | Upcoming | Existing academic setup is present; validate the document's full connected structure before marking items done. |
| Exam, results and report upgrades | Upcoming | Existing exam and report functions are present; validate the full workflow and report requirements before marking items done. |
| Real school data entry | Deferred | Use synthetic records for demos until relevant workflows and report totals have been verified. |

## Upcoming: notices and communication

- [x] Persist standard notice category and priority and show them in the notice list and form. API test and workspace type check passed.
- [ ] Recipient selection for whole school, student/parent/staff groups, multiple classes and sections, selected individuals and departments.
- [ ] Recipient preview, deduplication and confirmation counts before publishing.
- [ ] Admin-managed custom categories and permission-restricted urgent notices with audit history for create/approve/publish.
- [ ] Reusable templates with create/edit/duplicate/archive actions.
- [ ] Approval workflow with maker-checker control and approval history.
- [ ] Backend scheduled publishing and expiry; archive remains searchable.
- [ ] Separate delivery, read and acknowledgement states, with recipient-wise timestamps and reports.
- [ ] Notice dashboard and reports using actual records, with filters and exports.
- [ ] Student, parent, teacher and staff portal audience scoping, including a parent with multiple children.
- [ ] Notification-channel settings and provider logs; never claim delivery without provider confirmation.
- [ ] Integrations with attendance, fees, exams, homework, activities, library, transport, calendar, admissions and HR.
- [ ] Attachment validation, limits, preview/download rules and access control.

## Upcoming: academic setup

- [ ] Academic year terms, admission window, calendar, lock and rollover checks.
- [ ] Copy prior-year classes, sections, subjects and elective structure with review before activation.
- [ ] Class configuration for board/stage, stream eligibility, capacity and promotion settings.
- [ ] Separate stream/division master (such as Science, Commerce and Humanities) from class sections.
- [ ] Section configuration for capacity, room, class teacher and relevant schedule settings.
- [ ] Central subject master mapped to class/year, including categories and theory/practical configuration.
- [ ] Elective groups and student subject allocation.
- [ ] Laboratory/practical resources and subject-teacher assignments.
- [ ] Academic structure import/export and data-backed academic reports.

## Upcoming: exams, results and reports

- [ ] Separate examination attendance statuses, including approved exceptions.
- [ ] Marks entry only for enrolled students and configured assessment components.
- [ ] Submission, verification, correction, lock/unlock and audit history.
- [ ] Configurable grading, rounding, weightage, pass criteria and missing-mark handling.
- [ ] Report-card templates by school stage, with preview, batch PDF and print support.
- [ ] Controlled result approval/publication; unpublished results stay private.
- [ ] Admit-card templates and batch generation.
- [ ] Class/section/subject/student/exam analytics and year comparison with record drill-down.
- [ ] Excel/PDF exports that reconcile to the visible filtered records.

## Verification rules before marking complete

1. Confirm behavior in the current app before assuming a requirement is absent.
2. Keep **Upcoming** visible for items that are not implemented and verified.
3. After implementation, verify API/data behavior, role permissions, audit trail and UI result.
4. Check that dashboard totals and exports match the underlying filtered records.
5. Use synthetic data for end-to-end pilot runs; only proceed to school data after stakeholder review.
