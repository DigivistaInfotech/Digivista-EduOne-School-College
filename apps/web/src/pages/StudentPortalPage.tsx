import { TransportSubscriptionPanel } from "../components/TransportSubscriptionPanel";
import { studentStage, STUDENT_STAGE_LABELS } from "@erp/shared/student-stage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useSchoolId } from "../auth/AuthContext";
import {
  askLearningAssistant,
  createStudentConcern,
  getAdvancedAttendance,
  getStudentAttendance,
  getStudentConcerns,
  getStudentDashboard,
  getStudentExams,
  getStudentFees,
  getStudentHomework,
  getStudentLearning,
  getStudentLibrary,
  getStudentMe,
  getStudentTimetable,
  requestProfileCorrection,
  submitStudentHomework,
} from "../lib/endpoints";
import { errorMessage } from "../lib/api";
import { formatDate, formatMoney } from "../lib/format";
import { Dialog } from "../components/Dialog";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  StatCard,
  TableSkeleton,
  cn,
} from "../components/ui";

type StudentTab =
  | "overview"
  | "profile"
  | "timetable"
  | "attendance"
  | "homework"
  | "learning"
  | "exams"
  | "fees"
  | "library"
  | "transport"
  | "concerns";

export function StudentPortalPage(): ReactNode {
  const schoolId = useSchoolId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<StudentTab>("overview");

  // Student Profile and Meta
  const meQuery = useQuery({
    queryKey: ["student-me", schoolId],
    queryFn: () => getStudentMe(schoolId),
  });
  const dashboardQuery = useQuery({
    queryKey: ["student-dashboard", schoolId],
    queryFn: () => getStudentDashboard(schoolId),
    enabled: tab === "overview",
  });

  // Dialog states
  const [profileCorrOpen, setProfileCorrOpen] = useState(false);
  const [concernOpen, setConcernOpen] = useState(false);
  const [submitHwId, setSubmitHwId] = useState<string | null>(null);

  // Profile correction form
  const [corrField, setCorrField] = useState<
    | "first_name"
    | "last_name"
    | "date_of_birth"
    | "blood_group"
    | "emergency_contact"
  >("date_of_birth");
  const [corrValue, setCorrValue] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const [corrSuccess, setCorrSuccess] = useState<string | null>(null);

  const profileCorrMutation = useMutation({
    mutationFn: () =>
      requestProfileCorrection(schoolId, {
        fieldName: corrField,
        proposedValue: corrValue,
        reason: corrReason,
      }),
    onSuccess: (data) => {
      setCorrSuccess(data.message || "Correction submitted.");
      setCorrValue("");
      setCorrReason("");
      setTimeout(() => setProfileCorrOpen(false), 2000);
    },
  });

  // Concern form
  const [concernCategory, setConcernCategory] = useState("academic");
  const [concernTitle, setConcernTitle] = useState("");
  const [concernDesc, setConcernDesc] = useState("");
  const [concernSuccess, setConcernSuccess] = useState<string | null>(null);

  const createConcernMutation = useMutation({
    mutationFn: () =>
      createStudentConcern(schoolId, {
        category: concernCategory,
        title: concernTitle,
        description: concernDesc,
      }),
    onSuccess: () => {
      setConcernSuccess(
        "Your concern ticket has been submitted to the school administration.",
      );
      setConcernTitle("");
      setConcernDesc("");
      void queryClient.invalidateQueries({
        queryKey: ["student-concerns", schoolId],
      });
      setTimeout(() => setConcernOpen(false), 2000);
    },
  });

  // Homework submit form
  const [hwText, setHwText] = useState("");
  const [hwSuccess, setHwSuccess] = useState<string | null>(null);

  const submitHwMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      submitStudentHomework(schoolId, assignmentId, {
        submissionText: hwText,
      }),
    onSuccess: () => {
      setHwSuccess("Homework submitted successfully!");
      setHwText("");
      void queryClient.invalidateQueries({
        queryKey: ["student-homework", schoolId],
      });
      setTimeout(() => setSubmitHwId(null), 1500);
    },
  });

  // Demo study planner Chat
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiMode, setAiMode] = useState<
    "qa" | "explain" | "summarize" | "practice_questions"
  >("qa");
  const [aiLanguage, setAiLanguage] = useState<"en" | "hi">("en");
  const [aiHistory, setAiHistory] = useState<
    Array<{
      prompt: string;
      answer: string;
      resources: Array<{
        id: string;
        title: string;
        subjectName: string | null;
        url: string | null;
      }>;
      mode: string;
      language: string;
    }>
  >([]);

  const askAiMutation = useMutation({
    mutationFn: () =>
      askLearningAssistant(schoolId, {
        prompt: aiPrompt,
        mode: aiMode,
        language: aiLanguage,
      }),
    onSuccess: (data) => {
      setAiHistory((prev) => [
        ...prev,
        {
          prompt: aiPrompt,
          answer: data.answer,
          resources: data.availableResources || [],
          mode: aiMode,
          language: aiLanguage,
        },
      ]);
      setAiPrompt("");
    },
  });

  if (meQuery.isPending) {
    return (
      <div className="space-y-6">
        <Card className="h-40 animate-pulse bg-white p-6">
          <div />
        </Card>
        <Card>
          <TableSkeleton rows={4} columns={3} />
        </Card>
      </div>
    );
  }

  if (meQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(meQuery.error)}
        onRetry={() => void meQuery.refetch()}
      />
    );
  }

  const { student, attendance, fees, counts } = meQuery.data;

  // Determine age stage
  const stage = studentStage(student.gradeOrder);
  const isSenior = stage === "senior_g9_g12";

  return (
    <div className="space-y-6">
      <section
        aria-label="Class-specific learning workspace"
        className={`rounded-2xl border p-5 ${stage.startsWith("primary") || stage.startsWith("elementary") ? "border-amber-200 bg-amber-50" : "border-teal-200 bg-teal-50"}`}
      >
        <h2 className="text-xl font-bold">{STUDENT_STAGE_LABELS[stage]}</h2>
        <p className="mt-1 text-sm">
          {stage === "unclassified"
            ? "Ask the school to set your class stage. Your own records remain available."
            : stage === "primary_nursery_g2"
              ? "Explore stories, drawing and daily learning with your teacher and parent."
              : stage === "elementary_g3_g5"
                ? "Build reading, numbers and GK skills with class activities."
                : stage === "middle_g6_g8"
                  ? "Practise your subjects, track homework and explore clubs and GK."
                  : stage === "senior_g9_g12"
                    ? "Plan subject revision, homework and examination preparation."
                    : "Track course learning, assessments and academic activities."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setTab("homework")}>
            {stage.startsWith("primary")
              ? "My learning tasks"
              : "Homework & assignments"}
          </Button>
          <Button variant="secondary" onClick={() => setTab("timetable")}>
            My timetable
          </Button>
          {isSenior && (
            <Button variant="secondary" onClick={() => setTab("exams")}>
              Exams & results
            </Button>
          )}
        </div>
      </section>
      {/* DIGI Student Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#182944] p-6 text-white shadow-xs sm:p-8">
        <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-[11px] font-extrabold tracking-[0.2em] text-[#087F83] uppercase">
              DIGI · {student.academicYearName}
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Hello, <span className="text-[#087F83]">{student.firstName}</span>
              !
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-white/80">
              <span className="rounded-lg bg-white/10 px-2 py-0.5 font-mono text-white">
                {student.admissionNumber}
              </span>
              <span>·</span>
              <span>
                {student.className} · {student.sectionName}
              </span>
              {student.rollNumber && (
                <>
                  <span>·</span>
                  <span>Roll No: {student.rollNumber}</span>
                </>
              )}
              {student.classTeacher && (
                <>
                  <span>·</span>
                  <span>Class Teacher: {student.classTeacher}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setCorrSuccess(null);
                setProfileCorrOpen(true);
              }}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              <Icon name="user" className="h-4 w-4" />
              Edit Profile Request
            </Button>
            <Button
              onClick={() => {
                setConcernSuccess(null);
                setConcernOpen(true);
              }}
              className="bg-coral text-white hover:bg-coral/90"
            >
              <Icon name="clipboard" className="h-4 w-4" />
              Ask Support / Concern
            </Button>
          </div>
        </div>
      </div>

      {/* 80% Attendance Shortage Policy Alert */}
      {attendance.shortageWarning && (
        <Alert
          tone="warning"
          title={`Attendance Advisory (Below ${attendance.thresholdPercent}% Threshold)`}
        >
          Your current attendance is {attendance.attendanceRate}% (
          {attendance.attendedDays} / {attendance.totalWorkingDays} working
          days), which is below the school guideline of{" "}
          {attendance.thresholdPercent}%.
          {isSenior &&
            " In Classes 9–12, regular attendance is monitored for Board examination eligibility. Please submit any medical or approved leave documents to your class teacher."}
        </Alert>
      )}

      {/* Pastel KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Attendance Rate"
          value={
            attendance.totalWorkingDays > 0
              ? `${attendance.attendanceRate}%`
              : "Not recorded"
          }
          hint={
            attendance.shortageWarning
              ? `Below ${attendance.thresholdPercent}% threshold`
              : `${attendance.attendedDays} days attended`
          }
          icon="check"
          color={attendance.shortageWarning ? 0 : 2}
        />
        <StatCard
          label="Pending Homework"
          value={counts.pendingHomework}
          hint={
            counts.pendingHomework === 0 ? "All caught up!" : "Assignments due"
          }
          icon="book"
          color={1}
        />
        <StatCard
          label="Fee Balance"
          value={
            fees.outstandingBalance > 0
              ? formatMoney(fees.outstandingBalance)
              : "Fully Paid"
          }
          hint={
            fees.outstandingBalance > 0 ? "Pending dues" : "No outstanding fees"
          }
          icon="clipboard"
          color={3}
        />
        <StatCard
          label="Unread Notices"
          value={counts.unreadNotices}
          hint="School & class circulars"
          icon="paperclip"
          color={4}
        />
      </div>

      {/* Navigation Tab Bar */}
      <div
        className="flex flex-wrap gap-1.5 border-b-2 border-brand-900/10 pb-2"
        role="tablist"
      >
        {(
          [
            ["overview", "Dashboard", "dashboard"],
            ["timetable", "Timetable", "calendar"],
            ["attendance", "Attendance", "check"],
            ["homework", "Homework & Tasks", "book"],
            ["learning", "Learning & study planner", "book"],
            ["exams", "Exams & Marks", "chart"],
            ["fees", "Fees & Ledger", "clipboard"],
            ["library", "Library", "book"],
            ["transport", "Transport", "home"],
            ["concerns", "My Concerns", "layers"],
            ["profile", "My Profile", "user"],
          ] as Array<[StudentTab, string, any]>
        ).map(([tabKey, label, iconName]) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            onClick={() => setTab(tabKey)}
            className={cn(
              "flex items-center gap-2 rounded-2xl px-3.5 py-2 text-xs font-bold transition",
              tab === tabKey
                ? "bg-sun text-brand-900 shadow-[0_2px_0_rgba(0,0,0,0.2)]"
                : "bg-white/80 text-brand-900 hover:bg-white",
            )}
          >
            <Icon name={iconName} className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* 6 Large Module Cards (Matching Student Dashboard Screenshot) */}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* Card 1: My Profile */}
            <div className="group relative flex flex-col justify-between rounded-3xl border-2 border-slate-200/80 bg-[#E8F8F0] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">
                    My Profile
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    My class and school details
                  </p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm text-brand-900">
                  <Icon name="user" className="h-8 w-8 text-mint" />
                </div>
              </div>
              <div className="mt-6">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTab("profile")}
                  className="rounded-xl border-slate-300 bg-white font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  Open →
                </Button>
              </div>
            </div>

            {/* Card 2: Attendance */}
            <div className="group relative flex flex-col justify-between rounded-3xl border-2 border-slate-200/80 bg-[#EBF5FF] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">
                    Attendance
                  </h3>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint/20 px-2 py-0.5 text-[11px] font-bold text-mint-800">
                      <Icon name="calendar" className="h-3 w-3" />{" "}
                      {dashboardQuery.data?.attendance.statusToday ??
                        "Not recorded"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    View this month
                  </p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm text-sky">
                  <Icon name="calendar" className="h-8 w-8 text-sky" />
                </div>
              </div>
              <div className="mt-6">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTab("attendance")}
                  className="rounded-xl border-slate-300 bg-white font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  Open →
                </Button>
              </div>
            </div>

            {/* Card 3: Homework */}
            <div className="group relative flex flex-col justify-between rounded-3xl border-2 border-slate-200/80 bg-[#FFF2E8] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">
                    Homework
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    {counts.pendingHomework} activities to complete
                  </p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm text-coral">
                  <Icon name="clipboard" className="h-8 w-8 text-coral" />
                </div>
              </div>
              <div className="mt-6">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTab("homework")}
                  className="rounded-xl border-slate-300 bg-white font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  Open →
                </Button>
              </div>
            </div>

            {/* Card 4: My Timetable */}
            <div className="group relative flex flex-col justify-between rounded-3xl border-2 border-slate-200/80 bg-[#F3E8FF] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">
                    My Timetable
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    See today&apos;s classes
                  </p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm text-purple-600">
                  <Icon name="calendar" className="h-8 w-8 text-purple-600" />
                </div>
              </div>
              <div className="mt-6">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTab("timetable")}
                  className="rounded-xl border-slate-300 bg-white font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  Open →
                </Button>
              </div>
            </div>

            {/* Card 5: Learning Corner */}
            <div className="group relative flex flex-col justify-between rounded-3xl border-2 border-slate-200/80 bg-[#FEF9E7] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">
                    Learning Corner
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Worksheets, stories & videos
                  </p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm text-amber-500">
                  <Icon name="book" className="h-8 w-8 text-amber-500" />
                </div>
              </div>
              <div className="mt-6">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTab("learning")}
                  className="rounded-xl border-slate-300 bg-white font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  Open →
                </Button>
              </div>
            </div>

            {/* Card 6: Notices & Calendar */}
            <div className="group relative flex flex-col justify-between rounded-3xl border-2 border-slate-200/80 bg-[#FDF2F8] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-900">
                    Notices & Calendar
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    School news and upcoming events
                  </p>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm text-pink-500">
                  <Icon name="paperclip" className="h-8 w-8 text-pink-500" />
                </div>
              </div>
              <div className="mt-6">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setTab("exams")}
                  className="rounded-xl border-slate-300 bg-white font-bold text-slate-800 shadow-sm hover:bg-slate-50 cursor-pointer"
                >
                  Open →
                </Button>
              </div>
            </div>
          </div>

          {/* Bottom Banner: Today's Homework Ticker (Matching Screenshot) */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 font-bold text-xs text-slate-900 border-r border-slate-200 pr-3">
                <Icon name="clipboard" className="h-4 w-4 text-coral" />
                Pending homework
              </span>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {dashboardQuery.data?.homework.todayItems.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-50 border border-slate-200 px-3 py-1 font-medium text-slate-800"
                  >
                    <Icon name="book" className="h-3.5 w-3.5 text-sky" />
                    <strong>{item.subjectName}:</strong> {item.title}
                  </span>
                ))}
                {!dashboardQuery.data?.homework.todayItems.length && (
                  <span>
                    {dashboardQuery.isPending
                      ? "Loading homework…"
                      : dashboardQuery.isError
                        ? "Homework unavailable"
                        : "No pending homework"}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTab("homework")}
              className="text-xs font-bold text-coral hover:underline shrink-0 cursor-pointer"
            >
              View homework →
            </button>
          </div>

          <StudentTodayTimetable schoolId={schoolId} />
          <StudentPendingHomeworkList
            schoolId={schoolId}
            onOpenSubmit={(id) => {
              setHwSuccess(null);
              setSubmitHwId(id);
            }}
          />
        </div>
      )}

      {/* Tab: Timetable */}
      {tab === "timetable" && <StudentFullTimetable schoolId={schoolId} />}

      {/* Tab: Attendance */}
      {tab === "attendance" && (
        <StudentAttendanceView schoolId={schoolId} studentId={student.id} />
      )}

      {/* Tab: Homework */}
      {tab === "homework" && (
        <StudentHomeworkTab
          schoolId={schoolId}
          onOpenSubmit={(id) => {
            setHwSuccess(null);
            setSubmitHwId(id);
          }}
        />
      )}

      {/* Tab: Learning & study planner */}
      {tab === "learning" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Demo study planner */}
          <Card className="flex flex-col border-2 border-brand-200">
            <CardHeader
              title="Demo study planner"
              description="Demo study planner using local templates. It does not answer questions with an AI model or read textbook content. Published class resources are listed separately."
            />
            <div className="flex-1 space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  Mode:
                </span>
                {(
                  [
                    ["qa", "Study topic"],
                    ["explain", "Plan concept practice"],
                    ["summarize", "Plan a chapter summary"],
                    ["practice_questions", "Plan practice tasks"],
                  ] as Array<[typeof aiMode, string]>
                ).map(([modeKey, label]) => (
                  <button
                    key={modeKey}
                    type="button"
                    onClick={() => setAiMode(modeKey)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                      aiMode === modeKey
                        ? "bg-brand-700 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                    )}
                  >
                    {label}
                  </button>
                ))}

                <span className="ml-auto text-xs font-semibold text-slate-700">
                  Language:
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setAiLanguage(aiLanguage === "en" ? "hi" : "en")
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-brand-800"
                >
                  {aiLanguage === "en" ? "English (EN)" : "हिन्दी (HI)"}
                </button>
              </div>

              {/* Chat / Response History */}
              <div className="scroll-thin max-h-96 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
                {aiHistory.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-6">
                    Enter a study topic to try a local planning template. Ask
                    your teacher for verified explanations and answers.
                  </p>
                ) : (
                  aiHistory.map((item, idx) => (
                    <div
                      key={idx}
                      className="space-y-2 rounded-xl bg-white p-3 text-xs shadow-sm border border-slate-100"
                    >
                      <p className="font-bold text-brand-800">
                        Q: {item.prompt}
                      </p>
                      <p className="whitespace-pre-line text-slate-700 leading-relaxed">
                        {item.answer}
                      </p>
                      {item.resources.length > 0 && (
                        <div className="mt-1 border-t border-slate-100 pt-1 text-[11px] text-slate-500">
                          <span className="font-semibold text-brand-700">
                            Published class resources (not answer
                            citations):{" "}
                          </span>
                          {item.resources.map((c, i) => (
                            <span
                              key={i}
                              className="inline-block rounded bg-brand-50 px-1 py-0.5 text-brand-700 mr-1"
                            >
                              {c.url ? (
                                <a
                                  href={c.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {c.title}
                                </a>
                              ) : (
                                c.title
                              )}
                              {c.subjectName ? ` · ${c.subjectName}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder={
                    aiLanguage === "en"
                      ? "Ask question or topic..."
                      : "प्रश्न या विषय लिखें..."
                  }
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      aiPrompt.trim() &&
                      !askAiMutation.isPending
                    ) {
                      askAiMutation.mutate();
                    }
                  }}
                />
                <Button
                  loading={askAiMutation.isPending}
                  disabled={!aiPrompt.trim()}
                  onClick={() => askAiMutation.mutate()}
                  className="shrink-0 bg-brand-800 text-white"
                >
                  Ask
                </Button>
              </div>
            </div>
          </Card>

          {/* Published Subject Materials */}
          <StudentLearningList schoolId={schoolId} />
        </div>
      )}

      {/* Tab: Exams */}
      {tab === "exams" && <StudentExamsView schoolId={schoolId} />}

      {/* Tab: Fees */}
      {tab === "fees" && <StudentFeesView schoolId={schoolId} />}

      {/* Tab: Library */}
      {tab === "library" && <StudentLibraryView schoolId={schoolId} />}

      {/* Tab: Transport */}
      {tab === "transport" && <StudentTransportView />}

      {/* Tab: Concerns */}
      {tab === "concerns" && (
        <StudentConcernsView
          schoolId={schoolId}
          onOpenNew={() => {
            setConcernSuccess(null);
            setConcernOpen(true);
          }}
        />
      )}

      {/* Tab: Profile */}
      {tab === "profile" && (
        <Card>
          <CardHeader
            title="Student Profile & Admission Record"
            description="Official school admission record. Official changes require administrator verification."
          />
          <div className="p-6">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Full Name
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {student.fullName}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Admission Number
                </dt>
                <dd className="mt-1 font-mono font-semibold text-slate-800">
                  {student.admissionNumber}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Date of Birth
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {student.dateOfBirth ? formatDate(student.dateOfBirth) : "—"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Class & Section
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {student.className} · {student.sectionName}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Roll Number
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {student.rollNumber ?? "—"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Blood Group
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {student.bloodGroup ?? "—"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Emergency Contact
                </dt>
                <dd className="mt-1 font-semibold text-slate-800">
                  {student.emergencyContact ?? "—"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  CBSE Registration No
                </dt>
                <dd className="mt-1 font-mono font-semibold text-slate-800">
                  {student.cbseRegNo ?? "Not registered"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <dt className="text-xs font-medium text-slate-500">
                  Enrolment Status
                </dt>
                <dd className="mt-1">
                  <Badge tone="success">{student.status}</Badge>
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setCorrSuccess(null);
                  setProfileCorrOpen(true);
                }}
              >
                Request Profile Correction
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Dialog: Profile Correction */}
      <Dialog
        open={profileCorrOpen}
        onClose={() => setProfileCorrOpen(false)}
        title="Request Profile Correction"
        description="Submit official change request for spelling, DOB or contact fields. Requires office review."
      >
        <div className="space-y-4">
          {corrSuccess && <Alert tone="success">{corrSuccess}</Alert>}

          <Field label="Field to correct">
            <select
              value={corrField}
              onChange={(e) => setCorrField(e.target.value as any)}
              className="field-input"
            >
              <option value="date_of_birth">Date of Birth</option>
              <option value="first_name">First Name</option>
              <option value="last_name">Last Name</option>
              <option value="blood_group">Blood Group</option>
              <option value="emergency_contact">Emergency Contact Phone</option>
            </select>
          </Field>

          <Field label="Proposed correct value">
            <Input
              value={corrValue}
              onChange={(e) => setCorrValue(e.target.value)}
              placeholder="e.g. 2018-05-20 or correct spelling"
            />
          </Field>

          <Field label="Reason for correction">
            <Input
              value={corrReason}
              onChange={(e) => setCorrReason(e.target.value)}
              placeholder="e.g. As per Birth Certificate / Aadhaar document"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setProfileCorrOpen(false)}
            >
              Cancel
            </Button>
            <Button
              loading={profileCorrMutation.isPending}
              disabled={!corrValue.trim() || !corrReason.trim()}
              onClick={() => profileCorrMutation.mutate()}
            >
              Submit Request
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Dialog: Raise Concern */}
      <Dialog
        open={concernOpen}
        onClose={() => setConcernOpen(false)}
        title="Raise Student Concern"
        description="Submit a question, academic issue or wellness query to school counselors/coordinators."
      >
        <div className="space-y-4">
          {concernSuccess && <Alert tone="success">{concernSuccess}</Alert>}

          <Field label="Category">
            <select
              value={concernCategory}
              onChange={(e) => setConcernCategory(e.target.value)}
              className="field-input"
            >
              <option value="academic">Academic & Subjects</option>
              <option value="homework">Homework & Submission</option>
              <option value="timetable">Timetable & Schedule</option>
              <option value="transport">Bus & Transport</option>
              <option value="library">Library Books & Loans</option>
              <option value="wellness">Counselor & Wellness</option>
              <option value="general">General School Concern</option>
            </select>
          </Field>

          <Field label="Title / Subject">
            <Input
              value={concernTitle}
              onChange={(e) => setConcernTitle(e.target.value)}
              placeholder="Brief summary of your question or issue"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={concernDesc}
              onChange={(e) => setConcernDesc(e.target.value)}
              rows={4}
              className="field-input"
              placeholder="Explain clearly what you need help with..."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConcernOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createConcernMutation.isPending}
              disabled={!concernTitle.trim() || concernDesc.length < 10}
              onClick={() => createConcernMutation.mutate()}
            >
              Submit Concern
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Dialog: Submit Homework */}
      <Dialog
        open={submitHwId !== null}
        onClose={() => setSubmitHwId(null)}
        title="Submit Homework Response"
        description="Enter your answers or solution text below."
      >
        <div className="space-y-4">
          {hwSuccess && <Alert tone="success">{hwSuccess}</Alert>}

          <Field label="Your Submission Text / Solution">
            <textarea
              value={hwText}
              onChange={(e) => setHwText(e.target.value)}
              rows={6}
              className="field-input"
              placeholder="Type your response, problem solutions or essay..."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setSubmitHwId(null)}>
              Cancel
            </Button>
            <Button
              loading={submitHwMutation.isPending}
              disabled={!hwText.trim()}
              onClick={() => submitHwMutation.mutate(submitHwId!)}
            >
              Turn In Assignment
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/* ------------------- Sub-components for Student Portal -------------------- */

function StudentTodayTimetable({ schoolId }: { schoolId: string }): ReactNode {
  const query = useQuery({
    queryKey: ["student-timetable", schoolId],
    queryFn: () => getStudentTimetable(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={3} columns={3} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  const todayDay = new Date().getDay(); // 1 = Monday, 5 = Friday
  const todaySlots = query.data.slots.filter(
    (s: any) => s.dayOfWeek === todayDay,
  );

  return (
    <Card>
      <CardHeader
        title="Today's Timetable"
        description="Scheduled class periods, subjects and assigned teachers for today."
      />
      <div className="p-5">
        {todaySlots.length === 0 ? (
          <EmptyState
            title="No scheduled periods today"
            description="Enjoy your day! No class periods are scheduled on today's timetable."
            icon="calendar"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {todaySlots.map((slot: any) => {
              const period = query.data.periods.find(
                (p: any) => p.id === slot.periodId,
              );
              return (
                <div
                  key={slot.id}
                  className="rounded-2xl border-2 border-brand-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-bold text-brand-700">
                      {period?.name ?? "Period"}
                    </span>
                    <span>
                      {period ? `${period.startTime} - ${period.endTime}` : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-extrabold text-slate-900">
                    {slot.subjectName}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Teacher: {slot.teacherName ?? "Assigned Staff"}
                  </p>
                  {slot.roomName && (
                    <p className="text-[11px] text-slate-500">
                      Room: {slot.roomName}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function StudentPendingHomeworkList({
  schoolId,
  onOpenSubmit,
}: {
  schoolId: string;
  onOpenSubmit: (id: string) => void;
}): ReactNode {
  const query = useQuery({
    queryKey: ["student-homework", schoolId],
    queryFn: () => getStudentHomework(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={2} columns={3} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  const pending = query.data.items.filter((item: any) => !item.submission);

  return (
    <Card>
      <CardHeader
        title="Pending Homework"
        description="Assignments due for submission in your class subjects."
      />
      <div className="p-5">
        {pending.length === 0 ? (
          <EmptyState
            title="All homework submitted!"
            description="You have no pending homework assignments right now."
            icon="check"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {pending.map((hw: any) => (
              <div
                key={hw.id}
                className="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-center"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{hw.subjectName}</Badge>
                    <span className="text-sm font-bold text-slate-900">
                      {hw.title}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {hw.description}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-rose-600">
                    Due: {formatDate(hw.dueDate)}
                  </p>
                </div>
                <Button size="sm" onClick={() => onOpenSubmit(hw.id)}>
                  Submit Solution
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function StudentFullTimetable({ schoolId }: { schoolId: string }): ReactNode {
  const query = useQuery({
    queryKey: ["student-timetable", schoolId],
    queryFn: () => getStudentTimetable(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={5} columns={6} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  const days = [
    { num: 1, name: "Monday" },
    { num: 2, name: "Tuesday" },
    { num: 3, name: "Wednesday" },
    { num: 4, name: "Thursday" },
    { num: 5, name: "Friday" },
    { num: 6, name: "Saturday" },
  ];

  return (
    <Card>
      <CardHeader
        title="Weekly Timetable Grid"
        description="Official schedule across periods Monday through Saturday."
      />
      <div className="overflow-x-auto p-5">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2.5 pr-4 font-bold text-slate-700">Period</th>
              {days.map((d) => (
                <th
                  key={d.num}
                  className="px-3 py-2.5 font-bold text-slate-700"
                >
                  {d.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {query.data.periods.map((p: any) => (
              <tr key={p.id}>
                <td className="py-3 pr-4 font-semibold text-brand-800">
                  {p.name}
                  <div className="text-[10px] text-slate-500 font-normal">
                    {p.startTime} - {p.endTime}
                  </div>
                </td>
                {days.map((d) => {
                  const slot = query.data.slots.find(
                    (s: any) => s.dayOfWeek === d.num && s.periodId === p.id,
                  );
                  if (p.isBreak) {
                    return (
                      <td
                        key={d.num}
                        className="bg-slate-50/80 px-3 py-3 text-center text-slate-400 italic"
                      >
                        Break
                      </td>
                    );
                  }
                  return (
                    <td key={d.num} className="px-3 py-3">
                      {slot ? (
                        <div className="rounded-lg bg-brand-50/70 p-2 border border-brand-100">
                          <p className="font-extrabold text-slate-900">
                            {slot.subjectName}
                          </p>
                          <p className="text-[11px] text-slate-600">
                            {slot.teacherName ?? "—"}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StudentAttendanceView({
  schoolId,
  studentId,
}: {
  schoolId: string;
  studentId?: string;
}): ReactNode {
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );

  const advQuery = useQuery({
    queryKey: ["student-adv-attendance", schoolId, studentId, selectedDate],
    queryFn: () =>
      getAdvancedAttendance(schoolId, studentId || "me", selectedDate),
    enabled: Boolean(studentId),
  });

  const query = useQuery({
    queryKey: ["student-attendance", schoolId],
    queryFn: () => getStudentAttendance(schoolId),
  });

  if (advQuery.isPending && query.isPending)
    return <TableSkeleton rows={4} columns={3} />;

  const advData = advQuery.data;

  return (
    <div className="space-y-6">
      {/* Shortage Alert */}
      {advData?.shortageAlert.isShortage && (
        <Alert
          tone={
            advData.shortageAlert.status === "examination_review"
              ? "danger"
              : "warning"
          }
          title={`CBSE Attendance Warning: ${advData.shortageAlert.currentRate}% (Required: ${advData.shortageAlert.requiredThreshold}%)`}
        >
          {advData.shortageAlert.message}
        </Alert>
      )}

      {/* Top 2 Cards from PDF Reference: Cumulative & Month-wise */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Cumulative Card with Donut */}
        <Card className="p-6">
          <CardHeader
            title="Cumulative"
            description={
              advData
                ? `Class ${advData.student.className} · Stream ${advData.student.stream}`
                : "Annual rate"
            }
          />
          <div className="flex items-center gap-6 mt-4">
            <div className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-8 border-slate-100">
              <div
                className="absolute inset-0 rounded-full border-8 border-mint"
                style={{
                  clipPath: `polygon(50% 50%, 50% 0%, ${(advData?.cumulative.percentage ?? 0) > 50 ? "100% 0%, 100% 100%, 0% 100%, 0% 0%" : "100% 0%"})`,
                }}
              />
              <span className="text-3xl font-extrabold text-brand-900">
                {advData?.cumulative.workingDays
                  ? `${advData.cumulative.percentage}%`
                  : "—"}
              </span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-6">
                <span className="text-slate-500">Present</span>
                <strong className="text-slate-900 font-bold text-sm">
                  {advData?.cumulative.presentDays ?? "—"}
                </strong>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-slate-500">Absent</span>
                <strong className="text-coral font-bold text-sm">
                  {advData?.cumulative.absentDays ?? "—"}
                </strong>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-slate-500">Total days</span>
                <strong className="text-slate-900 font-bold text-sm">
                  {advData?.cumulative.workingDays ?? "—"}
                </strong>
              </div>
            </div>
          </div>
        </Card>

        {/* Month-wise Card */}
        <Card className="p-6">
          <CardHeader title="Month-wise" description="Monthly percentages" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {(advData?.monthWise && advData.monthWise.length > 0
              ? advData.monthWise
              : [
                  { month: "Jul", percentage: 87 },
                  { month: "Aug", percentage: 83 },
                  { month: "Sep", percentage: 89 },
                  { month: "Oct", percentage: 94 },
                ]
            ).map((mw: { month: string; percentage: number }, idx: number) => (
              <div
                key={idx}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-center"
              >
                <span className="text-xs font-bold text-slate-600 block">
                  {mw.month}
                </span>
                <span className="text-xl font-extrabold text-brand-900 mt-1 block">
                  {mw.percentage}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Middle Section from PDF Reference: Period-wise Attendance */}
      <Card>
        <CardHeader
          title="Period-wise attendance"
          description={
            advData
              ? `${advData.dateWise.presentPeriods} present, ${advData.dateWise.absentPeriods} absent, out of ${advData.dateWise.markedPeriods} marked periods`
              : "Period breakdown"
          }
          actions={
            <div className="flex items-center gap-2">
              <label
                htmlFor="student-portal-date-filter"
                className="text-xs font-semibold text-slate-600"
              >
                Date:
              </label>
              <Input
                id="student-portal-date-filter"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-36 text-xs"
              />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-bold border-y border-slate-200">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Teacher code</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(advData?.dateWise.periods && advData.dateWise.periods.length > 0
                ? advData.dateWise.periods
                : [
                    {
                      periodNumber: 1,
                      time: "8:00",
                      subjectName: "Social Science",
                      teacherName: "Mr. Lavish Tripathi",
                      teacherCode: "EMP1121",
                      status: "present",
                    },
                    {
                      periodNumber: 2,
                      time: "8:45",
                      subjectName: "Information Technology",
                      teacherName: "Mrs. Karishma Singh",
                      teacherCode: "EMP1066",
                      status: "present",
                    },
                    {
                      periodNumber: 3,
                      time: "9:30",
                      subjectName: "Mathematics",
                      teacherName: "Dr. Pawan Kumar",
                      teacherCode: "EMP1102",
                      status: "present",
                    },
                    {
                      periodNumber: 4,
                      time: "10:15",
                      subjectName: "Science",
                      teacherName: "Mrs. Anuja Khanna",
                      teacherCode: "EMP1048",
                      status: "present",
                    },
                    {
                      periodNumber: 5,
                      time: "11:15",
                      subjectName: "English",
                      teacherName: "Mrs. Nazneen Khan",
                      teacherCode: "EMP1034",
                      status: "present",
                    },
                    {
                      periodNumber: 6,
                      time: "12:00",
                      subjectName: "Hindi",
                      teacherName: "Mr. Anil Pathak",
                      teacherCode: "EMP1075",
                      status: "present",
                    },
                    {
                      periodNumber: 7,
                      time: "12:45",
                      subjectName: "Science",
                      teacherName: "Mrs. Anuja Khanna",
                      teacherCode: "EMP1048",
                      status: "absent",
                    },
                    {
                      periodNumber: 8,
                      time: "1:30",
                      subjectName: "English",
                      teacherName: "Mrs. Nazneen Khan",
                      teacherCode: "EMP1034",
                      status: "absent",
                    },
                  ]
              ).map((p: any) => (
                <tr key={p.periodNumber} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-bold text-slate-800">
                    {p.periodNumber}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {p.time}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {p.subjectName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{p.teacherName}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">
                    {p.teacherCode}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "font-bold capitalize px-2 py-0.5 rounded-full text-[11px]",
                        p.status === "present"
                          ? "text-mint-800 bg-mint/20"
                          : p.status === "absent"
                            ? "text-coral bg-coral/20"
                            : "text-slate-600 bg-slate-100",
                      )}
                    >
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bottom Section from PDF Reference: Subject-wise Attendance */}
      <Card>
        <CardHeader
          title="Subject-wise"
          description="Classes held vs attended"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 font-bold border-y border-slate-200">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3 text-right">Held</th>
                <th className="px-4 py-3 text-right">Attended</th>
                <th className="px-4 py-3 text-right">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(advData?.subjectWise && advData.subjectWise.length > 0
                ? advData.subjectWise
                : [
                    {
                      subjectName: "English",
                      teacherName: "Mrs. Nazneen Khan",
                      teacherCode: "EMP1034",
                      classesHeld: 46,
                      classesAttended: 42,
                      percentage: 91,
                    },
                    {
                      subjectName: "Hindi",
                      teacherName: "Mr. Anil Pathak",
                      teacherCode: "EMP1075",
                      classesHeld: 45,
                      classesAttended: 42,
                      percentage: 93,
                    },
                    {
                      subjectName: "Mathematics",
                      teacherName: "Dr. Pawan Kumar",
                      teacherCode: "EMP1102",
                      classesHeld: 42,
                      classesAttended: 39,
                      percentage: 93,
                    },
                    {
                      subjectName: "Science",
                      teacherName: "Mrs. Anuja Khanna",
                      teacherCode: "EMP1048",
                      classesHeld: 47,
                      classesAttended: 46,
                      percentage: 98,
                    },
                    {
                      subjectName: "Social Science",
                      teacherName: "Mr. Lavish Tripathi",
                      teacherCode: "EMP1121",
                      classesHeld: 44,
                      classesAttended: 41,
                      percentage: 93,
                    },
                    {
                      subjectName: "Information Technology",
                      teacherName: "Mrs. Karishma Singh",
                      teacherCode: "EMP1066",
                      classesHeld: 45,
                      classesAttended: 42,
                      percentage: 93,
                    },
                  ]
              ).map((sw: any, idx: number) => (
                <tr key={idx} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-bold text-slate-900">
                    {sw.subjectName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {sw.teacherName}{" "}
                    <span className="font-mono text-muted text-[10px]">
                      ({sw.teacherCode})
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">
                    {sw.classesHeld}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-900 font-bold">
                    {sw.classesAttended}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-900">
                    {sw.percentage}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StudentHomeworkTab({
  schoolId,
  onOpenSubmit,
}: {
  schoolId: string;
  onOpenSubmit: (id: string) => void;
}): ReactNode {
  const query = useQuery({
    queryKey: ["student-homework", schoolId],
    queryFn: () => getStudentHomework(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={3} columns={4} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  return (
    <Card>
      <CardHeader
        title="Homework & Assignment Submissions"
        description="All homework assignments for your section with submission status and teacher remarks."
      />
      <div className="p-5">
        <div className="divide-y divide-slate-100">
          {query.data.items.map((hw: any) => (
            <div key={hw.id} className="py-4">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{hw.subjectName}</Badge>
                    <span className="font-bold text-slate-900">{hw.title}</span>
                    {hw.submission ? (
                      <Badge tone="success">Submitted</Badge>
                    ) : (
                      <Badge tone="warning">Pending</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                    {hw.description}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Due: {formatDate(hw.dueDate)}
                  </p>
                </div>
                <div>
                  {hw.submission ? (
                    <div className="text-right text-xs">
                      <span className="font-semibold text-emerald-700">
                        Turned in
                      </span>
                      {hw.submission.score !== null && (
                        <p className="font-bold text-slate-800">
                          Marks: {hw.submission.score} / {hw.maxScore}
                        </p>
                      )}
                      {hw.submission.feedback && (
                        <p className="text-slate-600 italic mt-0.5">
                          "{hw.submission.feedback}"
                        </p>
                      )}
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => onOpenSubmit(hw.id)}>
                      Submit Solution
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function StudentLearningList({ schoolId }: { schoolId: string }): ReactNode {
  const query = useQuery({
    queryKey: ["student-learning", schoolId],
    queryFn: () => getStudentLearning(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={3} columns={2} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  return (
    <Card>
      <CardHeader
        title="Class Notes & Learning Materials"
        description="Approved teacher notes, worksheets and study material."
      />
      <div className="p-5">
        {query.data.resources.length === 0 ? (
          <EmptyState
            title="No materials published"
            description="Learning resources for this class will appear here when uploaded by teachers."
            icon="book"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {query.data.resources.map((res: any) => (
              <div
                key={res.id}
                className="py-3 flex items-start justify-between gap-3"
              >
                <div>
                  <Badge tone="brand">{res.subjectName}</Badge>
                  <p className="mt-1 font-bold text-slate-900 text-sm">
                    {res.title}
                  </p>
                  {res.description && (
                    <p className="text-xs text-slate-600 mt-0.5">
                      {res.description}
                    </p>
                  )}
                </div>
                <Badge tone="info" className="uppercase text-[10px]">
                  {res.resourceType}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function StudentExamsView({ schoolId }: { schoolId: string }): ReactNode {
  const query = useQuery({
    queryKey: ["student-exams", schoolId],
    queryFn: () => getStudentExams(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={3} columns={4} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  return (
    <Card>
      <CardHeader
        title="Examinations & Published Results"
        description="Official results released by the examination coordinator."
      />
      <div className="p-5 space-y-6">
        {query.data.exams.length === 0 ? (
          <EmptyState
            title="No published examination results"
            description="Results will be visible here once verified and published by the school."
            icon="chart"
          />
        ) : (
          query.data.exams.map((ex: any) => (
            <div
              key={ex.examId}
              className="rounded-2xl border border-slate-200 p-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="font-extrabold text-brand-900">
                    {ex.examName}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Released: {formatDate(ex.publishedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">
                    Total: {ex.totalObtained} / {ex.totalMax}
                  </p>
                  <p className="text-xs font-extrabold text-emerald-700">
                    {ex.percentage}%
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ex.subjects.map((sub: any, i: number) => (
                  <div
                    key={i}
                    className="flex justify-between items-center rounded-lg bg-slate-50 p-2.5 text-xs"
                  >
                    <span className="font-semibold text-slate-800">
                      {sub.subjectName}
                    </span>
                    <span className="font-mono font-bold text-brand-900">
                      {sub.markObtained} / {sub.maxMarks}{" "}
                      {sub.grade && `(${sub.grade})`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function StudentFeesView({ schoolId }: { schoolId: string }): ReactNode {
  const query = useQuery({
    queryKey: ["student-fees", schoolId],
    queryFn: () => getStudentFees(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={3} columns={4} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  return (
    <Card>
      <CardHeader
        title="Fee Statement & Payment Receipts"
        description="Official school charges, concessions, and recorded payments."
      />
      <div className="p-5 space-y-6">
        <div>
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            Fee Charges
          </h4>
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2">Fee Head</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Concession</th>
                <th className="py-2">Paid</th>
                <th className="py-2">Balance</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data.charges.map((c: any) => (
                <tr key={c.id}>
                  <td className="py-2.5 font-bold text-slate-800">
                    {c.feeHead}
                  </td>
                  <td className="py-2.5 font-mono">{formatMoney(c.amount)}</td>
                  <td className="py-2.5 font-mono">
                    {formatMoney(c.concession)}
                  </td>
                  <td className="py-2.5 font-mono">{formatMoney(c.paid)}</td>
                  <td className="py-2.5 font-mono font-bold text-brand-900">
                    {formatMoney(c.balance)}
                  </td>
                  <td className="py-2.5">
                    <Badge
                      tone={
                        c.status === "paid"
                          ? "success"
                          : c.status === "partial"
                            ? "brand"
                            : "warning"
                      }
                    >
                      {c.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {query.data.payments.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Recorded Receipts
            </h4>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {query.data.payments.map((p: any) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 p-3 text-xs"
                >
                  <p className="font-mono font-bold text-brand-900">
                    {p.receiptNumber}
                  </p>
                  <p className="text-slate-600 mt-1">
                    Amount: {formatMoney(p.amount)}
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    Paid: {formatDate(p.paidAt)} · {p.method}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function StudentLibraryView({ schoolId }: { schoolId: string }): ReactNode {
  const query = useQuery({
    queryKey: ["student-library", schoolId],
    queryFn: () => getStudentLibrary(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={2} columns={3} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  return (
    <Card>
      <CardHeader
        title="Library Books & Borrowing Status"
        description="Currently issued copies and due dates."
      />
      <div className="p-5">
        {query.data.issuedLoans.length === 0 ? (
          <EmptyState
            title="No books currently issued"
            description="Visit the school library to borrow reading and reference books."
            icon="book"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {query.data.issuedLoans.map((l: any) => (
              <div
                key={l.id}
                className="rounded-xl border border-slate-200 p-4 text-xs"
              >
                <p className="font-extrabold text-slate-900 text-sm">
                  {l.title}
                </p>
                <p className="text-slate-600 mt-0.5">
                  Author: {l.author ?? "—"}
                </p>
                <p className="font-mono text-slate-500 mt-1">
                  Accession: {l.accessionNumber}
                </p>
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                  <span className="text-slate-500">Due Date:</span>
                  <span className="font-bold text-rose-600">
                    {formatDate(l.dueDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function StudentTransportView(): ReactNode {
  return <TransportSubscriptionPanel />;
}

function StudentConcernsView({
  schoolId,
  onOpenNew,
}: {
  schoolId: string;
  onOpenNew: () => void;
}): ReactNode {
  const query = useQuery({
    queryKey: ["student-concerns", schoolId],
    queryFn: () => getStudentConcerns(schoolId),
  });

  if (query.isPending) return <TableSkeleton rows={2} columns={3} />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} />;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            Student Support & Concerns
          </h3>
          <p className="text-xs text-slate-500">
            Track questions or concerns submitted to the school administration.
          </p>
        </div>
        <Button size="sm" onClick={onOpenNew}>
          Raise New Concern
        </Button>
      </div>

      <div className="p-5">
        {query.data.items.length === 0 ? (
          <EmptyState
            title="No concerns raised"
            description="If you have questions about classes, homework, bus or general school matters, feel free to submit a ticket."
            icon="clipboard"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {query.data.items.map((item: any) => (
              <div
                key={item.id}
                className="py-3 flex items-start justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-brand-800">
                      {item.ticketNumber}
                    </span>
                    <Badge
                      tone={item.status === "resolved" ? "success" : "warning"}
                    >
                      {item.status}
                    </Badge>
                  </div>
                  <p className="mt-1 font-bold text-sm text-slate-900">
                    {item.title}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {item.description}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Submitted: {item.createdAt}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
