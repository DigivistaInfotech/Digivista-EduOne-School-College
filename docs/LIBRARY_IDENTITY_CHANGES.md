# Library and central identity changes — 6 November 2026

All changes are supplemental fields or targeted fixes; existing colours and page structure are retained. No real school database has been reset or populated with invented inventory.

## Delivered

| Area | Change | Required input |
|---|---|---|
| Catalogue masters | Seed 15 academic and non-academic reading categories; admin can add categories without case-duplicate codes/names | New category code and name |
| Class reading | Link a title to central class IDs, a subject, reading type and edition; class/type filters; reading type, class labels and resource link visible | A title; at least one class when reading type is Academic |
| Copies | Physical accession numbers remain separate from bibliographic and online resources; new book form defaults to zero copies | Copy accession when adding a physical copy |
| Catalogue edits | Transactional classification/category validation and audit; omitted PATCH fields retain type/status/class mappings | Only fields deliberately changed |
| Membership | Select/search existing central student/staff records; library-specific lookup requires no HR directory access; show existing membership and reject duplicate creation | Exactly one linked student or staff record; member code and borrowing limit can use defaults |
| Member edits | Central identity and member code are immutable; change borrowing limit/status with an audit record | Only the intended change |
| Borrowing privacy | Teacher/section-scoped member, loan, fine and reservation lists show permitted pupils and the actor’s linked record; school-wide users retain their normal school-wide view | Existing roles and scopes |
| Identity | Blood group and emergency contact managed in central student profile; identity card reads the same record and stable admission number | Existing required student name/admission/enrollment; blood group/contact remain optional |
| Profile permissions | PATCH now applies the same assigned-record scope as GET; school-wide plus section roles behave consistently | Existing profile edit permission and permitted scope |
| Student lifecycle | Ordinary profile editing cannot change student status to bypass authorised withdrawal/readmission review; current status remains visible | Use the existing admission/lifecycle workflow |
| Audit | Category, book, copy, membership and reservation-status additions/edits are recorded; identity edits include before/after values | Existing audit access governs inspection |

## Verification

`apps/api/test/library-identity.test.ts` exercises seeded categories, catalogue versus stock, class mapping and shared reading filters, transactional rollback, unsafe source URLs, duplicate central memberships, librarian lookup without HR permission, teacher borrowing scope, profile scope, blood-group validation/audit and blocked profile withdrawal/inactivation.

The first targeted run exposed a real Zod PATCH-default bug that changed Academic to Unclassified when type was omitted. Explicit update fields now remove creation defaults and have a preservation regression. A subsequent run was temporarily blocked by a concurrently incomplete transport import. Final targeted run: **3/3 tests passed**, 6 November 2026, `npx vitest run apps/api/test/library-identity.test.ts` (36.52 seconds). Targeted ESLint completed with no errors or warnings. Earlier web typecheck passed; coordinated final whole-application checks remain the parent task’s responsibility.

## Remaining gaps / recommendations

### Subject applicability correction

The book subject picker now filters applicable classes using the school's explicit Subject class offerings master, recorded teaching assignments and timetable in active academic years. A subject name does not imply a grade range. Subjects without recorded mappings display administrator setup guidance instead of every class. The API rejects new or changed subject/class combinations outside those mappings. Existing book mappings remain readable and unrelated metadata edits preserve legacy records; shared non-academic reading can still omit class mappings. This reuses academic masters and does not require duplicate student entry.

Migration 0044 adds a tenant-isolated subject/year/class offering master with composite school foreign keys. The supplemental Subjects panel lets a school-wide subject administrator choose the academic year, subject and classes (for example, the school's Biology offering in Classes 11–12). Saving replaces only that subject's explicit offerings for that year, records before/after audit evidence and never creates teacher assignments or timetable entries. Archived years are read-only. Clearing explicit offerings does not remove independent teaching/timetable mappings or existing books. No subject offerings are fabricated or globally seeded.

- This is not a complete official book list for every board/class. Import a verified school bibliography/edition list and map its existing titles; never invent copies or claim catalogue metadata means physical availability.
- Add a reviewed bibliography CSV import with duplicate ISBN/title/edition checks, preview and change history.
- Barcode/QR scanning, stocktake/lost-copy reconciliation and purchasing links would reduce circulation work.
- Due-date reminders require a configured delivery service and opt-in policy; none are claimed as live SMS/email delivery.
- College/university catalogue mapping should additionally link programme, semester/course and subject once those academic masters exist.
- Central ID photo storage, card issue/reissue/expiry history and batch printing need a governed upload and print workflow; the current card is a profile-derived identity display and grants no login access.
- ID-card print layout and real browser usability still need coordinated browser verification after the synthetic preview is restarted with the new migrations.
