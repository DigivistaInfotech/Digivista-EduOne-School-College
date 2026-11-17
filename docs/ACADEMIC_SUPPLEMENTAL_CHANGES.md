# Supplemental academic additions — 6 November 2026

Existing class, section and academic-year layouts/forms are retained. New expandable panels add the following optional planning details.

| Area | Added behaviour | Controls |
|---|---|---|
| Class | Academic stage, teaching medium, stream/specialisation, coordinator, next-class planning reference; active section/enrollment/capacity summary grouped by academic year. | Central master/user IDs; active same-institution references; promotion graph cannot cycle. Coordinator selection grants no user roles. |
| Section | Class teacher/co-teacher, room/location, shift, medium, stream, next-year section reference; live occupied/available seats, capacity warning and current teaching-subject count. | Distinct active teacher accounts, same-institution room/masters, section scope; target is an accessible section in a later year and matches configured next class. No enrollment moves or timetable changes are performed. |
| Year | Create/edit real terms and year holidays, shared with the existing HR holiday calendar. | Ordered dates within the year, non-overlapping terms, stable sequence/code constraints, archived plans read-only. Year date edits cannot exclude recorded terms/holidays or invalidate section planning. |
| Readiness | Read-only counts for active enrollments, draft exams, pending attendance corrections, pending offline collection acknowledgements and open issued POs. | Institution-wide year management required; action-specific permissions hide unavailable checks. Counts are a review checklist, not automatic closure, financial clearance or promotion. |
| Future institutions | Automatic seed of shared institution, library, transport and academic masters plus the canonical TRANSPORT fee head. | Idempotent school-insert trigger; reference rows only. No inventory, collection, charge or role assignment is fabricated. |

Stage/medium/shift values are database masters; administrators can extend them in Institution masters. Legacy classes/sections are not rewritten. All supplemental selections are optional. Term name/dates/sequence and holiday name/date are required only when the user chooses to create those planning records.

Implementation: migration `0043_academic_supplemental_profiles.sql`, `academicProfiles.ts`, supplemental `AcademicProfiles.tsx` and `AcademicYearPlan.tsx`. Existing page forms retain their original fields. New/changed profile, term and holiday mutations append audit events. Shared date-bound triggers also guard year-linked holidays entered through the existing HR holiday API.

Focused regression file: `apps/api/test/academic-profiles.test.ts` passed all 5 tests on 6 November 2026. It covers future-tenant defaults, class cycles/cross-tenant references/no role grants, live capacity and section scope, valid later-year mapping, scoped managers, terms/shared holidays/date boundaries and archived plan protection. API and web TypeScript checks also passed. Final combined test/build results are recorded by the parent agent in the overall verification report.

This is a school planning addition, not a university programme/semester/credit engine. It does not automatically promote pupils, grant account access, alter timetable assignments, issue charges, or certify year-end completion.
