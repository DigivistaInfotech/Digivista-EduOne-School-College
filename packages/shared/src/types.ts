import type { Permission, ScopeType } from './permissions';
import type { AttendanceStatus } from './schemas';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation details, safe to show in the UI. */
    details?: Record<string, string[]>;
    requestId?: string;
  };
}

export type PermissionMap = Record<string, Permission[]>;

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string;
  status: 'invited' | 'active' | 'locked' | 'disabled';
}

export interface MembershipSummary {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  timezone: string;
  roles: string[];
  permissions: Permission[];
}

export interface MeResponse {
  user: SessionUser;
  memberships: MembershipSummary[];
}

export interface SchoolSummary {
  id: string;
  code: string;
  name: string;
  timezone: string;
  status: 'active' | 'inactive' | 'suspended';
}

export interface AcademicYear {
  id: string;
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: 'planned' | 'active' | 'closed' | 'archived';
}

export interface ClassRecord {
  id: string;
  code: string;
  name: string;
  gradeOrder: number | null;
  status: 'active' | 'inactive';
}

export interface SectionRecord {
  id: string;
  academicYearId: string;
  academicYearName: string;
  classId: string;
  className: string;
  code: string;
  name: string;
  capacity: number | null;
  enrolled: number;
  status: 'active' | 'inactive';
}

export interface SubjectRecord {
  id: string;
  code: string;
  name: string;
  subjectType: string;
  status: 'active' | 'inactive';
}

export interface GuardianRecord {
  id: string;
  firstName: string;
  lastName: string | null;
  occupation: string | null;
  email: string | null;
  phone: string | null;
  relationshipType: string;
  isPrimary: boolean;
  portalAccessStatus: 'pending' | 'verified' | 'revoked';
}

export interface EnrollmentRecord {
  id: string;
  academicYearId: string;
  academicYearName: string;
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  enrollmentStatus: string;
  startsOn: string;
  endsOn: string | null;
}

export interface StudentSummary {
  id: string;
  admissionNumber: string;
  firstName: string;
  lastName: string | null;
  status: string;
  className: string | null;
  sectionName: string | null;
  academicYearName: string | null;
  guardianCount: number;
}

export interface StudentDetail extends StudentSummary {
  bloodGroup?: string | null;
  emergencyContact?: string | null;
  gender?: 'female' | 'male' | 'other' | 'not_disclosed' | null;
  aadhaarLast4?: string | null;
  previousClass?: string | null;
  previousSchoolName?: string | null;
  homeAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  medicalInformation?: string | null;
  admissionDocuments?: Record<string, 'not_provided' | 'received' | 'verified' | 'not_applicable'>;
  middleName: string | null;
  dateOfBirth: string | null;
  createdAt: string;
  guardians: GuardianRecord[];
  enrollments: EnrollmentRecord[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SchoolOverview {
  studentsActive: number;
  studentsByClass: Array<{ classId: string; className: string; count: number }>;
  classes: number;
  sections: number;
  subjects: number;
  activeAcademicYear: { id: string; name: string; startsOn: string; endsOn: string } | null;
  pendingGuardianLinks: number;
  recentActivity: Array<{
    id: string;
    summary: string;
    eventType: string;
    occurredAt: string;
    actorName: string | null;
  }>;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: 'success' | 'denied' | 'failure' | 'system';
  reason: string | null;
  occurredAt: string;
  actorName: string | null;
  summary: string | null;
}

export interface ChildSummary {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  name?: string;
  rollNumber?: string | null;
  className: string | null;
  sectionName: string | null;
  academicYearName: string | null;
  relationshipType: string;
  isPrimary: boolean;
  portalAccessStatus: string;
}

export interface AttendanceSectionSummary {
  id: string;
  classId: string;
  className: string;
  code: string;
  name: string;
  academicYearId: string;
  academicYearName: string;
  startsOn: string;
  endsOn: string;
  status: 'active' | 'inactive';
}

export interface AttendancePendingCorrection {
  id: string;
  requestedStatus: AttendanceStatus;
  reason: string;
  requestedById: string;
  requestedByName: string | null;
  requestedAt: string;
}

export interface AttendanceRegisterRow {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  name?: string;
  rollNumber?: string | null;
  attendanceId: string | null;
  status: AttendanceStatus | null;
  note: string | null;
  source: string | null;
  recordedByName: string | null;
  pendingCorrection: AttendancePendingCorrection | null;
}

export interface AttendanceRegisterSummary {
  total: number;
  marked: number;
  unmarked: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  excused: number;
}

export interface AttendanceRegister {
  section: AttendanceSectionSummary;
  date: string;
  today: string;
  isFuture: boolean;
  isWithinYear: boolean;
  canRecord: boolean;
  summary: AttendanceRegisterSummary;
  rows: AttendanceRegisterRow[];
}

export interface AttendanceSaveResult {
  inserted: number;
  skipped: number;
  register: AttendanceRegister;
}

export interface AttendanceCorrection {
  id: string;
  attendanceId: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  sectionId: string;
  className: string;
  sectionName: string;
  attendanceDate: string;
  currentStatus: AttendanceStatus;
  requestedStatus: AttendanceStatus;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedById: string;
  requestedByName: string | null;
  requestedAt: string;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

/* -------------------------------- timetable ------------------------------- */

export interface TimetablePeriod {
  id: string;
  academicYearId: string;
  name: string;
  sequenceNo: number;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}

export interface RoomRecord {
  id: string;
  code: string;
  name: string;
  capacity: number | null;
  status: 'active' | 'inactive';
}

export interface TimetableSlot {
  id: string;
  academicYearId: string;
  sectionId: string;
  className: string;
  sectionName: string;
  periodId: string;
  dayOfWeek: number;
  subjectId: string;
  subjectName: string;
  teacherUserId: string;
  teacherName: string;
  roomId: string | null;
  roomName: string | null;
  notes: string | null;
}

export interface TimetableData {
  academicYearId: string | null;
  periods: TimetablePeriod[];
  rooms: RoomRecord[];
  slots: TimetableSlot[];
  teachers: Array<{ id: string; displayName: string }>;
}

/* ---------------------------------- fees ---------------------------------- */

export interface FeeHead {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive';
}

export interface FeeStructure {
  id: string;
  academicYearId: string;
  classId: string;
  className: string;
  feeHeadId: string;
  feeHeadName: string;
  amount: number;
  dueOn: string | null;
}

export interface StudentCharge {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  academicYearId: string;
  feeHeadId: string;
  feeHeadName: string;
  description: string;
  amount: number;
  concessionAmount: number;
  writeOffAmount: number;
  netAmount: number;
  paidAmount: number;
  refundedAmount: number;
  balance: number;
  dueOn: string;
  status: 'paid' | 'partial' | 'unpaid';
}

export interface PaymentAllocation {
  chargeId: string;
  feeHeadName: string;
  amount: number;
}

export interface PaymentRecord {
  id: string;
  receiptNumber: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  academicYearId: string;
  amount: number;
  refundedAmount: number;
  method: 'cash' | 'bank_transfer' | 'card' | 'upi' | 'cheque' | 'other';
  reference: string | null;
  paidOn: string;
  notes: string | null;
  status: 'recorded' | 'reversed';
  recordedByName: string | null;
  allocations: PaymentAllocation[];
  createdAt: string;
}

export interface RefundRecord {
  id: string;
  paymentId: string;
  receiptNumber: string;
  studentName: string;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedByName: string | null;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface FeeLedger {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string | null;
  sectionName: string | null;
  academicYearId: string | null;
  totalCharged: number;
  totalConcession: number;
  totalWriteOff: number;
  totalPaid: number;
  totalRefunded: number;
  balance: number;
  charges: StudentCharge[];
  payments: PaymentRecord[];
}

export interface FeeOverview {
  totalCharged: number;
  totalConcession: number;
  totalWriteOff: number;
  totalCollected: number;
  totalRefunded: number;
  totalOutstanding: number;
  chargeCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
}

/* ---------------------------------- exams --------------------------------- */

export interface GradingBand {
  id: string;
  minPercent: number;
  maxPercent: number;
  grade: string;
  remark: string | null;
}

export interface GradingScheme {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  bands: GradingBand[];
}

export interface ExamSubject {
  id: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  maxMarks: number;
  passMarks: number;
  marksEntered: number;
}

export interface ExamRecord {
  id: string;
  academicYearId: string;
  academicYearName: string;
  name: string;
  examType: string;
  startsOn: string;
  endsOn: string;
  gradingSchemeId: string;
  gradingSchemeName: string;
  passPercent: number;
  status: 'draft' | 'published';
  publishedAt: string | null;
  publishedByName: string | null;
  subjects: ExamSubject[];
}

export interface MarkSheetRow {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  name?: string;
  rollNumber?: string | null;
  className: string;
  sectionName: string;
  marksObtained: number | null;
  isAbsent: boolean;
  grade: string | null;
  enteredByName: string | null;
  updatedAt: string | null;
}

export interface MarkSheet {
  exam: ExamRecord;
  subject: ExamSubject;
  section: { id: string; className: string; name: string };
  canRecord: boolean;
  rows: MarkSheetRow[];
}

export interface ReportCardSubject {
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  passMarks: number;
  marksObtained: number | null;
  isAbsent: boolean;
  grade: string | null;
  passed: boolean | null;
}

export interface ReportCard {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string | null;
  sectionName: string | null;
  examId: string;
  examName: string;
  examStatus: 'draft' | 'published';
  publishedAt: string | null;
  subjects: ReportCardSubject[];
  totalMax: number;
  totalObtained: number;
  percentage: number | null;
  overallGrade: string | null;
  result: 'pass' | 'fail' | 'incomplete';
}

/* ---------------------------------- staff --------------------------------- */

export interface StaffRecord {
  institutionType?: 'school' | 'college' | 'university';
  staffTypeId?: string | null;
  designationId?: string | null;
  departmentId?: string | null;
  employmentTypeId?: string | null;

  id: string;
  userId: string | null;
  employeeNumber: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  name?: string;
  rollNumber?: string | null;
  email: string | null;
  phone: string | null;
  designation: string;
  department: string | null;
  joinedOn: string | null;
  status: 'active' | 'on_leave' | 'inactive' | 'left';
  hasSalary: boolean;
  pendingLeave: number;
}

export interface SalaryRecord {
  staffId: string;
  staffName: string;
  amount: number;
  currency: string;
  effectiveFrom: string;
  notes: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface LeaveRecord {
  id: string;
  staffId: string;
  staffName: string;
  leaveType: string;
  startsOn: string;
  endsOn: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedByName: string | null;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

/* --------------------------------- notices -------------------------------- */

export interface NoticeAttachmentSummary {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
}

export interface NoticeRecord {
  id: string;
  title: string;
  body: string;
  category: 'general' | 'academic' | 'examination' | 'holiday' | 'fee' | 'attendance' | 'parent_meeting' | 'school_event' | 'competition' | 'admission' | 'transport' | 'library' | 'health_safety' | 'achievement' | 'staff' | 'emergency';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  audience: 'all' | 'staff' | 'parents' | 'students';
  status: 'draft' | 'published' | 'archived';
  pinned: boolean;
  publishedAt: string | null;
  expiresOn: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: NoticeAttachmentSummary[];
  readByMe: boolean;
  /** Present for notice managers only; null when the viewer cannot see receipts. */
  readCount: number | null;
}

/* ---------------------------------- users --------------------------------- */

export interface UserRoleAssignment {
  assignmentId: string;
  roleCode: string;
  roleName: string;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeLabel: string | null;
}

export interface UserRecord {
  id: string;
  email: string | null;
  displayName: string;
  status: 'invited' | 'active' | 'locked' | 'disabled';
  createdAt: string;
  roles: UserRoleAssignment[];
}

/* --------------------------------- reports -------------------------------- */

export interface AttendanceReport {
  from: string;
  to: string;
  sections: Array<{
    sectionId: string;
    className: string;
    sectionName: string;
    totalMarked: number;
    present: number;
    absent: number;
    late: number;
    halfDay: number;
    excused: number;
    attendanceRate: number;
  }>;
}

export interface FeeReport {
  byHead: Array<{
    feeHeadId: string;
    feeHeadName: string;
    charged: number;
    collected: number;
    outstanding: number;
  }>;
  byClass: Array<{
    classId: string;
    className: string;
    charged: number;
    collected: number;
    outstanding: number;
  }>;
  byMethod: Array<{ method: string; amount: number; count: number }>;
}

/* ------------------------------ access control ----------------------------- */

export interface RoleSummary {
  code: string;
  name: string;
  description: string;
  defaultScopeType: ScopeType;
  permissions: Permission[];
}

/* ------------------------------ guardian portal ---------------------------- */

export interface PortalAttendanceDay {
  date: string;
  status: AttendanceStatus;
  note: string | null;
}

export interface PortalAttendance {
  studentId: string;
  from: string;
  to: string;
  totalMarked: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  excused: number;
  attendanceRate: number;
  days: PortalAttendanceDay[];
}

export type { AttendanceStatus, Permission, ScopeType };

/* ------------------------------- safeguarding ------------------------------ */

export interface SafeguardingCaseSummary {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  reference: string;
  category: 'safeguarding' | 'attendance' | 'wellbeing' | 'medical' | 'behaviour' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  status: 'open' | 'monitoring' | 'closed';
  openedOn: string;
  closedOn: string | null;
  openedByName: string | null;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SafeguardingNoteRecord {
  id: string;
  note: string;
  authorName: string | null;
  createdAt: string;
}

export interface SafeguardingCaseDetail extends SafeguardingCaseSummary {
  notes: SafeguardingNoteRecord[];
}

/* --------------------------------- leave ---------------------------------- */

export interface LeaveTypeRecord {
  id: string;
  code: string;
  name: string;
  annualQuotaDays: number;
  paid: boolean;
  active: boolean;
}

export interface HolidayRecord {
  id: string;
  name: string;
  holidayOn: string;
  academicYearId: string | null;
  notes: string | null;
}

export interface LeaveBalanceRecord {
  staffId: string;
  staffName: string;
  leaveType: string;
  quotaDays: number;
  approvedDays: number;
  pendingDays: number;
  remainingDays: number | null;
}

/* --------------------------------- payroll -------------------------------- */

export type PayrollStatus = 'draft' | 'approved' | 'paid';

export interface PayslipRecord {
  id: string;
  staffId: string;
  staffName: string;
  employeeNumber: string;
  grossAmount: number;
  deductions: number;
  netAmount: number;
  notes: string | null;
}

export interface PayrollRunSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollStatus;
  notes: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  paidOn: string | null;
  payslipCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  createdAt: string;
}

export interface PayrollRunDetail extends PayrollRunSummary {
  payslips: PayslipRecord[];
}

/* ------------------------------ fee extensions ---------------------------- */

export interface LateFeeRuleRecord {
  id: string;
  name: string;
  graceDays: number;
  percentPerMonth: number;
  maxAmount: number;
  active: boolean;
}

export interface LateFeeAssessmentRecord {
  id: string;
  chargeId: string;
  studentName: string;
  assessedOn: string;
  baseAmount: number;
  feeAmount: number;
  createdByName: string | null;
}

export interface LateFeeRunResult {
  assessed: number;
  skipped: number;
  totalFee: number;
  items: LateFeeAssessmentRecord[];
}

export interface InstallmentRecord {
  sequence: number;
  label: string;
  percent: number;
  dueOn: string;
  amount: number;
  paidAmount: number;
  status: 'pending' | 'partial' | 'paid' | 'overdue';
}

export interface ChargeInstallments {
  chargeId: string;
  description: string;
  amount: number;
  paidAmount: number;
  installments: InstallmentRecord[];
}

/* -------------------------------- transcripts ----------------------------- */

export interface TranscriptSubject {
  subjectName: string;
  maxMarks: number;
  obtainedMarks: number | null;
  isAbsent: boolean;
  grade: string | null;
}

export interface TranscriptExam {
  examId: string;
  name: string;
  examType: string;
  startsOn: string;
  endsOn: string;
  publishedAt: string;
  totalMarks: number;
  obtainedMarks: number;
  percentage: number | null;
  grade: string | null;
  result: 'pass' | 'fail' | 'incomplete';
  subjects: TranscriptSubject[];
}

export interface TranscriptRecord {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string | null;
  sectionName: string | null;
  academicYearName: string;
  exams: TranscriptExam[];
  cumulative: {
    totalMarks: number;
    obtainedMarks: number;
    percentage: number | null;
    grade: string | null;
  };
}

/* --------------------------------- import --------------------------------- */

export interface StudentImportError {
  row: number;
  message: string;
}

export interface StudentImportResult {
  created: number;
  failed: number;
  errors: StudentImportError[];
}

/* ------------------ advanced attendance (Classes 6-12) ------------------- */

export interface PeriodAttendanceItem {
  periodNumber: number;
  name: string;
  time: string;
  subjectName: string;
  teacherName: string;
  teacherCode: string;
  isSubstitute: boolean;
  substituteTeacherName: string | null;
  status: 'present' | 'absent' | 'late' | 'excused' | 'unmarked';
}

export interface SubjectWiseAttendanceItem {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  teacherName: string;
  teacherCode: string;
  classesHeld: number;
  classesAttended: number;
  classesMissed: number;
  percentage: number;
}

export interface AdvancedAttendanceSummary {
  student: {
    id: string;
    studentId?: string;
    name: string;
    fullName?: string;
    admissionNumber: string;
    rollNumber: string | null;
    className: string;
    classCode: string;
    sectionName: string;
    stream: string;
  };
  session: string;
  cumulative: {
    workingDays: number;
    presentDays: number;
    absentDays: number;
    excusedDays: number;
    percentage: number;
  };
  monthWise: Array<{
    month: string;
    year: number;
    totalDays: number;
    presentDays: number;
    percentage: number;
  }>;
  dateWise: {
    date: string;
    markedPeriods: number;
    presentPeriods: number;
    absentPeriods: number;
    unmarkedPeriods: number;
    periods: PeriodAttendanceItem[];
  };
  periods?: PeriodAttendanceItem[];
  subjectWise: SubjectWiseAttendanceItem[];
  shortageAlert: {
    isShortage: boolean;
    currentRate: number;
    requiredThreshold: number;
    boardThreshold: number;
    status: 'normal' | 'preventive_warning' | 'shortage_alert' | 'examination_review';
    message: string;
  };
}

/* ------------------- parent portal child dashboard ----------------------- */

export interface ParentChildDashboardSummary {
  child: ChildSummary;
  attendance: {
    overallPercentage: number;
    statusToday: string;
    markedAt: string | null;
  };
  homework: {
    pendingCount: number;
    items: Array<{
      id: string;
      subjectName: string;
      title: string;
      dueAt: string;
    }>;
  };
  fees: {
    totalDue: number;
    dueDate: string | null;
    breakdown: {
      tuition: number;
      transport: number;
      other: number;
    };
    recentPayments: Array<{
      date: string;
      description: string;
      amount: number;
      status: string;
      receiptNumber: string | null;
    }>;
  };
  transport: {
    vehicleNumber: string | null;
    assignedVehicle?: string | null;
    routeName: string | null;
    routeNumber?: string | null;
    stopName: string | null;
    pickupTime: string | null;
    dropTime: string | null;
    illustrativeEta: string | null;
    alerts: {
      busApproaching: boolean;
      boarding: boolean;
      dropOff: boolean;
      delays: boolean;
    };
    isLiveGps: boolean;
    gpsStatusLabel: string;
    timeline?: Array<{
      name: string;
      time: string;
      isChildStop: boolean;
    }>;
    routeTimeline: Array<{
      name: string;
      time: string;
      isChildStop: boolean;
    }>;
  };
  nextClass: {
    subjectName: string;
    timing: string;
    room: string;
  } | null;
  academicProgress: {
    termName: string;
    subjects: Array<{
      name: string;
      percentage: number;
      grade: string;
    }>;
  };
  messages: Array<{
    id: string;
    senderName: string;
    senderRole: string;
    title: string;
    content: string;
    createdAt: string;
    isRead: boolean;
    category: string;
  }>;
  documents: Array<{
    id: string;
    type: string;
    title: string;
    status: 'submitted' | 'pending' | 'verified';
  }>;
  upcomingEvents: Array<{
    date: string;
    title: string;
    timing?: string;
  }>;
}

/* ------------------- student portal rich dashboard ----------------------- */

export interface StudentDashboardSummary {
  student: {
    id: string;
    name: string;
    admissionNumber: string;
    rollNumber: string | null;
    className: string;
    sectionName: string;
    academicYearName: string;
    gradeTier: import('./studentStage').StudentStage;
  };
  attendance: {
    statusToday: string;
    overallPercentage: number;
    monthName: string;
  };
  homework: {
    pendingCount: number;
    todayItems: Array<{
      id: string;
      subjectName: string;
      title: string;
      instructions: string;
      dueAt: string;
    }>;
  };
  timetable: Array<{
    periodNumber: number;
    subjectName: string;
    teacherName: string;
    time: string;
    room: string;
  }>;
  learningCorner: Array<{
    id: string;
    subjectName: string;
    title: string;
    resourceType: string;
    url?: string;
    summary?: string;
  }>;
  notices: Array<{
    id: string;
    title: string;
    date: string;
    category: string;
  }>;
}

export interface StudentLeaveRequest {
  id: string;
  studentId: string;
  startsOn: string;
  endsOn: string;
  reasonCategory: string;
  reasonText: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  reviewNotes?: string | null;
  createdAt: string;
}

export interface StudentPickupAuthorisation {
  id: string;
  studentId: string;
  authorisedPersonName: string;
  relationship: string;
  phone: string;
  idProofType: string;
  idProofNumber?: string | null;
  validFrom: string;
  validTo?: string | null;
  emergencyOnly: boolean;
  status: 'approved' | 'pending' | 'revoked';
}

export interface StudentDocumentConsent {
  id: string;
  studentId: string;
  documentType: string;
  title: string;
  description?: string | null;
  status: 'submitted' | 'pending' | 'verified' | 'rejected';
  submittedAt?: string | null;
}


export interface SchoolGeofence {
  id: string;
  name: string;
  locationType: 'campus' | 'sports_ground' | 'transport_depot' | 'approved_offsite' | 'event_venue';
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxAccuracyThresholdMeters: number;
  isActive: boolean;
  notes?: string | null;
  campusId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffBiometricProfileSummary {
  enrolled: boolean;
  status: 'pending' | 'enrolled' | 'withdrawn' | 'suspended';
  consentGiven: boolean;
  profile?: {
    id: string;
    enrolmentStatus: string;
    consentGiven: boolean;
    consentVersion: string;
    consentGivenAt: string | null;
    enrolledAt: string | null;
    templateAlgorithm: string;
    templateHash: string;
    qualityScore: number | null;
  } | null;
}

export interface StaffPunchStatus {
  staff: {
    id: string;
    employeeNumber: string;
    name: string;
  };
  workDate: string;
  currentPunchState: 'not_punched_in' | 'punched_in' | 'punched_out';
  todayAttendance: {
    id: string;
    punchIn: string | null;
    punchOut: string | null;
    status: string;
  } | null;
  assignedShift: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
  } | null;
  biometricEnrolled: boolean;
  geofences: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
  }>;
}

export interface StaffPunchEvent {
  id: string;
  staffId: string;
  workDate: string;
  punchType: 'punch_in' | 'punch_out' | 'break_start' | 'break_end';
  punchedAt: string;
  verificationStatus:
    | 'verified'
    | 'out_of_geofence'
    | 'poor_accuracy'
    | 'face_mismatch'
    | 'liveness_failed'
    | 'camera_denied'
    | 'location_denied'
    | 'technical_failure'
    | 'manual_review_required'
    | 'approved_exception';
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  geofenceVerified: boolean;
  geofenceName?: string | null;
  livenessScore: number | null;
  livenessVerified: boolean;
  matchConfidence: number | null;
  faceMatched: boolean;
  failureReason?: string | null;
  deviceSource: string;
  kioskName?: string | null;
  firstName?: string;
  lastName?: string;
  employeeNumber?: string;
}

export interface StaffAttendanceException {
  id: string;
  staffId: string;
  workDate: string;
  exceptionType: string;
  requestedPunchIn: string | null;
  requestedPunchOut: string | null;
  reason: string;
  supportingDocumentName?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy?: string;
  requestedAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  firstName?: string;
  lastName?: string;
  staffName?: string;
  employeeNumber?: string;
  requestedByName?: string;
  reviewedByName?: string | null;
}

export interface AttendanceKiosk {
  id: string;
  deviceCode: string;
  deviceName: string;
  status: 'active' | 'inactive' | 'maintenance';
  lastHeartbeatAt?: string | null;
  appVersion?: string | null;
  ipAddress?: string | null;
  geofenceName?: string | null;
  campusName?: string | null;
  createdAt: string;
  updatedAt: string;
}
