import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Icon, PageHeader } from '../components/ui';

interface PainPointItem {
  id: string;
  problem: string;
  symptom: string;
  solution: string;
  controls: string;
  route: string;
  module: string;
  status: 'Resolved in Asterleaf Build' | 'Protected by Verification';
}

const PAIN_POINTS: PainPointItem[] = [
  {
    id: 'pp-1',
    problem: 'Scattered registers / Excel',
    symptom: 'Different teachers keeping detached spreadsheets, duplicate student records, and unverified opening balances during session rollover.',
    solution: 'One verified student master + historical year view; preview imports, duplicate review and reconciled opening balances.',
    controls: 'ADM unique sequential indexing, guardian portal link verification, atomic admission transaction.',
    route: '/students',
    module: '03 Student & guardian master',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-2',
    problem: 'Fees dispute / wrong transport charge',
    symptom: 'Disputes over paid tuition fees, unallocated transport pickup charges, or parents claiming paid cash without official counter receipts.',
    solution: 'Versioned fee plans, effective route allocations, bank-matched deposits, receipts and correction approvals.',
    controls: 'Single student ledger, static QR fallback with finance scroll match, reversals instead of deletion.',
    route: '/fees',
    module: '11 Fees & payment accounts',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-3',
    problem: 'Teacher absence / wasted periods',
    symptom: 'Unannounced educator absence leading to empty classrooms, unsupervised periods, and curriculum delays.',
    solution: 'Availability and workload checks; suggested substitutes; coordinator approval; actual delivery record.',
    controls: 'Slot collision prevention across section, teacher, and room; substitution acknowledgement log.',
    route: '/academic/timetable',
    module: '05 Timetable & substitution',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-4',
    problem: 'Parents call everyone',
    symptom: 'Confused parents calling teachers on personal phones at all hours or bombarding admin desks for basic inquiries.',
    solution: 'Verified teacher directory, contact hours, tracked service requests, PTM slots and meaningful notices.',
    controls: 'Masked contact policy; personal phone numbers restricted; official school extension and contact hours published.',
    route: '/portal',
    module: '23 PTM, consents & pickup',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-5',
    problem: 'Inflated syllabus progress',
    symptom: 'Teachers ticking topics as completed without evidence, leaving students unprepared for Board exams.',
    solution: 'Topic-based completion with lesson evidence; HOD review; student mastery tracked separately from coverage.',
    controls: 'Coverage derived from actual taught periods and lesson logs; distinguish planned, taught, and assessed.',
    route: '/learning',
    module: '08 Lesson plan & syllabus',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-6',
    problem: 'Attendance errors / panic',
    symptom: 'Accidental absent marking causing panic, followed by sudden exam debarment without review or medical condonation.',
    solution: 'Missing-mark alerts, approved corrections, calculation detail and reviewed shortage cases; no automatic class ban.',
    controls: 'CBSE 80% rule with Principal condonation ladder up to 15%; dual review before final board submission; insert-only daily roll call.',
    route: '/attendance/shortages',
    module: '07 Shortage & eligibility review',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-7',
    problem: 'Unsafe pickup / uncertain bus status',
    symptom: 'Unknown relatives attempting child release at the school gate; anxious parents waiting at bus stops with no GPS visibility.',
    solution: 'Verified delegates + release event, assigned-trip tracking, stale-location alert and incident escalation.',
    controls: 'Strict privacy boundary: parents see only their child assigned route; stale GPS banner; delegate verification proof.',
    route: '/transport',
    module: '13 Transport & GPS',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-8',
    problem: 'Last-minute exams / staff exit',
    symptom: 'Missing examination marks discovered right before report card printing; exiting staff keeping access credentials.',
    solution: 'Missing-mark checklist, dual approval publication; onboarding/exit tasks and immediate authorised access revocation.',
    controls: 'Mark entry locking; published report cards require marks for every registered subject; session invalidation on staff exit.',
    route: '/exams',
    module: '10 Exams & question bank',
    status: 'Resolved in Asterleaf Build',
  },
  {
    id: 'pp-9',
    problem: 'Year rollover loses history',
    symptom: 'Moving to a new academic session overwrites student academic records, erasing prior marks, disciplinary logs, and fee balances.',
    solution: 'Promotion preview, subject choices, carry-forward reconciliation, archive preservation and isolated restore test.',
    controls: 'Multi-year schema; closing previous year without truncating records; immutable audit trail.',
    route: '/academic/years',
    module: '01 School & campus setup',
    status: 'Resolved in Asterleaf Build',
  },
];

export function PainPointsPage(): ReactNode {
  return (
    <div className="space-y-6">
      <PageHeader
        badge="Operational Blueprint"
        title="20-Year School: Operational Pain Points Solved"
        description="Established institutions with 1,200+ students face systematic friction points. DIGI addresses each historic operational vulnerability with strict database-level constraints and human-in-the-loop approvals."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/modules">
              <Button variant="secondary" size="sm">
                <Icon name="layers" className="h-4 w-4" />
                30 Module Cards
              </Button>
            </Link>
            <Link to="/">
              <Button variant="primary" size="sm">
                <Icon name="dashboard" className="h-4 w-4" />
                Return to Overview
              </Button>
            </Link>
          </div>
        }
      />

      {/* Grid of 9 pain points */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {PAIN_POINTS.map((item, idx) => (
          <div
            key={item.id}
            className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex flex-col justify-between hover:border-[#087F83]/50 transition"
          >
            <div>
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#FEF6E9] font-extrabold text-[#B47408] text-xs">
                  {idx + 1}
                </span>
                <Badge tone="mint" className="text-[10px]">
                  {item.status}
                </Badge>
              </div>

              <h3 className="text-base font-bold text-[#182944] mb-1">
                {item.problem}
              </h3>

              <div className="mb-3 rounded-xl bg-rose-50/60 border border-rose-100 p-2.5 text-xs text-rose-900">
                <span className="font-bold text-[10px] uppercase tracking-wider block text-rose-700 mb-0.5">
                  Historical Failure Mode:
                </span>
                <p className="text-[11px] leading-relaxed">{item.symptom}</p>
              </div>

              <div className="mb-3 rounded-xl bg-[#DDF4EC]/40 border border-[#087F83]/20 p-2.5 text-xs text-slate-800">
                <span className="font-bold text-[10px] uppercase tracking-wider block text-[#087F83] mb-0.5">
                  Asterleaf Solution:
                </span>
                <p className="text-[11px] leading-relaxed font-medium">{item.solution}</p>
              </div>

              <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="font-bold text-[10px] uppercase tracking-wider block text-slate-500 mb-0.5">
                  Structural Control:
                </span>
                <p className="text-[11px] leading-relaxed">{item.controls}</p>
              </div>
            </div>

            {/* Footer action */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase">
                {item.module}
              </span>
              <Link to={item.route}>
                <Button variant="secondary" size="sm" className="!text-xs !py-1 !min-h-[34px]">
                  Inspect Module
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
