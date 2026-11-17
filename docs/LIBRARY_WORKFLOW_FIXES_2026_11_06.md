# Library workflow corrections — 6 November 2026

## Subject and class mapping

An additive Subject class offerings master now records school, academic year, subject and applicable classes, with tenant foreign keys, authorised school-wide academic subject management and audit history (migration 0044). It does not fabricate teacher assignments or timetable slots. The library combines these explicit offerings with genuine active-year teaching/timetable mappings. Selecting a subject narrows the New Book class list and clears incompatible draft selections; changed invalid subject/class combinations are rejected by the API. Shared nonacademic books and unchanged historic mappings remain compatible.

The user confirmed Biology applies to Classes 11–12. That exact mapping was saved through the Subjects UI in the preserved disposable preview, and the New Book form was verified to offer only Class 11 and Class 12 for Biology. No unverified curriculum rules were installed for other subjects or institutions.

## Central member identity

New Member selects an existing central student or staff record. The read-only member code is derived automatically from the admission number (STU-) or employee number (STF-), with a stable person-ID fallback when the reference would exceed the existing 40-character code field. School/college/university students use the same central student identity; no duplicate person is created. Existing memberships/codes remain unchanged, and duplicate membership is rejected. API default generation uses the same helper; legacy integrations can retain their existing explicit code input.

## Physical copy circulation

Issue copy now searches the full active catalogue and existing members independently of page-level catalogue/member filters. It shows real available accession copies, disables zero-stock titles and inactive/full-limit members, and automatically selects a copy only when exactly one is available. New lookup queries fetch fresh data on opening/focus. Copy selection resets when its book changes. Member searches include staff employee references.

The API verifies the actual copy/book/member relationship, active catalogue and central person status, due date, circulation action scope and borrowing limit. It locks the physical copy/member for checkout; simultaneous requests cannot issue the same copy twice. Circulation history includes the library member code to distinguish people with identical names. Due date remains optional and uses the configured school loan period.

Manual preview check: with the catalogue filtered to Class 8, checkout still listed Wings of Fire from the full catalogue. Existing demo student ADM-2026-00001 was selected, code STU-ADM-2026-00001 filled automatically, membership saved, copy ACC-00029 issued and then returned immediately with a verification note. No student/staff duplicate or phantom copy was created.

## Preview continuity

The running API was reloaded against the existing disposable database using scripts/preview-api-live.ts, not reseeded/reset. It binds only to 127.0.0.1:4001 and leaves the original preview process/database host running. A gitignored .preview-api-target.json tells the web dev proxy to use that loopback port; without it normal development defaults to 4000. Keep the database host running during this preview; when ending the live preview, stop the live API, remove .preview-api-target.json and restart the web dev server to use its normal target. No configured school database or real role grants were changed.

## Verification

The subject/class identity suite passed 5/5; existing module suite passed 36/36. The new circulation suite passed 3/3 after correcting a test-only role-permission fixture to reference permission_id. Earlier runs hit disposable database startup timeouts under severe memory pressure; the final focused runs used a 300-second startup allowance without changing the repository default. These 44 relevant tests are targeted follow-up evidence, not a claim that the previous full 241-test run was repeated after these additions. Final typecheck/build/lint outcomes are recorded in the main verification report.
