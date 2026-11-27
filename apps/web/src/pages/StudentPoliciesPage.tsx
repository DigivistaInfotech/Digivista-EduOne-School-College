import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  INDIA_STATES,
  studentPolicyInput,
  type StudentPolicy,
  type StudentLifecycleReview,
} from "@erp/shared";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { getRegionalSettings, listSections } from "../lib/endpoints";
import { todayIso } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";

const endpoint = (schoolId: string) => `/api/schools/${schoolId}`;
function write<T>(url: string, body: unknown, method = "POST") {
  return api<T>(url, { method, body: JSON.stringify(body) });
}

export function StudentPoliciesPage() {
  const schoolId = useSchoolId();
  const client = useQueryClient();
  const [selection, setSelection] = useState("");
  const region = useQuery({
    queryKey: ["regional-settings", schoolId],
    queryFn: () => getRegionalSettings(schoolId),
  });
  const stateCode = selection || region.data?.settings.stateCode || "UP";
  const policy = useQuery({
    queryKey: ["student-policy", schoolId, stateCode],
    queryFn: () =>
      api<{ policy: StudentPolicy; version: number;managementManagedCentrally?:boolean }>(
        `${endpoint(schoolId)}/student-policies/${stateCode}`,
      ),
  });
  const reviews = useQuery({
    queryKey: ["student-policy-reviews", schoolId],
    queryFn: () =>
      api<{ items: StudentLifecycleReview[] }>(
        `${endpoint(schoolId)}/student-policy-reviews`,
      ),
  });
  const sections = useQuery({
    queryKey: ["policy-sections", schoolId],
    queryFn: () => listSections(schoolId),
  });
  const [notice, setNotice] = useState("");
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      setNotice("Saved successfully.");
      await client.invalidateQueries({
        queryKey: ["student-policy", schoolId],
      });
      await client.invalidateQueries({
        queryKey: ["student-policy-reviews", schoolId],
      });
    },
    onError: () => setNotice(""),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Policy Centre"
        description="Administrator-defined state profiles for fee heads, admission guidance, late fees and overdue review. These are school policies, not pre-verified government rules."
        actions={
          <Link to="/config-studio" className="text-sm font-bold text-teal-700">
            School state & language →
          </Link>
        }
      />
      <Alert tone="info">
        Saving a profile does not change old transactions. “Apply heads &
        late-fee rule” updates the head catalogue and a dedicated late-fee rule;
        it does not generate student charges. Assess late fees through the
        existing fee tools.
      </Alert>
      <Field label="State / union territory profile" htmlFor="policy-state">
        <Select
          id="policy-state"
          value={stateCode}
          onChange={(event) => {
            setSelection(event.target.value);
            setNotice("");
          }}
        >
          {INDIA_STATES.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name} ({state.code})
            </option>
          ))}
        </Select>
      </Field>
      {notice && <Alert tone="success">{notice}</Alert>}
      {action.isError && (
        <Alert tone="danger">{errorMessage(action.error)}</Alert>
      )}
      {policy.isError && (
        <ErrorState
          message={errorMessage(policy.error)}
          onRetry={() => void policy.refetch()}
        />
      )}
      {policy.data && (
        <PolicyEditor
          key={`${schoolId}:${stateCode}:${policy.data.version}`}
          policy={policy.data.policy}
          centrallyManaged={policy.data.managementManagedCentrally??false}
          saving={action.isPending}
          onSave={(draft) =>
            action.mutate(() =>
              write(
                `${endpoint(schoolId)}/student-policies/${stateCode}`,
                draft,
                "PUT",
              ),
            )
          }
        />
      )}
      {policy.data && (
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={
              action.isPending ||
              !policy.data.version ||
              region.data?.settings.stateCode !== stateCode
            }
            onClick={() =>
              action.mutate(() =>
                write(
                  `${endpoint(schoolId)}/student-policies/${stateCode}/apply`,
                  {},
                ),
              )
            }
          >
            Apply heads & late-fee rule
          </Button>
          <Button
            variant="secondary"
            disabled={
              action.isPending ||
              !policy.data.policy.reviewAfterDays ||
              region.data?.settings.stateCode !== stateCode
            }
            onClick={() =>
              action.mutate(async () => {
                const result = await write<{ created: number }>(
                  `${endpoint(schoolId)}/student-policies/${stateCode}/review-overdue`,
                  {},
                );
                return result;
              })
            }
          >
            Find overdue cases for review
          </Button>
          <Link
            to="/fees"
            className="self-center text-sm font-bold text-teal-700"
          >
            Open existing fee tools →
          </Link>
        </div>
      )}
      {region.data?.settings.stateCode !== stateCode && (
        <p className="text-xs text-slate-500">
          This is a profile preview. Select{" "}
          {INDIA_STATES.find((state) => state.code === stateCode)?.name} in
          school setup before applying it.
        </p>
      )}
      <Card>
        <CardHeader
          title="Admission / fee review queue"
          description="No automatic termination. Review cases retain the policy used when they were created. Fee-based withdrawal is disabled for elementary/unclassified students and requires a different administrator's approval for higher classes."
        />
        <div className="space-y-5 p-5">
          {reviews.isError && (
            <Alert tone="danger">{errorMessage(reviews.error)}</Alert>
          )}
          {!reviews.data?.items.length && (
            <p className="text-sm text-slate-500">
              No overdue cases. Save a review threshold and run the check above.
            </p>
          )}
          {reviews.data?.items.map((review) => (
            <div
              key={review.id}
              className="space-y-3 rounded-xl border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold">
                  {review.studentName} · {review.admissionNumber}
                </h3>
                <Badge>{review.status}</Badge>
              </div>
              <p className="text-sm text-slate-500">
                Class {review.grade ?? "unclassified"} · {review.stateCode} ·
                Overdue balance at review: ₹{review.outstanding.toFixed(2)}
              </p>
              {review.decisionNote && (
                <p className="text-sm">{review.decisionNote}</p>
              )}
              {review.status === "pending" && (
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    action.mutate(() =>
                      write(
                        `${endpoint(schoolId)}/student-policy-reviews/${review.id}/decide`,
                        {
                          decision: data.get("decision"),
                          note: data.get("note"),
                          authorityReference: data.get("authorityReference"),
                        },
                      ),
                    );
                  }}
                >
                  <Field label="Decision" htmlFor={`decision-${review.id}`}>
                    <Select id={`decision-${review.id}`} name="decision">
                      <option value="continue">
                        Keep admission active / close case
                      </option>
                      {review.grade !== null && review.grade > 8 && (
                        <option value="withdraw">
                          Approve withdrawal after authorised review
                        </option>
                      )}
                    </Select>
                  </Field>
                  <Field
                    label="Policy / notice / authority reference"
                    htmlFor={`authority-${review.id}`}
                  >
                    <Input
                      id={`authority-${review.id}`}
                      name="authorityReference"
                      maxLength={500}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field
                      label="Reason and review notes"
                      htmlFor={`note-${review.id}`}
                    >
                      <Textarea
                        id={`note-${review.id}`}
                        name="note"
                        required
                        minLength={10}
                        maxLength={2000}
                      />
                    </Field>
                  </div>
                  <div>
                    <Button
                      type="submit"
                      variant="review"
                      loading={action.isPending}
                    >
                      Record decision
                    </Button>
                  </div>
                </form>
              )}
              {review.status === "withdrawn" && (
                <form
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    action.mutate(() =>
                      write(
                        `${endpoint(schoolId)}/student-policy-reviews/${review.id}/readmit`,
                        {
                          sectionId: data.get("sectionId"),
                          startsOn: data.get("startsOn"),
                          note: data.get("note"),
                        },
                      ),
                    );
                  }}
                >
                  <p className="text-xs text-slate-500 sm:col-span-2">
                    Readmission keeps the original student/admission number and
                    ledger, and adds a new enrollment.{" "}
                    {review.policy.readmissionInstructions}
                  </p>
                  <Field
                    label="Readmission section"
                    htmlFor={`section-${review.id}`}
                  >
                    <Select
                      id={`section-${review.id}`}
                      name="sectionId"
                      required
                    >
                      <option value="">Choose active-year section</option>
                      {sections.data?.items.map((section) => (
                        <option key={section.id} value={section.id}>
                          {section.className} · {section.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Starts on" htmlFor={`starts-${review.id}`}>
                    <Input
                      id={`starts-${review.id}`}
                      name="startsOn"
                      type="date"
                      defaultValue={todayIso("Asia/Kolkata")}
                      required
                    />
                  </Field>
                  <Field
                    label="Readmission approval notes"
                    htmlFor={`readmit-${review.id}`}
                  >
                    <Textarea
                      id={`readmit-${review.id}`}
                      name="note"
                      required
                      minLength={10}
                    />
                  </Field>
                  <div className="self-end">
                    <Button type="submit" loading={action.isPending}>
                      Readmit existing student
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function PolicyEditor({
  centrallyManaged=false,
  policy,
  saving,
  onSave,
}: {
  policy: StudentPolicy;
  centrallyManaged?:boolean;
  saving: boolean;
  onSave: (draft: StudentPolicy) => void;
}) {
  const [heads, setHeads] = useState(
    policy.feeHeads
      .map((head) => `${head.code} | ${head.name} | ${head.description}`)
      .join("\n"),
  );
  const [validation, setValidation] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = studentPolicyInput.safeParse({
      stateCode: policy.stateCode,
      management: data.get("management"),
      minorityStatus: data.get("minority") === "on",
      policyReference: data.get("reference"),
      admissionRequirements: String(data.get("requirements"))
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      feeHeads: heads
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((line) => {
          const [code = "", name = "", description = ""] = line
            .split("|")
            .map((value) => value.trim());
          return { code, name, description };
        }),
      lateFee: {
        enabled: data.get("lateEnabled") === "on",
        graceDays: Number(data.get("graceDays")),
        percentPerMonth: Number(data.get("percentPerMonth")),
        maxAmount: Number(data.get("maxAmount")),
      },
      reviewAfterDays: data.get("reviewAfterDays")
        ? Number(data.get("reviewAfterDays"))
        : null,
      readmissionInstructions: data.get("readmission"),
    });
    if (!parsed.success) {
      setValidation(
        parsed.error.issues.map((issue) => issue.message).join(". "),
      );
      return;
    }
    setValidation("");
    onSave(parsed.data);
  }
  return (
    <Card>
      <CardHeader
        title="Administrator policy settings"
        description="Use approved school documents as references. Government codes are not inferred from these custom head names."
      />
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="School management" htmlFor="policy-management" hint={centrallyManaged?'Linked to Institution masters; update the institution category there.':undefined}>
            {centrallyManaged&&<input type="hidden" name="management" value={policy.management}/>}
            <Select
              id="policy-management"
              disabled={centrallyManaged}
              name={centrallyManaged?undefined:"management"}
              defaultValue={policy.management}
            >
              <option value="government">Government</option>
              <option value="private">Private</option>
              <option value="government_aided">Government-aided</option>
            </Select>
          </Field>
          <Field
            label="School policy / circular reference"
            htmlFor="policy-reference"
          >
            <Input
              id="policy-reference"
              name="reference"
              defaultValue={policy.policyReference}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="minority"
            type="checkbox"
            defaultChecked={policy.minorityStatus}
          />
          Minority institution status (separate from management type)
        </label>
        <Field
          label="Admission documents / requirements — one per line"
          htmlFor="policy-requirements"
        >
          <Textarea
            id="policy-requirements"
            name="requirements"
            defaultValue={policy.admissionRequirements.join("\n")}
            placeholder="School-approved admission checklist"
          />
        </Field>
        <Field
          label="Fee heads — CODE | Name | Description, one per line"
          htmlFor="policy-heads"
        >
          <Textarea
            id="policy-heads"
            value={heads}
            onChange={(event) => setHeads(event.target.value)}
            placeholder="ADMISSION | Admission fee | School-defined head"
            className="min-h-36"
          />
        </Field>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setHeads((existing) => {
              const examples = [
                ["ADMISSION", "Admission fee"],
                ["TUITION", "Tuition fee"],
                ["READMISSION", "Readmission fee"],
                ["EXAM", "Examination fee"],
                ["TRANSPORT", "Transport fee"],
                ["ACTIVITY", "Activity fee"],
                ["LIBRARY", "Library fee"],
              ];
              const codes = new Set(
                existing.split("\n").map((line) => line.split("|")[0]?.trim()),
              );
              return [
                existing,
                ...examples
                  .filter(([code]) => !codes.has(code))
                  .map(
                    ([code, name]) =>
                      `${code} | ${name} | School-defined; confirm applicability`,
                  ),
              ]
                .filter(Boolean)
                .join("\n");
            })
          }
        >
          Add editable common head examples
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            name="lateEnabled"
            type="checkbox"
            defaultChecked={policy.lateFee.enabled}
          />
          Enable this profile's monthly late-fee rule
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Grace days" htmlFor="policy-grace">
            <Input
              id="policy-grace"
              name="graceDays"
              type="number"
              min={0}
              max={365}
              defaultValue={policy.lateFee.graceDays}
              required
            />
          </Field>
          <Field label="Late fee % per month" htmlFor="policy-percent">
            <Input
              id="policy-percent"
              name="percentPerMonth"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={policy.lateFee.percentPerMonth}
              required
            />
          </Field>
          <Field label="Maximum late fee ₹ (0 = no cap)" htmlFor="policy-max">
            <Input
              id="policy-max"
              name="maxAmount"
              type="number"
              min={0}
              step="0.01"
              defaultValue={policy.lateFee.maxAmount}
              required
            />
          </Field>
          <Field
            label="Overdue review after days (blank = off)"
            htmlFor="policy-days"
          >
            <Input
              id="policy-days"
              name="reviewAfterDays"
              type="number"
              min={1}
              max={730}
              defaultValue={policy.reviewAfterDays ?? ""}
            />
          </Field>
        </div>
        <Field
          label="Readmission checklist / instructions"
          htmlFor="policy-readmission"
        >
          <Textarea
            id="policy-readmission"
            name="readmission"
            defaultValue={policy.readmissionInstructions}
          />
        </Field>
        {validation && <Alert tone="danger">{validation}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save state policy version
          </Button>
        </div>
      </form>
    </Card>
  );
}
