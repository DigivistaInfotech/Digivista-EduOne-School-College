# Additions and verification — 6 November 2026

Existing screens and core workflows were retained. New functions are separate
pages or small supplementary sections; the earlier timezone and audit-label bugs
were fixed. No existing school database, `.env`, fees ledger or admissions data
was reset. The browser preview uses a separate disposable synthetic database.

## New pages

| Page | Access | What it does |
| --- | --- | --- |
| Configuration Studio: School location & language | School viewers; changes require `school.manage` | India flag, all 28 states and 8 union territories, school default Hindi/English, saved version history |
| `/activities` | `learning.view`; management actions require `learning.manage` | Clubs, scoped student enrolment, dated sessions/competitions, attendance, house results, achievements, printable participation certificates |
| `/discovery` | `learning.view`; authoring requires `learning.manage` | Class-bound GK and subject questions, textbook/chapter references, objective and descriptive practice, teacher publication review |
| `/paper-builder` | `learning.manage` | Four question types, class/subject/chapter/language filters, question counts and marks, up to four distinct sets, printable papers and separate staff answer keys |
| `/student-policies` | `school.manage` | Administrator-defined state profiles, fee heads, admission guidance, late-fee settings, overdue review and controlled readmission |

## Language and state setup

The original English interface remains available. Hindi currently translates the
main navigation and the new regional school setup, with English fallback on other
screens. A school can choose its default; a person can override it locally for
their account and school, or return to the school default. State selection
suggests one of the currently supported interface languages; it does not claim
to implement every state's regional language or official language policy.

State/territory names were checked against the
[National Portal of India directory](https://www.india.gov.in/directory/web-directory/state-uts).
The two-letter selection identifiers in this app are internal keys, not government
fund, treasury, UDISE or legal-compliance codes.

## Teacher question-bank and paper workflow

1. Open GK & Subject Practice and select an authorised class.
2. Add the subject, chapter, topic, question, options if objective, model answer,
   language and source reference. Save a draft.
3. Review the question and answer, then publish. Students do not see drafts or
   model answers in the list.
4. In Question Paper Builder, choose the same class/subject/language, optional
   chapters, and counts/marks for objective, short, long and very long questions.
5. Generate one to four sets. Review the printable question paper and staff-only
   answer key before use. Insufficient content or variation produces an error;
   missing questions are never fabricated.

Paper generation selects reviewed bank entries; it is not an LLM or an unseen
textbook extractor. Published questions are automatically limited to a student's
active enrolled class (or a guardian's linked classes). Descriptive practice
returns a model answer for comparison without pretending to automatically grade
the student's reasoning. Objective practice checks the selected option.

Current-affairs entries require a source URL and as-of date. Student practice and
paper generation exclude future-dated entries and current affairs older than
30 days. **There is no automatic news feed, external AI provider or automated
textbook ingestion.** Staff supply and review material. The isolated preview has
explicitly labelled original synthetic sample questions for Classes 6, 7 and 8.

## Activities workflow

Create a club (including sports/cricket, GK, arts or other supported categories),
enrol students, then schedule a session or competition. Teachers can only manage
student participation within their assigned sections. Attendance cannot precede
the session's start. Record attendance, optional house/score/rank and achievements.
Only present students in a completed session can receive certificates. Certificate
issuance is idempotent and locks the participation record; print access is scoped
to authorised staff, the student, or a verified linked guardian. House totals show
only the records visible to the viewer. Full cricket ball-by-ball scoring is not
implemented.

## Administrator student policies

Each school can save a versioned profile for any Indian state/territory. The
profile distinguishes management type from minority status. These are
**school-defined settings**, not government-verified legal rule packs.

Administrators can create/update head templates, admission checklist text, late
fees using the existing monthly-percentage algorithm and cap, an overdue review
threshold, and readmission instructions. Editable common head examples are
offered explicitly as school-defined examples, without invented government codes
or rates. Saved admission requirements appear as additional guidance on the
existing admission page; they do not replace the established admission form.

Saving a profile does not apply financial changes. Applying it requires the
school's selected state to match and updates the fee-head catalogue plus a
dedicated late-fee rule. It does not alter old charge amounts, take payments or
generate charges. The existing Fees page still manages class-wise structures,
bulk charges, payments and late-fee assessment runs.

“Find overdue cases” is an explicit administrative check, not a scheduled job.
It uses unpaid charge balances after concessions, write-offs and allocations,
creates each student/year/state review once and snapshots the policy. A case
does not automatically terminate an admission. Keeping admission active closes
the case. Fee-based withdrawal through this new workflow is disabled for
elementary/unclassified students; for higher classes it requires a different
administrator, a recorded authority/notice reference, active enrolment and
remaining overdue charges. This does not itself certify the legal validity of a
particular withdrawal. The elementary guard is conservative; section 16(4) of the
[RTE Act](https://www.indiacode.nic.in/bitstream/123456789/19958/1/rte2009_eng.pdf)
contains protection against expulsion before completion of elementary education.
Applicable state, school category and other rules still require verification.

An authorised readmission adds an enrolment for the same student, validates the
active academic year/date/section, and retains the admission number, historical
enrolment and fees ledger. It does not forgive dues or charge a readmission fee
automatically; administrators use the normal fee workflow for approved charges.

## Running and verification

For an existing configured database, apply the two additive migrations with
`npm run db:migrate` through the normal deployment process. They are already
applied in the isolated preview and disposable integration tests. The generated
Supabase master schema includes all 36 migrations. No production deployment or
normal configured database migration was performed.

`npm run preview:demo` starts an API on loopback port 4000, creates a disposable
synthetic PostgreSQL database, and seeds demo learning/activity records. Run the
web preview on port 5173. Preview records are disposable and are not real school
records. Default `npm run dev` behaviour is unchanged.

Verification: **202/202 integration tests**, 7 suites passed; workspace TypeScript
and production build passed; ESLint **0 errors, 94 existing warnings**. Browser
checks covered login, flag/state setup, Hindi navigation with English override,
activities/certificate issuance, policy centre and four 20-mark Class 8 paper
variants. The printable paper was inspected. This is a smoke check, not a full
browser accessibility, device or performance audit.
