import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Alert, Icon, PageHeader } from "../components/ui";

type GuideLink = { label: string; to: string; purpose: string; steps: string[] };
type GuideGroup = { id: string; title: string; summary: string; links: GuideLink[] };

const groups: GuideGroup[] = [
  {
    id: "setup",
    title: "Home & school setup",
    summary: "Start here to understand the campus and prepare its shared master data.",
    links: [
      { label: "Overview", to: "/", purpose: "See the school summary and shortcuts available to your role.", steps: ["Check the active school and academic session in the header.", "Use the cards to open the relevant workspace.", "If a measure is blank or unavailable, ask the school administrator to check setup and permissions."] },
      { label: "Institution masters", to: "/institution-masters", purpose: "Maintain shared school, college or university reference data used by connected modules.", steps: ["Choose the master category.", "Review existing entries before adding one to avoid duplicates.", "Save approved values and use them consistently in records."] },
      { label: "Modules directory", to: "/modules", purpose: "Browse the application's functional areas.", steps: ["Open a module card to understand its purpose.", "Use the left menu to open the working screen.", "Available actions depend on your assigned permissions."] },
      { label: "Configuration Studio", to: "/config-studio", purpose: "Review school-level configuration available to authorized administrators.", steps: ["Confirm campus, academic year and language settings.", "Change only settings approved by school management.", "Check connected workflows after a setting is changed."] },
    ],
  },
  {
    id: "academic",
    title: "Academic & learning",
    summary: "Set the academic structure first, then use it in attendance, teaching and assessment.",
    links: [
      { label: "Academic years", to: "/academic/years", purpose: "Create and review school sessions.", steps: ["Add the year and its start/end dates.", "Set the active year only after management approval.", "Check that classes, sections and reports use the intended year."] },
      { label: "Classes & stages", to: "/academic/classes", purpose: "Maintain grade or programme records.", steps: ["Select the academic year.", "Add or review the class, grade and code.", "Keep grade progression and school stage aligned with the institution's approved structure."] },
      { label: "Sections", to: "/academic/sections", purpose: "Organize students into class groups and assign the responsible staff.", steps: ["Select the year and class.", "Create the section and set its capacity or room information if available.", "Review teacher assignments before using the section in attendance or timetable."] },
      { label: "Subjects & electives", to: "/academic/subjects", purpose: "Maintain subjects and the classes/programmes where they are offered.", steps: ["Review the subject master first.", "Map each subject to applicable classes and academic year.", "Check teacher and timetable mappings before publishing a schedule."] },
      { label: "Timetable & substitutes", to: "/academic/timetable", purpose: "Plan teaching periods and arrange coverage when a teacher is absent.", steps: ["Select the year, class, section and timetable period.", "Assign the available qualified teacher as the substitute.", "Save the assignment and tell the affected class or staff through the school's notice process."] },
      { label: "Student attendance", to: "/attendance", purpose: "Record and review daily student presence.", steps: ["Choose date, class and section.", "Mark each student using the school's attendance rules; review voice-recognition results before saving.", "Submit and check the saved register or correction workflow."] },
      { label: "Shortage & eligibility", to: "/attendance/shortages", purpose: "Review attendance thresholds and eligibility indicators configured by the institution.", steps: ["Select the academic year and relevant class or student.", "Review calculated attendance and the dates behind it.", "Escalate exceptions to the authorized school officer; do not treat a configured threshold as a verified legal rule without confirmation."] },
      { label: "Lesson plans & homework", to: "/learning", purpose: "Prepare teaching plans, publish assignments and review student submissions.", steps: ["Select class, section, subject and due date.", "Add instructions and any learning material.", "Publish, then review submissions and feedback where your role permits."] },
      { label: "Activities Hub", to: "/activities", purpose: "Organize clubs, sports, events, participation and achievements.", steps: ["Create or select an activity and schedule.", "Enroll eligible students and record attendance.", "Record outcomes or achievements for the school record."] },
      { label: "GK & Subject Practice", to: "/discovery", purpose: "Provide class-appropriate GK and subject practice content.", steps: ["Choose the class and topic.", "Attempt the available practice questions.", "Use teacher-reviewed content for classroom assignments."] },
      { label: "Question Paper Builder", to: "/paper-builder", purpose: "Assemble a draft paper from available question-bank content.", steps: ["Choose class, subject and assessment details.", "Set question types and marks, then review the generated selection.", "A teacher must check syllabus coverage, answer key, marks and difficulty before printing or sharing."] },
      { label: "Exams & question bank", to: "/exams", purpose: "Manage examination information and reusable questions.", steps: ["Select the examination and relevant class or subject.", "Add or review questions and marks.", "Check assessment details before results are published."] },
    ],
  },
  {
    id: "students",
    title: "Students & campus operations",
    summary: "Keep each student's record connected to admissions, fees, transport and library services.",
    links: [
      { label: "Student & guardian master", to: "/students", purpose: "Maintain student identity, enrollment and guardian links.", steps: ["Search for an existing student before creating a record.", "Use the student's unique enrollment identity and verify guardian details.", "Update the central student record so connected modules reuse it."] },
      { label: "Admissions & enrolment", to: "/students/new", purpose: "Register an applicant and complete the school's admission workflow.", steps: ["Check for duplicate identity or prior enrollment.", "Enter required applicant and guardian details, then choose the approved year, class and section.", "Review the record and finish any school-required checklist before confirming enrollment."] },
      { label: "Transport & GPS fleet", to: "/transport", purpose: "Manage vehicles, routes, stops, assignments and transport service records.", steps: ["Maintain vehicle and route details first.", "Assign the student to an approved route and effective date.", "Confirm transport charges and guardian-facing details with the finance/transport office."] },
      { label: "Library & repository", to: "/library", purpose: "Catalogue books, register members and manage loans, reservations and fines.", steps: ["Add a title and copies to the catalogue.", "Link a member to an existing student or staff identity where possible.", "Issue or return a copy using its accession number; review due date and fine policy."] },
      { label: "Procurement & vendor", to: "/procurement", purpose: "Track vendors, purchase requests, orders, bills, budgets and expenses.", steps: ["Maintain the vendor and budget information.", "Create a request with items, quantity, unit price and applicable GST.", "Follow the approval separation, record the order and bill, then reconcile expense against budget."] },
      { label: "Concerns & SLA desk", to: "/concerns", purpose: "Log, assign and resolve campus concerns with ownership and follow-up.", steps: ["Record the issue, category, priority and reporter.", "Assign the responsible team and due date.", "Add progress and resolution notes before closing the concern."] },
      { label: "Notices & broadcast", to: "/notices", purpose: "Share approved school communications with intended audiences.", steps: ["Choose the audience and delivery channel.", "Review dates, attachments and message content.", "Send only after the appropriate school approval and check the delivery status."] },
    ],
  },
  {
    id: "finance",
    title: "Finance & reports",
    summary: "Financial entries should be traceable to an approved fee head, budget head or supporting record.",
    links: [
      { label: "Assigned fee collection", to: "/fee-collection", purpose: "Record collections assigned to an authorized collector.", steps: ["Find the student and verify the installment and fee head.", "Record the amount, date and payment reference accurately.", "Submit for verification if your role is not allowed to verify its own collection."] },
      { label: "Student Policy Centre", to: "/student-policies", purpose: "Review school-configured admission, fee and student lifecycle policies.", steps: ["Confirm the applicable institution and academic year.", "Review policy heads and effective dates.", "Treat local settings as school policy unless they are separately verified against official rules."] },
      { label: "Budget vs actual expense", to: "/budget-report", purpose: "Compare allocations, actuals, commitments and remaining balance.", steps: ["Select the year and budget head.", "Review allocated budget, approved/paid expense and pending commitments.", "Open the breakdown to trace transactions; investigate variances before approving more spend."] },
      { label: "Fees & payment ledger", to: "/fees", purpose: "Review fee schedules, student dues and recorded payments.", steps: ["Select the year and student or class.", "Review the fee head, installment, balance and payment history.", "Correct discrepancies through the authorized adjustment or refund workflow."] },
      { label: "Refunds & controls", to: "/fees/controls", purpose: "Review controlled adjustments, waivers and refunds.", steps: ["Open the relevant student transaction.", "Enter the reason and supporting reference.", "Use an independent authorized approver where required by school policy."] },
      { label: "Reports & CSV exports", to: "/reports", purpose: "Review role-permitted reports and export approved school data.", steps: ["Choose a report and date/academic-year filters.", "Confirm the selected records and columns.", "Store exported student or financial data only in approved locations."] },
      { label: "Saved views & batch data", to: "/data-tools", purpose: "Manage saved report views and permitted imports.", steps: ["Use the supplied template and check required columns.", "Validate a small sample before importing a full file.", "Review import results and resolve rejected rows without duplicating existing records."] },
    ],
  },
  {
    id: "people",
    title: "People & HR",
    summary: "Staff records and actions must follow the school's approved HR access and review process.",
    links: [
      { label: "Staff directory & payroll", to: "/staff", purpose: "Maintain staff records, employment details and payroll information allowed by role.", steps: ["Search the staff directory before adding a person.", "Keep staff identity, designation, department and status current.", "Review payroll inputs and approvals against the institution's verified policy."] },
      { label: "Staff attendance & punch", to: "/staff/attendance", purpose: "Record staff presence and review attendance exceptions.", steps: ["Select date and staff group.", "Review punches and corrections against supporting evidence.", "Route exceptions to an authorized reviewer."] },
      { label: "Recruitment & onboarding", to: "/hr/recruitment", purpose: "Track vacancies, candidates and staff onboarding tasks.", steps: ["Create or select the vacancy.", "Record candidate stages and approved decisions.", "Complete onboarding checklist and link the new staff identity to the master record."] },
    ],
  },
  {
    id: "security",
    title: "Portals, access & security",
    summary: "Use individual accounts and least-privilege access; never share a staff login.",
    links: [
      { label: "Parent portal", to: "/portal", purpose: "Let guardians view information for their linked students.", steps: ["Sign in with the guardian's own account.", "Select the linked student.", "Review permitted notices, attendance, fees and transport information."] },
      { label: "Student portal", to: "/student-portal", purpose: "Let eligible students access their learning information.", steps: ["Sign in using the student's own account.", "Review assigned work, timetable and permitted learning content.", "Contact the teacher through the school's supported channel when information looks wrong."] },
      { label: "Safeguarding & wellbeing", to: "/safeguarding", purpose: "Manage sensitive wellbeing or safeguarding records with restricted access.", steps: ["Open only records relevant to your assigned responsibility.", "Record factual information and follow school escalation procedures.", "Limit disclosure and use the audit trail for follow-up."] },
      { label: "Identity & access (RBAC)", to: "/users", purpose: "Create accounts and grant role-based permissions within the institution.", steps: ["Search for an existing account before adding one.", "Assign only the role and scope needed for the person's duties.", "Review access after role changes or staff departure; use individual accounts, not shared credentials."] },
      { label: "Audit trail & security", to: "/audit", purpose: "Review recorded administrative and sensitive actions where authorized.", steps: ["Filter by date, actor or action if available.", "Check the event details and related record.", "Escalate suspicious or unexplained activity to the security owner."] },
      { label: "Profile & security", to: "/profile", purpose: "Maintain your own sign-in and profile settings.", steps: ["Open the profile menu in the top-right corner.", "Review your account details and security options.", "Use sign out on shared computers."] },
    ],
  },
];

const roleGuides = [
  { role: "School administrator", pages: "School setup, admissions, student and staff masters, identity & access, configuration, imports and audit.", routine: "Set up the academic year and masters first; create users with the minimum role/scope; review exceptions and audit activity." },
  { role: "Principal / academic leadership", pages: "Overview, classes, attendance, timetable, learning, exams, notices and reports according to assigned permissions.", routine: "Review attendance and academic exceptions; approve or escalate actions; confirm substitute coverage and communicate changes." },
  { role: "Teacher / class teacher", pages: "Timetable, attendance, lesson plans, homework, activities and exams; student information only within assigned access.", routine: "Check timetable; record attendance; publish reviewed learning work; record activity participation; report a student-record issue to the office." },
  { role: "Finance / accounts", pages: "Fee collection, fee ledger, refunds/controls, budgets, procurement and reports according to assigned access.", routine: "Verify the student and fee head before collection; keep payment references; reconcile transactions and budget variances; follow independent approvals." },
  { role: "Operations / librarian / transport", pages: "Admissions, concerns, notices, library, transport and procurement as assigned.", routine: "Use the central student/staff identity; update the relevant service record; check dates, routes, accession numbers or vendor records before saving." },
  { role: "Parent / guardian", pages: "Parent portal and notices available to the linked guardian account.", routine: "Use your own login, select the correct child and contact the school office for incorrect identity or access links." },
  { role: "Student", pages: "Student portal, class learning, homework, timetable and practice content enabled for the account.", routine: "Check the assigned class and due dates, submit work through the provided workflow, and tell a teacher if the class mapping looks wrong." },
];

export function HelpManualPage(): ReactNode {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const filteredGroups = useMemo(
    () => groups.map((group) => ({
      ...group,
      links: group.links.filter((link) => !query || `${group.title} ${link.label} ${link.purpose} ${link.steps.join(" ")}`.toLocaleLowerCase().includes(query)),
    })).filter((group) => group.links.length > 0),
    [query],
  );
  const filteredRoles = roleGuides.filter((guide) => !query || `${guide.role} ${guide.pages} ${guide.routine}`.toLocaleLowerCase().includes(query));

  return (
    <div className="space-y-6">
      <PageHeader title="Staff user manual" description="A practical guide to the ERP menu, staff roles and common school workflows. Menu links remain permission-controlled for each account." badge="HELP & TRAINING" />

      <Alert title="Before you enter records">
        Use your own account and verify the active campus and academic year. Search for an existing student, staff member, book, vendor or payment before creating a new record. School settings are not automatically verified government rules; follow the institution's approved procedures.
      </Alert>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
        <label htmlFor="manual-search" className="mb-2 block text-sm font-bold text-[#182944]">Find a role, module or task</label>
        <div className="relative max-w-2xl">
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input id="manual-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try ‘attendance’, ‘new admission’ or ‘teacher’" className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm focus:border-[#087F83] focus:outline-hidden focus:ring-2 focus:ring-[#087F83]/20" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Manual sections">
          {groups.map((group) => <a key={group.id} href={`#manual-${group.id}`} onClick={() => setSearch("")} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#087F83] hover:text-[#087F83]">{group.title}</a>)}
          <a href="#manual-roles" onClick={() => setSearch("")} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#087F83] hover:text-[#087F83]">Role quick guide</a>
        </div>
      </section>

      <section id="manual-roles" className="scroll-mt-28">
        <div className="mb-3">
          <h2 className="text-lg font-extrabold text-[#182944]">Role quick guide</h2>
          <p className="text-sm text-slate-600">Your administrator grants access based on job responsibility. A page appearing in this guide does not itself grant access.</p>
        </div>
        {filteredRoles.length ? <div className="grid gap-3 lg:grid-cols-2">
          {filteredRoles.map((guide) => <article key={guide.role} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <h3 className="font-bold text-[#182944]">{guide.role}</h3>
            <p className="mt-2 text-xs leading-5 text-slate-600"><strong>Typical pages:</strong> {guide.pages}</p>
            <p className="mt-2 text-xs leading-5 text-slate-600"><strong>Regular workflow:</strong> {guide.routine}</p>
          </article>)}
        </div> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">No roles match this search.</p>}
      </section>

      {filteredGroups.map((group) => <section key={group.id} id={`manual-${group.id}`} className="scroll-mt-28">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="text-lg font-extrabold text-[#182944]">{group.title}</h2><p className="text-sm text-slate-600">{group.summary}</p></div>
          <span className="rounded-full bg-[#DDF4EC] px-2.5 py-1 text-xs font-bold text-[#087F83]">{group.links.length} guides</span>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {group.links.map((link) => <article key={link.to} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="font-bold text-[#182944]">{link.label}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{link.purpose}</p></div>
              <Link to={link.to} aria-label={`Open ${link.label}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#087F83]/30 px-2.5 py-1.5 text-xs font-bold text-[#087F83] hover:bg-[#DDF4EC]/60">Open <Icon name="arrowRight" className="h-3.5 w-3.5" /></Link>
            </div>
            <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600">
              {link.steps.map((step, index) => <li key={step} className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{index + 1}</span><span>{step}</span></li>)}
            </ol>
          </article>)}
        </div>
      </section>)}
      {filteredGroups.length === 0 && filteredRoles.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-600">No guide matches “{search}”. Try a module name or a shorter phrase.</p>}

      <Alert tone="info" title="Need help or see an access issue?">
        Ask your school administrator to check your assigned role and scope. For a data correction, share the affected record's school ID or enrollment number through the school's approved support process. Do not share passwords in messages.
      </Alert>
    </div>
  );
}
