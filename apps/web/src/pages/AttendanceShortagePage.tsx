import { AttendancePolicyReviews } from "../components/AttendancePolicyReviews";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import {
  decideAttendanceShortage,
  explainAttendanceShortage,
  issueAttendanceWarning,
  listAttendanceShortages,
} from "../lib/endpoints";
import { errorMessage } from "../lib/api";
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
  Input,
  PageHeader,
  TableSkeleton,
} from "../components/ui";

export function AttendanceShortagePage(): ReactNode {
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const canReview = can("attendance.correction.approve");
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["attendance-shortages", schoolId],
    queryFn: () => listAttendanceShortages(schoolId),
  });

  // Dialogs
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [warningLevel, setWarningLevel] = useState<
    "first" | "second" | "final"
  >("first");
  const [warningNotes, setWarningNotes] = useState("");

  const [explainModalOpen, setExplainModalOpen] = useState(false);
  const [explanationText, setExplanationText] = useState("");
  const [medLeaveDays, setMedLeaveDays] = useState("0");

  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [internalExamElig, setInternalExamElig] = useState<
    "eligible" | "conditional" | "debarred" | "under_review"
  >("conditional");
  const [boardExamElig, setBoardExamElig] = useState<
    | "eligible"
    | "condonation_submitted"
    | "condoned_by_board"
    | "ineligible"
    | "not_applicable"
    | "under_review"
  >("under_review");
  const [authDecision, setAuthDecision] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const warningMutation = useMutation({
    mutationFn: () =>
      issueAttendanceWarning(schoolId, selectedCaseId!, {
        warningLevel,
        notes: warningNotes || "Formal attendance shortage warning issued",
      }),
    onSuccess: () => {
      setToastMsg(`Warning ${warningLevel} issued successfully.`);
      void queryClient.invalidateQueries({
        queryKey: ["attendance-shortages", schoolId],
      });
      setWarningModalOpen(false);
      setTimeout(() => setToastMsg(null), 3000);
    },
  });

  const explainMutation = useMutation({
    mutationFn: () =>
      explainAttendanceShortage(schoolId, selectedCaseId!, {
        explanationText,
        medicalLeaveDays: Number(medLeaveDays) || 0,
      }),
    onSuccess: () => {
      setToastMsg("Student explanation and medical leave recorded.");
      void queryClient.invalidateQueries({
        queryKey: ["attendance-shortages", schoolId],
      });
      setExplainModalOpen(false);
      setTimeout(() => setToastMsg(null), 3000);
    },
  });

  const decisionMutation = useMutation({
    mutationFn: () =>
      decideAttendanceShortage(schoolId, selectedCaseId!, {
        internalExamEligibility: internalExamElig,
        boardExamEligibility: boardExamElig,
        authorizedDecision: authDecision,
        decisionNotes,
      }),
    onSuccess: () => {
      setToastMsg("Authorized examination decision recorded with audit trail.");
      void queryClient.invalidateQueries({
        queryKey: ["attendance-shortages", schoolId],
      });
      setDecisionModalOpen(false);
      setTimeout(() => setToastMsg(null), 3000);
    },
  });

  if (query.isPending) return <TableSkeleton rows={4} columns={5} />;
  if (query.isError) {
    return (
      <ErrorState
        message={errorMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { items, threshold } = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Shortage & Exam Eligibility Register"
        description={`Active students with attendance below school threshold (${threshold}%). Supports progressive warnings, parent explanations, medical condonation reviews, and authorized Board exam decisions.`}
      />

      {toastMsg && <Alert tone="success">{toastMsg}</Alert>}

      <AttendancePolicyReviews />
      <Alert tone="info" title="CBSE & Policy Separation Principle">
        In accordance with school rules, an attendance shortage warning does NOT
        automatically prevent a student from attending daily classes or writing
        exams. Official Class X/XII Board condonation follows statutory review
        of medical leaves and documentary evidence.
      </Alert>

      <Card>
        <CardHeader
          title={`Shortage Cases (${items.length} students below ${threshold}%)`}
          description="Track stage, warning progression, explanation notes, and eligibility determinations."
        />
        <div className="p-5">
          {items.length === 0 ? (
            <EmptyState
              title="No attendance shortages"
              description={`All enrolled students currently meet or exceed the ${threshold}% attendance threshold.`}
              icon="check"
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th className="text-right">Attendance</th>
                    <th>Stage</th>
                    <th>Warning</th>
                    <th>Internal Exam</th>
                    <th>Board Eligibility</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row: any) => (
                    <tr key={row.id}>
                      <td>
                        <p className="font-bold text-slate-900">
                          {row.studentName}
                        </p>
                        <p className="font-mono text-xs text-slate-500">
                          {row.admissionNumber}
                        </p>
                      </td>
                      <td>
                        <p className="text-xs font-semibold">
                          {row.className} · {row.sectionName}
                        </p>
                      </td>
                      <td className="text-right tabular-nums">
                        <span className="font-bold text-rose-600">
                          {row.attendanceRate}%
                        </span>
                        <p className="text-[11px] text-slate-400">
                          {row.daysAttended} / {row.totalWorkingDays} days
                        </p>
                      </td>
                      <td>
                        <Badge tone="warning" className="capitalize">
                          {row.stage.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td>
                        <span className="text-xs font-semibold capitalize text-slate-700">
                          {row.warningLevel} warning
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            row.internalExamEligibility === "eligible"
                              ? "success"
                              : "brand"
                          }
                        >
                          {row.internalExamEligibility}
                        </Badge>
                      </td>
                      <td>
                        <span className="text-xs text-slate-700 capitalize">
                          {row.boardExamEligibility.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td>
                        {canReview ? (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setSelectedCaseId(row.id);
                                setWarningLevel(
                                  row.warningLevel === "first"
                                    ? "second"
                                    : "final",
                                );
                                setWarningNotes("");
                                setWarningModalOpen(true);
                              }}
                            >
                              Issue Warning
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setSelectedCaseId(row.id);
                                setExplanationText(row.explanationText || "");
                                setMedLeaveDays(
                                  String(row.medicalLeaveDays || 0),
                                );
                                setExplainModalOpen(true);
                              }}
                            >
                              Record Reason
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedCaseId(row.id);
                                setInternalExamElig(
                                  row.internalExamEligibility,
                                );
                                setBoardExamElig(row.boardExamEligibility);
                                setAuthDecision(
                                  row.authorizedDecision ||
                                    "Conditional Examination Clearance",
                                );
                                setDecisionNotes("");
                                setDecisionModalOpen(true);
                              }}
                            >
                              Render Decision
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">
                            Read-only access
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Warning Dialog */}
      <Dialog
        open={warningModalOpen}
        onClose={() => setWarningModalOpen(false)}
        title="Issue Formal Shortage Warning"
        description="Records a progressive warning level and alerts student and guardian portals."
      >
        <div className="space-y-4">
          <Field label="Warning Level">
            <select
              value={warningLevel}
              onChange={(e) => setWarningLevel(e.target.value as any)}
              className="field-input"
            >
              <option value="first">First Warning (Advisory)</option>
              <option value="second">
                Second Warning (Parent Meeting Required)
              </option>
              <option value="final">Final Warning (Condonation Review)</option>
            </select>
          </Field>

          <Field label="Advisory Notes to Guardian / Student">
            <Input
              value={warningNotes}
              onChange={(e) => setWarningNotes(e.target.value)}
              placeholder="e.g. Please submit pending medical certificates by Friday."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setWarningModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              loading={warningMutation.isPending}
              onClick={() => warningMutation.mutate()}
            >
              Confirm & Issue Warning
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Explanation Dialog */}
      <Dialog
        open={explainModalOpen}
        onClose={() => setExplainModalOpen(false)}
        title="Record Explanation & Medical Leave"
        description="Documents reasons, illness dates and doctor certificate submissions for condonation."
      >
        <div className="space-y-4">
          <Field label="Approved Medical Leave Days">
            <Input
              type="number"
              min={0}
              max={60}
              value={medLeaveDays}
              onChange={(e) => setMedLeaveDays(e.target.value)}
            />
          </Field>

          <Field label="Student / Parent Explanation & Document Summary">
            <textarea
              rows={4}
              value={explanationText}
              onChange={(e) => setExplanationText(e.target.value)}
              className="field-input"
              placeholder="e.g. Student suffered from viral fever; doctor certificate dated 12 Oct submitted..."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setExplainModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              loading={explainMutation.isPending}
              disabled={explanationText.length < 5}
              onClick={() => explainMutation.mutate()}
            >
              Save Explanation
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Decision Dialog */}
      <Dialog
        open={decisionModalOpen}
        onClose={() => setDecisionModalOpen(false)}
        title="Authorized Examination Eligibility Decision"
        description="Render authorized determination on school examinations and Board condonation application."
      >
        <div className="space-y-4">
          <Field label="School Internal Exam Eligibility">
            <select
              value={internalExamElig}
              onChange={(e) => setInternalExamElig(e.target.value as any)}
              className="field-input"
            >
              <option value="eligible">Eligible (Full Clearance)</option>
              <option value="conditional">
                Conditional (Subject to Remedial Work)
              </option>
              <option value="under_review">
                Under Academic Committee Review
              </option>
              <option value="debarred">Debarred from Term Exams</option>
            </select>
          </Field>

          <Field label="CBSE Board Exam Eligibility (Classes 10 & 12)">
            <select
              value={boardExamElig}
              onChange={(e) => setBoardExamElig(e.target.value as any)}
              className="field-input"
            >
              <option value="not_applicable">
                Not Applicable (Classes 1–9, 11)
              </option>
              <option value="under_review">
                Under review — no eligibility decision yet
              </option>
              <option value="condonation_submitted">
                Condonation Application Submitted to Regional Office
              </option>
              <option value="condoned_by_board">
                Condoned by Board (Clearance Received)
              </option>
              <option value="eligible">Eligible as per Board Rules</option>
              <option value="ineligible">
                Ineligible under Board Regulations
              </option>
            </select>
          </Field>

          <Field label="Authorized Decision Summary">
            <Input
              value={authDecision}
              onChange={(e) => setAuthDecision(e.target.value)}
              placeholder="e.g. Condonation approved by Principal under Rule 14.1"
            />
          </Field>

          <Field label="Decision Notes & Committee Sign-off">
            <textarea
              rows={3}
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              className="field-input"
              placeholder="Enter meeting date, committee members and reference document numbers..."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setDecisionModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              loading={decisionMutation.isPending}
              disabled={authDecision.length < 5}
              onClick={() => decisionMutation.mutate()}
            >
              Record Authorized Decision
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
