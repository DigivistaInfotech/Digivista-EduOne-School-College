import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Icon, PageHeader } from '../components/ui';

export interface ModuleCardData {
  id: string;
  number: string;
  title: string;
  owner: string;
  category: 'Administration' | 'Academic' | 'Student & Parent' | 'Operations' | 'Finance' | 'HR' | 'Governance' | 'Platform';
  fields: string;
  filters: string;
  flow: string[];
  control: string;
  route: string;
  actionLabel: string;
}

export const MODULE_CARDS: ModuleCardData[] = [
  {
    id: 'm-01',
    number: '01',
    title: 'School & campus setup',
    owner: 'School Admin',
    category: 'Administration',
    fields: 'Legal/display name; campus code/address; timezone; session; board reference if applicable; approved payee; logo',
    filters: 'Campus / session / active status',
    flow: ['Draft', 'Authorised approval', 'Effective configuration'],
    control: 'Branding, calendar, labels and scoped approvals; version every change.',
    route: '/academic/years',
    actionLabel: 'Open school setup',
  },
  {
    id: 'm-02',
    number: '02',
    title: 'Admissions & enrolment',
    owner: 'Admissions',
    category: 'Student & Parent',
    fields: 'Application ID; child name/DOB; guardian link; prior school; requested class; documents; admission date',
    filters: 'Session / class / stage / missing documents',
    flow: ['Enquiry', 'Application', 'Review', 'Offer', 'Enrolment'],
    control: 'Waitlist, sibling detection, duplicate review and unique admission number.',
    route: '/students/new',
    actionLabel: 'New admission',
  },
  {
    id: 'm-03',
    number: '03',
    title: 'Student & guardian master',
    owner: 'Records Office',
    category: 'Student & Parent',
    fields: 'Student ID; legal/preferred name; DOB; photo optional; class/section; enrolment dates; guardian relationship/contact; emergency contact',
    filters: 'Class / section / active / incomplete profile',
    flow: ['Create', 'Verify guardian', 'Enrol', 'Transfer/archive'],
    control: 'Health/custody fields restricted; demographic sensitive fields only if required.',
    route: '/students',
    actionLabel: 'View student master',
  },
  {
    id: 'm-04',
    number: '04',
    title: 'Subjects & activity enrolment',
    owner: 'Academic Head',
    category: 'Academic',
    fields: 'Subject code/name; category; class; elective group; theory/practical components; assigned teacher; student selections',
    filters: 'Session / class / stream / subject type',
    flow: ['Catalogue', 'Offer', 'Select', 'Validate combination'],
    control: 'Count distinct subjects separately from practical components; PE, sports, music and computer configurable.',
    route: '/academic/subjects',
    actionLabel: 'Manage subjects',
  },
  {
    id: 'm-05',
    number: '05',
    title: 'Timetable & substitution',
    owner: 'Coordinator',
    category: 'Academic',
    fields: 'Day/period; start/end; class/section; subject; teacher; room/lab; effective dates; substitute',
    filters: 'Date / teacher / class / room / conflicts',
    flow: ['Draft', 'Conflict check', 'Approve', 'Publish', 'Revise'],
    control: 'Room, teacher and section collision checks; substitute acknowledgement and history.',
    route: '/academic/timetable',
    actionLabel: 'Open timetable grid',
  },
  {
    id: 'm-06',
    number: '06',
    title: 'Student attendance',
    owner: 'Class/Subject Teacher',
    category: 'Academic',
    fields: 'Date; session/period; applicable enrolment; status; marked by/time; correction reason; reviewer',
    filters: 'Period / date range / class / subject / unmarked',
    flow: ['Mark', 'Submit', 'Correction request', 'Review', 'Recalculate'],
    control: 'Daily and period measures separate; no automatic present; missing entries visible.',
    route: '/attendance',
    actionLabel: 'Mark daily register',
  },
  {
    id: 'm-07',
    number: '07',
    title: 'Shortage & eligibility review',
    owner: 'Exam Officer',
    category: 'Academic',
    fields: 'Rule version/session; warning threshold; applicable days; credits; evidence; review owner; decision/reason',
    filters: 'Class VI-XII / risk / pending review / date',
    flow: ['Calculate', 'Alert', 'Follow-up', 'Review', 'Approved decision'],
    control: 'Board vs internal rules separate; no automatic class-entry ban or final Board rejection.',
    route: '/attendance/shortages',
    actionLabel: 'Review shortages',
  },
  {
    id: 'm-08',
    number: '08',
    title: 'Lesson plan & syllabus',
    owner: 'Teacher / HOD',
    category: 'Academic',
    fields: 'Class/subject; unit/topic; planned periods; completed date; coverage evidence; revision/practical status',
    filters: 'Teacher / class / unit / overdue plan',
    flow: ['Plan', 'Teach', 'Update coverage', 'HOD review'],
    control: 'Coverage from actual topics/periods; distinguish planned, taught and assessed.',
    route: '/learning',
    actionLabel: 'View syllabus coverage',
  },
  {
    id: 'm-09',
    number: '09',
    title: 'Homework & learning resources',
    owner: 'Teacher',
    category: 'Academic',
    fields: 'Title; class/section/subject; instructions; publication/due window; attachment metadata; submission/version; feedback',
    filters: 'Class / subject / due / submission state',
    flow: ['Draft', 'Publish', 'Private submission', 'Review', 'Feedback'],
    control: 'Authorised file access, size/type checks, resubmission policy and late flag.',
    route: '/learning',
    actionLabel: 'Manage homework',
  },
  {
    id: 'm-10',
    number: '10',
    title: 'Exams & question bank',
    owner: 'Exam Officer',
    category: 'Academic',
    fields: 'Exam/unit/topic; question type; marks/duration; rubric; theory/practical maxima; schedules; moderation; result status',
    filters: 'Session / exam / class / subject / missing marks',
    flow: ['Draft', 'Approve paper', 'Assess', 'Moderate', 'Publish'],
    control: 'Secure question bank, configured grading, accommodations and report cards.',
    route: '/exams',
    actionLabel: 'Manage assessments',
  },
  {
    id: 'm-11',
    number: '11',
    title: 'Fees & payment accounts',
    owner: 'Finance',
    category: 'Finance',
    fields: 'Fee head/plan; student/year; invoice; due/instalment; concessions; transport allocation link; payment/receipt IDs',
    filters: 'Class / head / due date / balance / payment mode',
    flow: ['Assess', 'Invoice', 'Pay/report', 'Verify', 'Allocate', 'Receipt'],
    control: 'Single ledger; online/offline both; partial/overpayments and duplicate references handled.',
    route: '/fees',
    actionLabel: 'Collections & ledger',
  },
  {
    id: 'm-12',
    number: '12',
    title: 'Refunds & reconciliation',
    owner: 'Finance Approver',
    category: 'Finance',
    fields: 'Request; original payment; amount/reason; approvals; refund reference; settlement/bank batch; exceptions',
    filters: 'Pending / bank date / unmatched / refund stage',
    flow: ['Request', 'Independent approval', 'Execute', 'Reconcile'],
    control: 'Append reversals; do not edit posted receipts; refunds never exceed eligible paid value.',
    route: '/fees/controls',
    actionLabel: 'Review refunds',
  },
  {
    id: 'm-13',
    number: '13',
    title: 'Transport & GPS',
    owner: 'Transport Officer',
    category: 'Operations',
    fields: 'Vehicle/capacity; driver/attendant; route/stops; schedules; allocation dates; fee link; tracker mapping; location timestamp',
    filters: 'Route / trip / stop / capacity / stale GPS',
    flow: ['Route', 'Allocate', 'Validate', 'Trip', 'Track', 'Reconcile fees'],
    control: 'GPS trips restricted to mapped families; maintenance dates entered from verified records.',
    route: '/transport',
    actionLabel: 'Trips & fleet',
  },
  {
    id: 'm-14',
    number: '14',
    title: 'Library & digital repository',
    owner: 'Librarian',
    category: 'Operations',
    fields: 'ISBN/title; authors/category; accession/barcode; copy state; member; issue/due/return; rule version; licensed resource',
    filters: 'Title / author / availability / overdue / member',
    flow: ['Accession', 'Issue', 'Renew/reserve', 'Return/resolve'],
    control: 'Atomic copy issue; configurable limits/fines; digital uploads only with rights.',
    route: '/library',
    actionLabel: 'Circulation desk',
  },
  {
    id: 'm-15',
    number: '15',
    title: 'Staff directory & employment',
    owner: 'HR',
    category: 'HR',
    fields: 'Employee ID; name; school contact; department; designation; qualifications; joining/status history; assignments',
    filters: 'Department / designation / campus / employment status',
    flow: ['Verify', 'Activate', 'Effective-dated changes', 'Separation'],
    control: 'Bank, identity and salary kept outside public directory; revoke access on exit.',
    route: '/staff',
    actionLabel: 'Employee directory',
  },
  {
    id: 'm-16',
    number: '16',
    title: 'Staff attendance, leave & payroll',
    owner: 'HR / Staff',
    category: 'HR',
    fields: 'Shift; punches/timezone/source; exceptions; correction; leave type/dates; approvals; payroll component/version',
    filters: 'Date / department / missing punch / approval state',
    flow: ['Punch', 'Exception', 'Review', 'Approved payroll input'],
    control: 'No invented overtime/statutory rules; payroll approval separate from attendance correction.',
    route: '/staff/attendance',
    actionLabel: 'Punches & leave',
  },
  {
    id: 'm-17',
    number: '17',
    title: 'Recruitment & onboarding',
    owner: 'HR / Hiring Panel',
    category: 'HR',
    fields: 'Vacancy; candidate contact/CV; stage; interviews/evaluation; approval; employee link; checklist owner/due',
    filters: 'Vacancy / stage / interviewer / overdue onboarding',
    flow: ['Apply', 'Shortlist', 'Interview', 'Approve', 'Convert', 'Onboard'],
    control: 'Idempotent candidate conversion; candidate access and retention restricted.',
    route: '/hr/recruitment',
    actionLabel: 'Recruitment pipeline',
  },
  {
    id: 'm-18',
    number: '18',
    title: 'Procurement & vendor settlement',
    owner: 'Procurement / Finance',
    category: 'Operations',
    fields: 'Vendor identity/status; item lines; request; approval chain; PO/version; receipt discrepancy; bill/payment reference',
    filters: 'Vendor / stage / budget / pending receipt / unpaid',
    flow: ['Request', 'Approve', 'PO', 'Receive', 'Bill', 'Settle'],
    control: 'Transactional budget check, amendments, cancellation and independent finance authority.',
    route: '/procurement',
    actionLabel: 'Purchases & POs',
  },
  {
    id: 'm-19',
    number: '19',
    title: 'Budget, assets & inventory',
    owner: 'Stores / Finance',
    category: 'Finance',
    fields: 'Cost centre; allocation; commitment; expense; asset tag/location/custodian; stock movement; service date',
    filters: 'Department / asset state / low stock / utilisation',
    flow: ['Allocate', 'Commit', 'Receive', 'Consume/assign', 'Reconcile'],
    control: 'Avoid duplicate ledger; evidence-based depreciation if configured; disposal approval.',
    route: '/procurement',
    actionLabel: 'Assets & stores',
  },
  {
    id: 'm-20',
    number: '20',
    title: 'Notices & communication',
    owner: 'Authorised Publisher',
    category: 'Operations',
    fields: 'Audience; subject/body; template/channel; consent; publish/expiry; delivery/read status; retry key',
    filters: 'Audience / channel / failed / unread / date',
    flow: ['Draft', 'Approve', 'Queue', 'Deliver/retry', 'Read'],
    control: 'No sent claim for queued messages; parent language and quiet-hour preferences.',
    route: '/notices',
    actionLabel: 'Broadcast notices',
  },
  {
    id: 'm-21',
    number: '21',
    title: 'Concerns, tasks & SLA',
    owner: 'Department Owner',
    category: 'Operations',
    fields: 'Requester; category/priority; owner; due/SLA; visible update; internal note; status/history',
    filters: 'Owner / category / overdue / age / status',
    flow: ['Submit', 'Assign', 'Respond', 'Escalate', 'Resolve', 'Close'],
    control: 'Safeguarding stays separate; reassignment and internal-note visibility controlled.',
    route: '/concerns',
    actionLabel: 'Service desk',
  },
  {
    id: 'm-22',
    number: '22',
    title: 'Safeguarding & wellbeing',
    owner: 'Designated Officer',
    category: 'Governance',
    fields: 'Restricted case ID; concern; reporter; evidence; risk/review; assigned officers; controlled history',
    filters: 'Assigned case / urgency / review due',
    flow: ['Record', 'Protected triage', 'Action', 'Review', 'Restricted closure'],
    control: 'No generic dashboards/AI indexing/exports of case details; strict need-to-know access.',
    route: '/safeguarding',
    actionLabel: 'Protected cases',
  },
  {
    id: 'm-23',
    number: '23',
    title: 'PTM, consents & pickup',
    owner: 'Class Teacher / Front Office',
    category: 'Student & Parent',
    fields: 'PTM slot; guardian; meeting notes; consent version/decision; pickup delegate; validity; verification event',
    filters: 'Class / event / pending consent / today pickup',
    flow: ['Request/book', 'Review', 'Confirm', 'Verify completion'],
    control: 'Delegate approval is not physical release proof; contact changes require verification.',
    route: '/portal',
    actionLabel: 'Guardian consents',
  },
  {
    id: 'm-24',
    number: '24',
    title: 'Documents & certificates',
    owner: 'Records Office',
    category: 'Administration',
    fields: 'Document type/version; student/staff link; private file; issue number/date; approval; expiry if applicable',
    filters: 'Type / missing / approval / session',
    flow: ['Upload', 'Validate', 'Review', 'Issue/revoke', 'Audit'],
    control: 'Controlled TC/bonafide/report-card templates; authenticity verification without private-data exposure.',
    route: '/reports',
    actionLabel: 'Issue certificates',
  },
  {
    id: 'm-25',
    number: '25',
    title: 'Reports, import & export',
    owner: 'Scoped Operator',
    category: 'Governance',
    fields: 'Allowed report; filters; columns; import template/version; row errors; dedupe key; job/commit ID',
    filters: 'Entity / period / job status / errors / author',
    flow: ['Upload', 'Preview', 'Validate', 'Explicit commit', 'Summary'],
    control: 'Read-only preview; safe retry, scoped export, rollback/recovery strategy and audit.',
    route: '/reports',
    actionLabel: 'Audited exports',
  },
  {
    id: 'm-26',
    number: '26',
    title: 'Identity & access',
    owner: 'ERP Admin',
    category: 'Governance',
    fields: 'User/role; school/campus; record assignments; allowed actions; MFA state; lifecycle link; audit reason',
    filters: 'Role / scope / active / privileged / stale account',
    flow: ['Provision', 'Verify', 'Assign', 'Review', 'Revoke'],
    control: 'DigiVista support access time-limited; IT role cannot automatically read payroll or safeguarding.',
    route: '/users',
    actionLabel: 'Users & privileges',
  },
  {
    id: 'm-27',
    number: '27',
    title: 'Backup, security & operations',
    owner: 'Authorised IT',
    category: 'Governance',
    fields: 'Backup ID/hash/version; scope; attachment manifest; job result; restore validation; health/error records',
    filters: 'Date / scope / failed job / recovery test',
    flow: ['Backup', 'Integrity check', 'Isolated restore test', 'Recovery approval'],
    control: 'Encrypted secrets managed separately; no claim of recovery before successful restore evidence.',
    route: '/audit',
    actionLabel: 'System integrity',
  },
  {
    id: 'm-28',
    number: '28',
    title: 'AI assistant & automation',
    owner: 'Approved User / Reviewer',
    category: 'Platform',
    fields: 'Use case; permitted sources; prompt/output audit metadata; source links; reviewer; run status; budget',
    filters: 'Use case / approval / failures / cost',
    flow: ['Authorised retrieval', 'Draft', 'Review', 'Approved action'],
    control: 'No autonomous finance, eligibility or safeguarding decisions; redact personal data.',
    route: '/student-portal',
    actionLabel: 'CBSE Assistant',
  },
  {
    id: 'm-29',
    number: '29',
    title: 'Sports, arts, clubs & alumni',
    owner: 'Activity Coordinator',
    category: 'Student & Parent',
    fields: 'Activity/coach; enrolments; schedule/venue; participation; achievement evidence; alumni consent/contact',
    filters: 'Activity / class / team / event / consent',
    flow: ['Offer', 'Enrol', 'Schedule', 'Participate', 'Review/publish'],
    control: 'Sports, music, arts and computer activities visible with academic subjects where relevant.',
    route: '/academic/subjects',
    actionLabel: 'Activities catalogue',
  },
  {
    id: 'm-30',
    number: '30',
    title: 'Optional college extensions',
    owner: 'Dean / College Admin',
    category: 'Platform',
    fields: 'Programme; department; semester; credit; batch; course/elective; hostel/placement data if needed',
    filters: 'Programme / semester / department / cohort',
    flow: ['Configure institution type', 'Approved extension', 'Publish'],
    control: 'Not mandatory for this Nursery-XII school; add hostel/canteen/placement only when actually needed.',
    route: '/config-studio',
    actionLabel: 'Extension config',
  },
];

export function ModulesDirectoryPage(): ReactNode {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const categories = ['All', 'Administration', 'Academic', 'Student & Parent', 'Operations', 'Finance', 'HR', 'Governance', 'Platform'];

  const filteredModules = MODULE_CARDS.filter((mod) => {
    const matchesCat = selectedCategory === 'All' || mod.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      mod.title.toLowerCase().includes(q) ||
      mod.number.includes(q) ||
      mod.owner.toLowerCase().includes(q) ||
      mod.fields.toLowerCase().includes(q) ||
      mod.control.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        badge="Architecture Blueprint"
        title="30 Module Directory"
        description="Comprehensive build specification for Udaan Valley International School (Demo). Nursery to XII, 1,200+ students. Fields, filters, workflows, and strict governance controls for all 30 system modules."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/pain-points">
              <Button variant="secondary" size="sm">
                <Icon name="alert" className="h-4 w-4" />
                20-Year Pain Points (9)
              </Button>
            </Link>
            <Link to="/">
              <Button variant="primary" size="sm">
                <Icon name="dashboard" className="h-4 w-4" />
                Role UI Previews (17)
              </Button>
            </Link>
          </div>
        }
      />

      {/* Filter and search bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scroll-thin">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition min-h-[36px] shrink-0 ${
                selectedCategory === cat
                  ? 'bg-[#087F83] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-[#DDF4EC] hover:text-[#087F83]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative min-w-60">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search fields, filters, owner..."
            className="field-input !py-1.5 !text-xs !min-h-[38px] pl-8"
          />
          <Icon
            name="search"
            className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
          />
        </div>
      </div>

      {/* Count indicator */}
      <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
        <span>Showing {filteredModules.length} of 30 module cards</span>
        <span>DIGI · DigiVista Education Suite</span>
      </div>

      {/* Grid of 30 Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredModules.map((mod) => (
          <div
            key={mod.id}
            className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs hover:border-[#087F83]/50 transition flex flex-col justify-between"
          >
            <div>
              {/* Card Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#DDF4EC] font-extrabold text-[#087F83] text-xs">
                    {mod.number}
                  </span>
                  <div>
                    <h3 className="font-bold text-[#182944] text-sm leading-snug">
                      {mod.title}
                    </h3>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      {mod.category}
                    </span>
                  </div>
                </div>
                <Badge tone="mint" className="text-[10px] py-0.5">
                  {mod.owner}
                </Badge>
              </div>

              {/* Workflow Breadcrumb */}
              <div className="my-3 rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                  Workflow Lifecycle
                </p>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  {mod.flow.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <span className="font-semibold text-slate-700 bg-white px-2 py-0.5 rounded-md border border-slate-200 text-[11px]">
                        {step}
                      </span>
                      {idx < mod.flow.length - 1 && (
                        <span className="text-slate-400 font-bold">›</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Fields */}
              <div className="mb-2 text-xs">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px] block">
                  FIELDS:
                </span>
                <p className="text-slate-600 line-clamp-2 mt-0.5 text-[11px] leading-relaxed">
                  {mod.fields}
                </p>
              </div>

              {/* Filters */}
              <div className="mb-3 text-xs">
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px] block">
                  FILTERS:
                </span>
                <p className="text-slate-600 mt-0.5 text-[11px]">
                  {mod.filters}
                </p>
              </div>

              {/* Controls */}
              <div className="rounded-xl bg-[#FEF6E9]/50 border border-[#F6B84B]/30 p-2.5 text-xs text-[#B47408]">
                <div className="flex items-start gap-1.5">
                  <Icon name="shield" className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-medium leading-tight">
                    <strong className="font-bold">CONTROL:</strong> {mod.control}
                  </p>
                </div>
              </div>
            </div>

            {/* Action footer */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-semibold">
                Status: Verified in Build
              </span>
              <Link to={mod.route}>
                <Button variant="secondary" size="sm" className="!text-xs !py-1 !min-h-[34px]">
                  {mod.actionLabel}
                  <Icon name="arrowRight" className="h-3 w-3" />
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
