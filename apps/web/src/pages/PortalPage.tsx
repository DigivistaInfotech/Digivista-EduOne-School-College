import { TransportSubscriptionPanel } from "../components/TransportSubscriptionPanel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import {
  getChildDashboard,
  getChildLeaveRequests,
  getChildPickupAuthorisations,
  getAdvancedAttendance,
  listChildren,
  markParentMessageRead,
  submitChildLeaveRequest,
  submitChildOfflinePayment,
  submitChildPickupAuthorisation,
  revokeChildPickupAuthorisation,
  submitChildDocumentConsent,
  updateChildTransportAlerts,
  createStudentConcern,
} from "../lib/endpoints";
import { errorMessage } from "../lib/api";
import { formatDate, formatMoney, todayIso } from "../lib/format";
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
  PageHeader,
  Sparkle,
  StatCard,
  TableSkeleton,
  cn,
} from "../components/ui";

type ParentPortalTab =
  | "dashboard"
  | "children"
  | "fees"
  | "attendance"
  | "homework"
  | "results"
  | "transport"
  | "messages"
  | "documents"
  | "support";

export function PortalPage(): ReactNode {
  const schoolId = useSchoolId();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<ParentPortalTab>("dashboard");
  const [selectedChildId, setSelectedChildId] = useState("");

  // 1. Fetch linked children
  const childrenQuery = useQuery({
    queryKey: ["portal-children", schoolId],
    queryFn: () => listChildren(schoolId),
  });

  const children = childrenQuery.data?.items ?? [];

  useEffect(() => {
    if (
      children.length > 0 &&
      !children.some((c) => c.studentId === selectedChildId)
    ) {
      setSelectedChildId(children[0]!.studentId);
    }
  }, [children, selectedChildId]);

  const activeChild = children.find((c) => c.studentId === selectedChildId);
  const activeChildName = activeChild?.fullName || activeChild?.name || "Child";

  // 2. Fetch active child dashboard
  const dashboardQuery = useQuery({
    queryKey: ["portal-child-dashboard", schoolId, selectedChildId],
    queryFn: () => getChildDashboard(schoolId, selectedChildId),
    enabled: Boolean(selectedChildId),
  });

  // 3. Fetch Advanced Attendance for active child
  const [attDate, setAttDate] = useState<string>(todayIso());
  const advAttQuery = useQuery({
    queryKey: [
      "portal-child-adv-attendance",
      schoolId,
      selectedChildId,
      attDate,
    ],
    queryFn: () => getAdvancedAttendance(schoolId, selectedChildId, attDate),
    enabled:
      Boolean(selectedChildId) &&
      (activeTab === "attendance" || activeTab === "dashboard"),
  });

  // 4. Leave requests
  const leaveQuery = useQuery({
    queryKey: ["portal-child-leave", schoolId, selectedChildId],
    queryFn: () => getChildLeaveRequests(schoolId, selectedChildId),
    enabled: Boolean(selectedChildId),
  });

  // 5. Pickup authorisations
  const pickupQuery = useQuery({
    queryKey: ["portal-child-pickup", schoolId, selectedChildId],
    queryFn: () => getChildPickupAuthorisations(schoolId, selectedChildId),
    enabled: Boolean(selectedChildId),
  });

  // Dialog states
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveStart, setLeaveStart] = useState(todayIso());
  const [leaveEnd, setLeaveEnd] = useState(todayIso());
  const [leaveCategory, setLeaveCategory] = useState<
    | "medical"
    | "personal"
    | "family_function"
    | "emergency"
    | "travel"
    | "other"
  >("medical");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveSuccessMsg, setLeaveSuccessMsg] = useState<string | null>(null);

  const [pickupModalOpen, setPickupModalOpen] = useState(false);
  const [pickupName, setPickupName] = useState("");
  const [pickupRel, setPickupRel] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [pickupProofType, setPickupProofType] = useState<
    "Aadhaar" | "PAN" | "Voter_ID" | "Driving_License" | "Passport" | "Other"
  >("Aadhaar");
  const [pickupProofNum, setPickupProofNum] = useState("");
  const [pickupEmergencyOnly, setPickupEmergencyOnly] = useState(false);
  const [pickupSuccessMsg, setPickupSuccessMsg] = useState<string | null>(null);

  const [offlineFeeOpen, setOfflineFeeOpen] = useState(false);
  const [offlineAmount, setOfflineAmount] = useState("6500");
  const [offlineMethod, setOfflineMethod] = useState<
    "bank_transfer" | "upi" | "cheque" | "cash" | "demand_draft"
  >("upi");
  const [offlineRef, setOfflineRef] = useState("");
  const [offlineBank, setOfflineBank] = useState("HDFC Bank");
  const [offlineDate, setOfflineDate] = useState(todayIso());
  const [offlineNotes, setOfflineNotes] = useState("");
  const [offlineSuccessMsg, setOfflineSuccessMsg] = useState<string | null>(
    null,
  );

  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [supportCategory, setSupportCategory] = useState("academic");
  const [supportTitle, setSupportTitle] = useState("");
  const [supportDesc, setSupportDesc] = useState("");
  const [supportSuccessMsg, setSupportSuccessMsg] = useState<string | null>(
    null,
  );

  // Mutations
  const leaveMutation = useMutation({
    mutationFn: () =>
      submitChildLeaveRequest(schoolId, selectedChildId, {
        startsOn: leaveStart,
        endsOn: leaveEnd,
        reasonCategory: leaveCategory,
        reasonText: leaveReason,
      }),
    onSuccess: (data) => {
      setLeaveSuccessMsg(data.message || "Leave request submitted.");
      setLeaveReason("");
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-leave", schoolId, selectedChildId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-dashboard", schoolId, selectedChildId],
      });
      setTimeout(() => {
        setLeaveSuccessMsg(null);
        setLeaveModalOpen(false);
      }, 2000);
    },
  });

  const pickupMutation = useMutation({
    mutationFn: () =>
      submitChildPickupAuthorisation(schoolId, selectedChildId, {
        authorisedPersonName: pickupName,
        relationship: pickupRel,
        phone: pickupPhone,
        idProofType: pickupProofType,
        idProofNumber: pickupProofNum || undefined,
        emergencyOnly: pickupEmergencyOnly,
      }),
    onSuccess: (data) => {
      setPickupSuccessMsg(
        data.message || "Authorised pickup person registered.",
      );
      setPickupName("");
      setPickupRel("");
      setPickupPhone("");
      setPickupProofNum("");
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-pickup", schoolId, selectedChildId],
      });
      setTimeout(() => {
        setPickupSuccessMsg(null);
        setPickupModalOpen(false);
      }, 2000);
    },
  });

  const revokePickupMutation = useMutation({
    mutationFn: (authId: string) =>
      revokeChildPickupAuthorisation(schoolId, selectedChildId, authId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-pickup", schoolId, selectedChildId],
      });
    },
  });

  const offlineFeeMutation = useMutation({
    mutationFn: () =>
      submitChildOfflinePayment(schoolId, selectedChildId, {
        amount: parseFloat(offlineAmount),
        paymentMethod: offlineMethod,
        referenceNumber: offlineRef || `UPI-${Date.now().toString().slice(-8)}`,
        paymentDate: offlineDate,
        bankName: offlineBank,
        notes: offlineNotes,
      }),
    onSuccess: (data) => {
      setOfflineSuccessMsg(
        data.message || "Offline payment submitted for cashier verification.",
      );
      setOfflineRef("");
      setOfflineNotes("");
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-dashboard", schoolId, selectedChildId],
      });
      setTimeout(() => {
        setOfflineSuccessMsg(null);
        setOfflineFeeOpen(false);
      }, 2000);
    },
  });

  const docConsentMutation = useMutation({
    mutationFn: (docId: string) =>
      submitChildDocumentConsent(schoolId, selectedChildId, docId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-dashboard", schoolId, selectedChildId],
      });
    },
  });

  const alertTogglesMutation = useMutation({
    mutationFn: (alerts: {
      busApproaching?: boolean;
      boarding?: boolean;
      dropOff?: boolean;
      delays?: boolean;
    }) => updateChildTransportAlerts(schoolId, selectedChildId, alerts),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-dashboard", schoolId, selectedChildId],
      });
    },
  });

  const supportMutation = useMutation({
    mutationFn: () =>
      createStudentConcern(schoolId, {
        category: supportCategory,
        title: supportTitle,
        description: supportDesc,
      }),
    onSuccess: () => {
      setSupportSuccessMsg("Support query submitted to school administration.");
      setSupportTitle("");
      setSupportDesc("");
      setTimeout(() => {
        setSupportSuccessMsg(null);
        setSupportModalOpen(false);
      }, 2000);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (msgId: string) => markParentMessageRead(schoolId, msgId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["portal-child-dashboard", schoolId, selectedChildId],
      });
    },
  });

  if (childrenQuery.isPending) {
    return (
      <div className="space-y-6">
        <TableSkeleton rows={4} columns={3} />
      </div>
    );
  }

  if (childrenQuery.isError) {
    return (
      <ErrorState
        message={errorMessage(childrenQuery.error)}
        onRetry={() => void childrenQuery.refetch()}
      />
    );
  }

  if (children.length === 0) {
    return (
      <Card className="p-8 text-center">
        <EmptyState
          title="No linked children found"
          description="Your account is verified, but no active student records are linked to your guardian profile. Please contact the school admissions office."
          icon="child"
        />
      </Card>
    );
  }

  const data = dashboardQuery.data;

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Branding */}
      <div className="flex flex-col gap-4 border-b border-ink/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-900 text-white shadow-sm">
              <Icon name="book" className="h-5 w-5 text-sun" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
                Parent Portal
              </h1>
              <p className="text-xs font-semibold text-muted tracking-wide uppercase">
                Udaan Valley International School (Demo) · Learn · Belong ·
                Flourish
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/20 px-3 py-1 text-xs font-bold text-ink">
            <span className="h-2 w-2 rounded-full bg-mint animate-pulse" />
            AY 2026–27
          </span>
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm border border-slate-200">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sun text-ink font-bold text-xs">
              {user?.displayName
                ? user.displayName.slice(0, 2).toUpperCase()
                : "PS"}
            </span>
            <span>{user?.displayName ?? "Priya Sharma (Parent)"}</span>
          </div>
        </div>
      </div>

      {/* 2. Multiple Children Selector Bar (Matching Screenshot) */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold text-muted uppercase tracking-wider">
          Select Child:
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {children.map((child, idx) => {
            const isSelected = child.studentId === selectedChildId;
            return (
              <button
                key={child.studentId}
                type="button"
                onClick={() => setSelectedChildId(child.studentId)}
                className={cn(
                  "group flex items-center gap-3.5 rounded-2xl border-2 px-4 py-3 text-left transition-all duration-200 shadow-sm cursor-pointer",
                  isSelected
                    ? "border-brand-900 bg-white ring-2 ring-brand-900/10 shadow-md"
                    : "border-slate-200 bg-slate-50/70 hover:bg-white hover:border-slate-300",
                )}
              >
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-bold text-sm shadow-inner",
                    idx % 2 === 0
                      ? "bg-sky/30 text-brand-900"
                      : "bg-coral/30 text-brand-900",
                  )}
                >
                  <Icon name="child" className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-slate-900 text-sm group-hover:text-brand-900 truncate">
                      {child.fullName || child.name || "Student"}
                    </p>
                    <span className="text-xs text-muted">·</span>
                    <span className="text-xs font-semibold text-slate-700">
                      {child.className}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    Admission No. {child.admissionNumber || "Not recorded"}
                  </p>
                </div>
                <div className="ml-2 text-slate-400 group-hover:text-brand-900">
                  <Icon name="chevronRight" className="h-4 w-4" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Welcome Banner (Matching Screenshot) */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-ink/10 bg-brand-900 p-6 text-white shadow-md sm:p-7">
        <span className="blob -top-8 right-8 h-36 w-36 animate-float bg-coral/50" />
        <span className="blob -right-4 bottom-0 h-40 w-40 animate-float bg-sun/40 [animation-delay:-3s]" />
        <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="max-w-xl">
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-extrabold tracking-widest text-sun uppercase">
              <Sparkle className="h-3.5 w-3.5 animate-wiggle" /> Good day,{" "}
              {user?.displayName.split(" ")[0] ?? "Parent"}
            </p>
            <h2 className="text-2xl font-bold sm:text-4xl">
              Your children&apos;s school day,{" "}
              <span className="text-sun">in one place.</span>
            </h2>
            <p className="mt-2 text-sm text-white/80">
              Viewing live academic progress, bus safety, attendance, and fee
              status for{" "}
              <strong className="text-white font-bold">
                {activeChildName}
              </strong>{" "}
              ({activeChild?.className}).
            </p>
          </div>
          <div className="hidden lg:flex flex-col items-center justify-center rounded-2xl bg-white/10 px-6 py-4 backdrop-blur-sm border border-white/10 text-center">
            <span className="text-xs font-extrabold tracking-widest text-[#087F83] uppercase">
              DIGI
            </span>
            <span className="mt-1 text-sm font-bold text-white">
              LEARN · BELONG · FLOURISH
            </span>
            <span className="mt-0.5 text-[11px] text-white/70">
              Nursery to XII · 1,200+ students
            </span>
          </div>
        </div>
      </div>

      {/* 4. Parent Navigation Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
        {[
          { id: "dashboard", label: "Dashboard", icon: "dashboard" },
          { id: "attendance", label: "Attendance", icon: "check" },
          { id: "fees", label: "Fees & Payments", icon: "clipboard" },
          { id: "homework", label: "Homework", icon: "book" },
          { id: "results", label: "Results & Progress", icon: "chart" },
          { id: "transport", label: "Transport", icon: "calendar" },
          { id: "messages", label: "Messages", icon: "paperclip" },
          { id: "documents", label: "Documents", icon: "layers" },
          { id: "support", label: "Support & Concerns", icon: "alert" },
        ].map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setActiveTab(tabItem.id as ParentPortalTab)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all cursor-pointer",
              activeTab === tabItem.id
                ? "bg-sun text-brand-900 shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon name={tabItem.icon as any} className="h-4 w-4" />
            {tabItem.label}
          </button>
        ))}
      </div>

      {/* 5. Four Top Summary Cards (Matching Screenshot) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveTab("attendance")}
          className="text-left w-full group cursor-pointer"
        >
          <StatCard
            label="Attendance"
            value={`${data?.attendance?.overallPercentage ?? 92}%`}
            hint="(This term)"
            icon="check"
            color={0}
          />
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("homework")}
          className="text-left w-full group cursor-pointer"
        >
          <StatCard
            label="Homework"
            value={`${data?.homework?.pendingCount ?? 2} pending`}
            hint="Across subjects"
            icon="book"
            color={1}
          />
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("fees")}
          className="text-left w-full group cursor-pointer"
        >
          <StatCard
            label="Fees due"
            value={formatMoney(data?.fees?.totalDue ?? 6500)}
            hint={`Due ${formatDate(data?.fees?.dueDate ?? "2026-11-10")}`}
            icon="clipboard"
            color={2}
          />
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("messages")}
          className="text-left w-full group cursor-pointer"
        >
          <StatCard
            label="Next PTM"
            value="14 Nov"
            hint="09:00 AM - 12:00 PM"
            icon="calendar"
            color={3}
          />
        </button>
      </div>

      {activeTab === "transport" && selectedChildId && (
        <TransportSubscriptionPanel
          key={selectedChildId}
          studentId={selectedChildId}
        />
      )}

      {/* TAB 1: MAIN DASHBOARD VIEW (Matching 2-Column Screenshot Layout) */}
      {activeTab === "dashboard" && data && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* LEFT COLUMN */}
            <div className="space-y-6">
              {/* Card 1: Fees & Payments */}
              <Card>
                <CardHeader
                  title="Fees & Payments"
                  description={`Academic dues for ${activeChildName}`}
                  actions={
                    <button
                      type="button"
                      onClick={() => setActiveTab("fees")}
                      className="text-xs font-bold text-coral hover:underline cursor-pointer"
                    >
                      View all payments →
                    </button>
                  }
                />
                <div className="p-5 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2 border-b border-slate-100 pb-4">
                    <div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Total Due
                      </span>
                      <p className="text-3xl font-extrabold text-coral mt-0.5">
                        {formatMoney(data.fees.totalDue)}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Due on {formatDate(data.fees.dueDate)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-slate-500">
                        Breakdown:
                      </span>
                      <p className="text-xs text-slate-700">
                        Tuition fees:{" "}
                        <strong className="font-bold">
                          {formatMoney(data.fees.breakdown.tuition)}
                        </strong>
                      </p>
                      <p className="text-xs text-slate-700">
                        Transport fees:{" "}
                        <strong className="font-bold">
                          {formatMoney(data.fees.breakdown.transport)}
                        </strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      onClick={() => {
                        setOfflineFeeOpen(true);
                      }}
                    >
                      <Icon name="check" className="h-4 w-4" />
                      Record Offline Payment
                    </Button>
                    <a
                      href={`/api/schools/${schoolId}/portal/children/${selectedChildId}/invoice`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="secondary">
                        <Icon name="download" className="h-4 w-4" />
                        Download Invoice
                      </Button>
                    </a>
                  </div>

                  {/* UPI / Pay Online Preview */}
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold text-[#182944] uppercase">
                          Payee: Udaan Valley International School (Demo)
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 font-mono">
                          UPI ID: asterleaf.school@icici
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Finance-approved payee + merchant UPI mapping [Page 14
                          Blueprint].
                        </p>
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="h-20 w-20 rounded-xl bg-white p-2 border border-slate-200 shadow-sm flex items-center justify-center font-bold text-[10px] text-center text-slate-400">
                          SCHOOL QR
                          <br />
                          PREVIEW
                        </div>
                        <span className="text-[9px] font-bold text-muted uppercase mt-1">
                          PREVIEW ONLY
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Recent Payments Table */}
                  <div>
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                      Recent Payments / Receipts
                    </span>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-100">
                          <tr>
                            <th className="px-3 py-2">Date</th>
                            <th className="px-3 py-2">Description</th>
                            <th className="px-3 py-2">Amount</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.fees.recentPayments.map((p, pIdx) => (
                            <tr key={pIdx} className="hover:bg-slate-50/50">
                              <td className="px-3 py-2 text-slate-600">
                                {formatDate(p.date)}
                              </td>
                              <td className="px-3 py-2 font-medium text-slate-900">
                                {p.description}
                              </td>
                              <td className="px-3 py-2 font-bold text-slate-900">
                                {formatMoney(p.amount)}
                              </td>
                              <td className="px-3 py-2">
                                <Badge
                                  tone={
                                    p.status === "Verified" ? "mint" : "sun"
                                  }
                                >
                                  {p.status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-muted italic mt-2">
                      Confirmed only after provider/bank confirmation or
                      authorised school verification.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Card 2: Today at school */}
              <Card>
                <CardHeader
                  title="Today at school"
                  description="Live daily snapshot"
                  actions={
                    <button
                      type="button"
                      onClick={() => setActiveTab("attendance")}
                      className="text-xs font-bold text-coral hover:underline cursor-pointer"
                    >
                      View full day →
                    </button>
                  }
                />
                <div className="p-5 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-mint/30 bg-mint/10 p-3.5">
                    <span className="text-[11px] font-bold text-slate-600 uppercase">
                      Attendance
                    </span>
                    <p className="text-lg font-bold text-mint-800 capitalize mt-1">
                      {data.attendance.statusToday}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Marked at {data.attendance.markedAt}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-sun/30 bg-sun/10 p-3.5">
                    <span className="text-[11px] font-bold text-slate-600 uppercase">
                      Homework
                    </span>
                    <p className="text-lg font-bold text-brand-900 mt-1">
                      {data.homework.pendingCount} pending
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      Across assigned subjects
                    </p>
                  </div>
                  <div className="rounded-2xl border border-sky/30 bg-sky/10 p-3.5">
                    <span className="text-[11px] font-bold text-slate-600 uppercase">
                      Next class
                    </span>
                    <p className="text-base font-bold text-slate-900 mt-1 truncate">
                      {data.nextClass?.subjectName ?? "Mathematics"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {data.nextClass?.timing} · {data.nextClass?.room}
                    </p>
                  </div>
                </div>
              </Card>

              {/* Card 3: Academic Progress & Report Cards */}
              <Card>
                <CardHeader
                  title="Progress & Report Cards"
                  description="Term assessment results"
                  actions={
                    <button
                      type="button"
                      onClick={() => setActiveTab("results")}
                      className="text-xs font-bold text-coral hover:underline cursor-pointer"
                    >
                      View all →
                    </button>
                  }
                />
                <div className="p-5 space-y-4">
                  <div className="space-y-3">
                    {data.academicProgress.subjects.map((subj, sIdx) => (
                      <div key={sIdx} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                          <span>{subj.name}</span>
                          <span className="font-mono text-slate-600">
                            {subj.percentage}% · Grade {subj.grade}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-300",
                              sIdx === 0
                                ? "bg-sky"
                                : sIdx === 1
                                  ? "bg-coral"
                                  : sIdx === 2
                                    ? "bg-mint"
                                    : "bg-sun",
                            )}
                            style={{ width: `${subj.percentage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <a
                      href={`/api/schools/${schoolId}/portal/children/${selectedChildId}/transcript/print`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-coral hover:underline"
                    >
                      Download latest report card →
                    </a>
                  </div>
                </div>
              </Card>
            </div>

            {/* RIGHT COLUMN */}
            <div className="space-y-6">
              {/* Card 4: School Bus & Safety (Matching Screenshot) */}
              <Card>
                <CardHeader
                  title="School Bus & Safety"
                  description="Fleet tracking & stop schedule"
                  actions={
                    <Badge tone="sun">{data.transport.gpsStatusLabel}</Badge>
                  }
                />
                <div className="p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <p className="font-extrabold text-slate-900 text-sm">
                        {data.transport.routeName}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Vehicle:{" "}
                        <strong className="font-bold text-brand-900">
                          {data.transport.vehicleNumber}
                        </strong>{" "}
                        · Stop: <strong>{data.transport.stopName}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-600">
                      <div>
                        Pickup:{" "}
                        <strong className="font-bold text-slate-900">
                          {data.transport.pickupTime}
                        </strong>
                      </div>
                      <div>
                        Drop:{" "}
                        <strong className="font-bold text-slate-900">
                          {data.transport.dropTime}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Route Timeline */}
                  <div>
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
                      Route Stops Timeline
                    </span>
                    <ol className="relative border-l-2 border-slate-200 ml-3 space-y-3">
                      {data.transport.routeTimeline.map((stopItem, stopIdx) => (
                        <li key={stopIdx} className="ml-4">
                          <span
                            className={cn(
                              "absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white",
                              stopItem.isChildStop
                                ? "bg-coral ring-2 ring-coral/30"
                                : "bg-slate-400",
                            )}
                          />
                          <div className="flex items-center justify-between text-xs">
                            <span
                              className={cn(
                                "font-medium",
                                stopItem.isChildStop
                                  ? "font-bold text-coral"
                                  : "text-slate-800",
                              )}
                            >
                              {stopItem.name}
                            </span>
                            <span className="font-mono text-slate-500">
                              {stopItem.time}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {/* Transport Alerts Toggle */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                    <span className="text-xs font-bold text-slate-800 block">
                      Alerts for {activeChildName}
                    </span>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {[
                        {
                          key: "busApproaching",
                          label: "Bus approaching",
                          value: data.transport.alerts.busApproaching,
                        },
                        {
                          key: "boarding",
                          label: "Boarding",
                          value: data.transport.alerts.boarding,
                        },
                        {
                          key: "dropOff",
                          label: "Drop-off",
                          value: data.transport.alerts.dropOff,
                        },
                        {
                          key: "delays",
                          label: "Delays",
                          value: data.transport.alerts.delays,
                        },
                      ].map((pref) => (
                        <label
                          key={pref.key}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={pref.value}
                            onChange={(e) => {
                              void alertTogglesMutation.mutate({
                                [pref.key]: e.target.checked,
                              });
                            }}
                            className="rounded border-slate-300 text-coral focus:ring-coral"
                          />
                          <span className="text-slate-700 font-medium">
                            {pref.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Card 5: Messages & Notices */}
              <Card>
                <CardHeader
                  title="Messages & Notices"
                  description="Direct communication from school"
                  actions={
                    <button
                      type="button"
                      onClick={() => setActiveTab("messages")}
                      className="text-xs font-bold text-coral hover:underline cursor-pointer"
                    >
                      View all →
                    </button>
                  }
                />
                <div className="divide-y divide-slate-100">
                  {data.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className="p-4 flex gap-3 hover:bg-slate-50/50"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sun/40 text-brand-900 font-bold text-xs">
                        {msg.senderRole === "teacher" ? "AT" : "SC"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-slate-900">
                            {msg.senderName}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted">
                              {formatDate(msg.createdAt)}
                            </span>
                            {!msg.isRead && (
                              <button
                                type="button"
                                onClick={() =>
                                  void markReadMutation.mutate(msg.id)
                                }
                                className="text-[10px] font-bold text-coral hover:underline"
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-xs font-bold text-slate-800 mt-0.5">
                          {msg.title}
                        </p>
                        <p className="text-xs text-slate-600 mt-1">
                          {msg.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Card 6: Leave & Pickup Requests */}
              <Card>
                <CardHeader
                  title="Leave & Pickup Requests"
                  description="Absence planning & guardian authorisation"
                />
                <div className="p-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setLeaveModalOpen(true)}
                    className="flex flex-col items-start gap-1 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left transition hover:border-coral hover:bg-coral/5 cursor-pointer shadow-sm"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-coral/20 text-coral font-bold">
                      <Icon name="calendar" className="h-4 w-4" />
                    </span>
                    <span className="font-bold text-xs text-slate-900 mt-1">
                      Request leave
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Plan medical or personal leave
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPickupModalOpen(true)}
                    className="flex flex-col items-start gap-1 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left transition hover:border-mint hover:bg-mint/5 cursor-pointer shadow-sm"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-mint/20 text-mint font-bold">
                      <Icon name="shield" className="h-4 w-4" />
                    </span>
                    <span className="font-bold text-xs text-slate-900 mt-1">
                      Authorised pickup
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Register pickup persons
                    </span>
                  </button>
                </div>
              </Card>

              {/* Card 7: Documents & Consents */}
              <Card>
                <CardHeader
                  title="Documents & Consents"
                  description="School consent forms & medical files"
                />
                <div className="p-5 space-y-3">
                  {data.documents.map((docItem) => (
                    <div
                      key={docItem.id}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {docItem.title}
                        </p>
                        <span className="text-[11px] text-muted capitalize">
                          {docItem.type.replace("_", " ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={docItem.status === "submitted" ? "mint" : "sun"}
                        >
                          {docItem.status}
                        </Badge>
                        {docItem.status === "pending" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void docConsentMutation.mutate(docItem.id)
                            }
                          >
                            Sign
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* Bottom Upcoming Events Banner */}
          <Card className="p-5 bg-gradient-to-r from-brand-900 to-teal-900 text-white rounded-3xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-sun uppercase tracking-wider block">
                  School Calendar
                </span>
                <h3 className="text-lg font-bold mt-0.5">
                  Upcoming Events & Examinations
                </h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                {data.upcomingEvents.map((ev, eIdx) => (
                  <div
                    key={eIdx}
                    className="rounded-xl bg-white/10 p-2.5 backdrop-blur-sm border border-white/10"
                  >
                    <span className="font-bold text-sun block">{ev.date}</span>
                    <span className="font-medium text-white truncate block">
                      {ev.title}
                    </span>
                    <span className="text-[11px] text-white/70 block">
                      {ev.timing}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: ADVANCED ATTENDANCE (Classes 6-12 PDF Specification) */}
      {activeTab === "attendance" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Advanced Attendance Register
              </h2>
              <p className="text-xs text-muted">
                Official CBSE Classes VI–XII cumulative, month-wise,
                period-wise, and subject-wise record.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor="portal-att-date"
                className="text-xs font-semibold text-slate-600"
              >
                Select Date:
              </label>
              <Input
                id="portal-att-date"
                type="date"
                value={attDate}
                onChange={(e) => setAttDate(e.target.value)}
                className="w-40 text-xs"
              />
            </div>
          </div>

          {advAttQuery.isPending ? (
            <TableSkeleton rows={5} columns={4} />
          ) : advAttQuery.isError ? (
            <ErrorState message={errorMessage(advAttQuery.error)} />
          ) : advAttQuery.data ? (
            <div className="space-y-6">
              {/* Shortage Warning Banner if < 80% */}
              {advAttQuery.data.shortageAlert.isShortage && (
                <Alert
                  tone={
                    advAttQuery.data.shortageAlert.status ===
                    "examination_review"
                      ? "danger"
                      : "warning"
                  }
                  title={`CBSE Attendance Notice: ${advAttQuery.data.shortageAlert.currentRate}% (Required: ${advAttQuery.data.shortageAlert.requiredThreshold}%)`}
                >
                  {advAttQuery.data.shortageAlert.message}
                </Alert>
              )}

              {/* Top Row: Cumulative (Donut) & Month-wise Breakdown */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Cumulative Card */}
                <Card className="p-6">
                  <CardHeader
                    title="Cumulative Attendance"
                    description={`AY ${advAttQuery.data.session} · Stream: ${advAttQuery.data.student.stream}`}
                  />
                  <div className="flex items-center gap-6 mt-4">
                    <div className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-8 border-slate-100">
                      <div
                        className="absolute inset-0 rounded-full border-8 border-mint"
                        style={{
                          clipPath: `polygon(50% 50%, 50% 0%, ${advAttQuery.data.cumulative.percentage > 50 ? "100% 0%, 100% 100%, 0% 100%, 0% 0%" : "100% 0%"})`,
                        }}
                      />
                      <span className="text-2xl font-extrabold text-brand-900">
                        {advAttQuery.data.cumulative.percentage}%
                      </span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-500">Present days:</span>
                        <strong className="text-slate-900 font-bold">
                          {advAttQuery.data.cumulative.presentDays}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-500">Absent days:</span>
                        <strong className="text-coral font-bold">
                          {advAttQuery.data.cumulative.absentDays}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-500">
                          Total working days:
                        </span>
                        <strong className="text-slate-900 font-bold">
                          {advAttQuery.data.cumulative.workingDays}
                        </strong>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Month-wise Card */}
                <Card className="p-6">
                  <CardHeader
                    title="Month-wise Attendance"
                    description="Monthly breakdown"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    {advAttQuery.data.monthWise.map((mw, mwIdx) => (
                      <div
                        key={mwIdx}
                        className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-center"
                      >
                        <span className="text-xs font-bold text-slate-600 block">
                          {mw.month}
                        </span>
                        <span className="text-xl font-extrabold text-brand-900 mt-1 block">
                          {mw.percentage}%
                        </span>
                        <span className="text-[10px] text-muted block mt-0.5">
                          {mw.presentDays}/{mw.totalDays} days
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Middle Section: Period-wise Attendance (Exact PDF Table) */}
              <Card>
                <CardHeader
                  title="Period-wise attendance"
                  description={`Date: ${formatDate(advAttQuery.data.dateWise.date)} · ${advAttQuery.data.dateWise.presentPeriods} present, ${advAttQuery.data.dateWise.absentPeriods} absent, out of ${advAttQuery.data.dateWise.markedPeriods} marked periods`}
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
                      {advAttQuery.data.dateWise.periods.map((p) => (
                        <tr
                          key={p.periodNumber}
                          className="hover:bg-slate-50/50"
                        >
                          <td className="px-4 py-3 font-bold text-slate-800">
                            {p.periodNumber}
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-600">
                            {p.time}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {p.subjectName}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {p.teacherName}
                            {p.isSubstitute && (
                              <span className="ml-1 text-[10px] text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded">
                                Sub: {p.substituteTeacherName}
                              </span>
                            )}
                          </td>
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

              {/* Bottom Section: Subject-wise Attendance (Exact PDF Table) */}
              <Card>
                <CardHeader
                  title="Subject-wise attendance"
                  description="Cumulative subject metrics"
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
                      {advAttQuery.data.subjectWise.map((sw, swIdx) => (
                        <tr key={swIdx} className="hover:bg-slate-50/50">
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
                            {sw.classesHeld > 0
                              ? `${sw.percentage}%`
                              : "Not recorded"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : null}
        </div>
      )}

      {/* TAB 3: FEES & PAYMENTS FULL VIEW */}
      {activeTab === "fees" && data && (
        <div className="space-y-6">
          <PageHeader
            title="Fees & Invoices"
            description={`Fee structures, online UPI payment, and offline bank deposit verification for ${activeChildName}`}
            actions={
              <Button onClick={() => setOfflineFeeOpen(true)}>
                <Icon name="plus" className="h-4 w-4" />
                Submit Offline Payment
              </Button>
            }
          />
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="p-5">
              <span className="text-xs font-bold text-muted uppercase">
                Total Due
              </span>
              <p className="text-2xl font-bold text-coral mt-1">
                {formatMoney(data.fees.totalDue)}
              </p>
            </Card>
            <Card className="p-5">
              <span className="text-xs font-bold text-muted uppercase">
                Tuition Fees
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {formatMoney(data.fees.breakdown.tuition)}
              </p>
            </Card>
            <Card className="p-5">
              <span className="text-xs font-bold text-muted uppercase">
                Transport Fees
              </span>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {formatMoney(data.fees.breakdown.transport)}
              </p>
            </Card>
          </div>
          <Card>
            <CardHeader title="Payment History & Receipts" />
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.fees.recentPayments.map((p, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(p.date)}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {p.description}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {formatMoney(p.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={p.status === "Verified" ? "mint" : "sun"}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {p.status === "Verified" ? (
                          <a
                            href={`/api/schools/${schoolId}/portal/children/${selectedChildId}/invoice`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-coral hover:underline"
                          >
                            Download receipt
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 4: HOMEWORK & ACTIVITIES */}
      {activeTab === "homework" && data && (
        <div className="space-y-6">
          <PageHeader
            title="Homework & Assignments"
            description={`Pending tasks and learning assignments for ${activeChildName}`}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {data.homework.items.map((hw) => (
              <Card key={hw.id} className="p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge tone="brand">{hw.subjectName}</Badge>
                  <span className="text-xs text-muted">
                    Due: {formatDate(hw.dueAt)}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900">{hw.title}</h4>
                <p className="text-xs text-slate-600">
                  Pending review by subject teacher.
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: LEAVE & PICKUP REQUESTS FULL VIEW */}
      {activeTab === "support" && (
        <div className="space-y-6">
          <PageHeader
            title="Support, Concerns & Requests"
            description="Raise a query with the school principal, coordinator or transport desk"
            actions={
              <Button onClick={() => setSupportModalOpen(true)}>
                <Icon name="plus" className="h-4 w-4" />
                Submit Concern
              </Button>
            }
          />
          <Card className="p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              Leave & Pastoral Help Desk
            </h3>
            <p className="text-xs text-slate-600 mb-4">
              All submitted concerns are assigned to the responsible department
              head with a defined SLA.
            </p>
            <div className="flex gap-3 mb-6">
              <Button
                variant="secondary"
                onClick={() => setLeaveModalOpen(true)}
              >
                Request Student Leave
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPickupModalOpen(true)}
              >
                Register Authorised Pickup Person
              </Button>
            </div>

            {/* Submitted Leave Requests list */}
            <div className="border-t border-slate-100 pt-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Leave Requests ({leaveQuery.data?.items.length ?? 0})
              </h4>
              {leaveQuery.data?.items && leaveQuery.data.items.length > 0 ? (
                <div className="space-y-2">
                  {leaveQuery.data.items.map((lr) => (
                    <div
                      key={lr.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50/50"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          {formatDate(lr.startsOn)} to {formatDate(lr.endsOn)}
                        </p>
                        <p className="text-[11px] text-slate-500 capitalize">
                          {lr.reasonCategory} · {lr.reasonText}
                        </p>
                      </div>
                      <Badge
                        tone={
                          lr.status === "approved"
                            ? "success"
                            : lr.status === "rejected"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {lr.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No leave requests submitted yet.
                </p>
              )}
            </div>

            {/* Authorised Pickup Persons list */}
            <div className="border-t border-slate-100 pt-5 mt-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Authorised Pickup Persons ({pickupQuery.data?.items.length ?? 0}
                )
              </h4>
              {pickupQuery.data?.items && pickupQuery.data.items.length > 0 ? (
                <div className="space-y-2">
                  {pickupQuery.data.items.map((pa) => (
                    <div
                      key={pa.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50/50"
                    >
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          {pa.authorisedPersonName} ({pa.relationship})
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {pa.phone} · {pa.idProofType}{" "}
                          {pa.idProofNumber ? `(${pa.idProofNumber})` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            pa.status === "approved" ? "success" : "neutral"
                          }
                        >
                          {pa.emergencyOnly ? "Emergency Only" : pa.status}
                        </Badge>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void revokePickupMutation.mutate(pa.id)
                          }
                          disabled={revokePickupMutation.isPending}
                        >
                          Revoke
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No pickup persons registered yet.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* DIALOG 1: SUBMIT LEAVE REQUEST */}
      <Dialog
        open={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        title={`Submit Leave Request for ${activeChildName}`}
      >
        <div className="space-y-4">
          {leaveSuccessMsg && <Alert tone="success">{leaveSuccessMsg}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From Date">
              <Input
                type="date"
                value={leaveStart}
                onChange={(e) => setLeaveStart(e.target.value)}
              />
            </Field>
            <Field label="To Date">
              <Input
                type="date"
                value={leaveEnd}
                onChange={(e) => setLeaveEnd(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Reason Category">
            <select
              value={leaveCategory}
              onChange={(e) => setLeaveCategory(e.target.value as any)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900"
            >
              <option value="medical">Medical illness / rest</option>
              <option value="personal">Personal / Family function</option>
              <option value="emergency">Family emergency</option>
              <option value="travel">Outstation travel</option>
              <option value="other">Other reason</option>
            </select>
          </Field>
          <Field label="Reason Details">
            <textarea
              rows={3}
              value={leaveReason}
              onChange={(e) => setLeaveReason(e.target.value)}
              placeholder="State the reason for absence..."
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setLeaveModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void leaveMutation.mutate()}
              disabled={leaveMutation.isPending || !leaveReason.trim()}
            >
              {leaveMutation.isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* DIALOG 2: REGISTER AUTHORISED PICKUP PERSON */}
      <Dialog
        open={pickupModalOpen}
        onClose={() => setPickupModalOpen(false)}
        title={`Register Authorised Pickup Person for ${activeChildName}`}
      >
        <div className="space-y-4">
          {pickupSuccessMsg && <Alert tone="success">{pickupSuccessMsg}</Alert>}
          <Field label="Full Name">
            <Input
              value={pickupName}
              onChange={(e) => setPickupName(e.target.value)}
              placeholder="e.g. Ramesh Sharma"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Relationship">
              <Input
                value={pickupRel}
                onChange={(e) => setPickupRel(e.target.value)}
                placeholder="e.g. Uncle / Grandfather"
              />
            </Field>
            <Field label="Mobile Phone">
              <Input
                value={pickupPhone}
                onChange={(e) => setPickupPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID Proof Type">
              <select
                value={pickupProofType}
                onChange={(e) => setPickupProofType(e.target.value as any)}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900"
              >
                <option value="Aadhaar">Aadhaar Card</option>
                <option value="PAN">PAN Card</option>
                <option value="Voter_ID">Voter ID</option>
                <option value="Driving_License">Driving License</option>
                <option value="Passport">Passport</option>
              </select>
            </Field>
            <Field label="ID Number">
              <Input
                value={pickupProofNum}
                onChange={(e) => setPickupProofNum(e.target.value)}
                placeholder="e.g. XXXX XXXX 1234"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={pickupEmergencyOnly}
              onChange={(e) => setPickupEmergencyOnly(e.target.checked)}
              className="rounded border-slate-300 text-coral focus:ring-coral"
            />
            <span>Authorised for emergency collection only</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setPickupModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void pickupMutation.mutate()}
              disabled={pickupMutation.isPending || !pickupName || !pickupPhone}
            >
              {pickupMutation.isPending ? "Saving..." : "Register Person"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* DIALOG 3: SUBMIT OFFLINE FEE ACKNOWLEDGEMENT */}
      <Dialog
        open={offlineFeeOpen}
        onClose={() => setOfflineFeeOpen(false)}
        title={`Record Offline Fee Payment for ${activeChildName}`}
      >
        <div className="space-y-4">
          {offlineSuccessMsg && (
            <Alert tone="success">{offlineSuccessMsg}</Alert>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)">
              <Input
                type="number"
                value={offlineAmount}
                onChange={(e) => setOfflineAmount(e.target.value)}
              />
            </Field>
            <Field label="Payment Method">
              <select
                value={offlineMethod}
                onChange={(e) => setOfflineMethod(e.target.value as any)}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900"
              >
                <option value="upi">UPI (GPay, PhonePe, Paytm)</option>
                <option value="bank_transfer">NEFT / RTGS / IMPS</option>
                <option value="cheque">Cheque</option>
                <option value="demand_draft">Demand Draft (DD)</option>
                <option value="cash">Cash (School Counter)</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="UTR / Ref Number">
              <Input
                value={offlineRef}
                onChange={(e) => setOfflineRef(e.target.value)}
                placeholder="e.g. 329182910291"
              />
            </Field>
            <Field label="Bank Name">
              <Input
                value={offlineBank}
                onChange={(e) => setOfflineBank(e.target.value)}
                placeholder="e.g. HDFC Bank"
              />
            </Field>
          </div>
          <Field label="Payment Date">
            <Input
              type="date"
              value={offlineDate}
              onChange={(e) => setOfflineDate(e.target.value)}
            />
          </Field>
          <Field label="Notes / Comments">
            <Input
              value={offlineNotes}
              onChange={(e) => setOfflineNotes(e.target.value)}
              placeholder="e.g. Term 2 fees paid via UPI"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setOfflineFeeOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void offlineFeeMutation.mutate()}
              disabled={offlineFeeMutation.isPending || !offlineAmount}
            >
              {offlineFeeMutation.isPending
                ? "Submitting..."
                : "Submit to Accounts"}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* DIALOG 4: SUBMIT SUPPORT INQUIRY */}
      <Dialog
        open={supportModalOpen}
        onClose={() => setSupportModalOpen(false)}
        title="Submit Concern or Inquiry"
      >
        <div className="space-y-4">
          {supportSuccessMsg && (
            <Alert tone="success">{supportSuccessMsg}</Alert>
          )}
          <Field label="Category">
            <select
              value={supportCategory}
              onChange={(e) => setSupportCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900"
            >
              <option value="academic">Academic & Curriculum</option>
              <option value="transport">School Transport & Bus</option>
              <option value="fees">Fees & Accounts</option>
              <option value="general">General Administration</option>
            </select>
          </Field>
          <Field label="Subject">
            <Input
              value={supportTitle}
              onChange={(e) => setSupportTitle(e.target.value)}
              placeholder="Brief title of concern"
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={4}
              value={supportDesc}
              onChange={(e) => setSupportDesc(e.target.value)}
              placeholder="Describe your query in detail..."
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs text-slate-900"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setSupportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void supportMutation.mutate()}
              disabled={
                supportMutation.isPending ||
                !supportTitle.trim() ||
                !supportDesc.trim()
              }
            >
              {supportMutation.isPending ? "Sending..." : "Submit Inquiry"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
