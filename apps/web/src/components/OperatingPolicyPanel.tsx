import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { Button, Card, Field, Input, Select } from "./ui";
interface Policy {
  management: string;
  feeCollectionMode: string;
  collectionEnabled: boolean;
  attendanceThreshold: number;
  lateReviewAfterDays: number | null;
  absenceReviewAfterDays: number | null;
  terminationReviewAfterDays: number | null;
  lateFineProposalAmount: number;
  absenceFineProposalAmount: number;
  minGradeForFinancialReview: number;
  effectiveFrom: string | null;
  authorityReference: string;
  sourceUrl: string;
  automaticPenalty: false;
  automaticTermination: false;
}
export function OperatingPolicyPanel() {
  const school = useSchoolId();
  const { can } = useAuth();
  const query = useQuery({
    queryKey: ["operating-policy", school],
    queryFn: () =>
      api<{ policy: Policy }>(`/api/schools/${school}/operating-policy`),
  });
  if (!query.data)
    return (
      <p>
        {query.error
          ? errorMessage(query.error)
          : "Loading institution policy…"}
      </p>
    );
  return (
    <PolicyEditor
      key={JSON.stringify(query.data.policy)}
      initial={query.data.policy}
      editable={can("school.manage")}
    />
  );
}
function PolicyEditor({
  initial,
  editable,
}: {
  initial: Policy;
  editable: boolean;
}) {
  const school = useSchoolId();
  const qc = useQueryClient();
  const [policy, setPolicy] = useState(initial);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${school}/operating-policy`, {
        method: "PUT",
        body: JSON.stringify(policy),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["operating-policy", school] });
      void qc.invalidateQueries({queryKey:["student-policy",school]});
      void qc.invalidateQueries({queryKey:["fee-collection",school]});
      void qc.invalidateQueries({queryKey:["attendance-shortages",school]});
      void qc.invalidateQueries({queryKey:["attendance-policy-reviews",school]});
    },
  });
  return (
    <Card>
      <details className="p-5">
        <summary className="font-bold cursor-pointer">
          Collection responsibilities & attendance review policy
        </summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm">
            Select the institution’s approved policy. No automatic fine,
            expulsion or eligibility decision is created. Government elementary
            collection and elementary financial/termination proposals are
            blocked. Attendance percentages here are school warning thresholds,
            not a declaration of government rules.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Management type" htmlFor="policy-management">
              <Select
                id="policy-management"
                disabled={!editable}
                value={policy.management}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    management: e.target.value,
                    feeCollectionMode:
                      e.target.value === "private"
                        ? "central"
                        : policy.feeCollectionMode,
                  })
                }
              >
                {["government", "government_aided", "private"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Fee collection responsibility"
              htmlFor="policy-collector"
            >
              <Select
                id="policy-collector"
                value={policy.feeCollectionMode}
                disabled={!editable}
                onChange={(e) =>
                  setPolicy({ ...policy, feeCollectionMode: e.target.value })
                }
              >
                <option value="central">
                  Central finance / collection department
                </option>
                {policy.management !== "private" && (
                  <option value="assigned_teacher">
                    Assigned teacher with collector role
                  </option>
                )}
              </Select>
            </Field>
            <Field label="Collection enabled" htmlFor="policy-enabled">
              <Select
                id="policy-enabled"
                disabled={!editable}
                value={String(policy.collectionEnabled)}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    collectionEnabled: e.target.value === "true",
                  })
                }
              >
                <option value="false">Disabled until authorised</option>
                <option value="true">Enabled with approved authority</option>
              </Select>
            </Field>
            {(
              [
                ["attendanceThreshold", "School attendance warning %"],
                ["lateReviewAfterDays", "Late days before review"],
                ["absenceReviewAfterDays", "Absent days before review"],
                [
                  "terminationReviewAfterDays",
                  "Absent days before withdrawal review (Class 9+)",
                ],
                ["lateFineProposalAmount", "Late fine proposal only (₹)"],
                ["absenceFineProposalAmount", "Absence fine proposal only (₹)"],
                [
                  "minGradeForFinancialReview",
                  "Minimum grade for financial review (9+)",
                ],
              ] as const
            ).map(([key, label]) => (
              <Field label={label} htmlFor={"policy-" + key} key={key}>
                <Input
                  id={"policy-" + key}
                  type="number"
                  disabled={!editable}
                  value={policy[key] ?? ""}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      [key]:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </Field>
            ))}
            <Field label="Effective from" htmlFor="policy-date">
              <Input
                id="policy-date"
                type="date"
                disabled={!editable}
                value={policy.effectiveFrom ?? ""}
                onChange={(e) =>
                  setPolicy({
                    ...policy,
                    effectiveFrom: e.target.value || null,
                  })
                }
              />
            </Field>
            <Field
              label="Authority / school policy reference"
              htmlFor="policy-reference"
            >
              <Input
                id="policy-reference"
                disabled={!editable}
                value={policy.authorityReference}
                onChange={(e) =>
                  setPolicy({ ...policy, authorityReference: e.target.value })
                }
              />
            </Field>
            <Field
              label="Official source URL (where applicable)"
              htmlFor="policy-source"
            >
              <Input
                id="policy-source"
                type="url"
                disabled={!editable}
                value={policy.sourceUrl}
                onChange={(e) =>
                  setPolicy({ ...policy, sourceUrl: e.target.value })
                }
              />
            </Field>
          </div>
          <p className="text-xs text-slate-600">
            Late/absent thresholds count recorded days from the policy effective
            date in the active academic year, not consecutive days. Unmarked
            days are not treated as absences. Every policy update is audited.
            Assign collection roles separately in Users & roles; designation
            alone grants no financial access.
          </p>
          {save.error && <p role="alert">{errorMessage(save.error)}</p>}
          {save.isSuccess && <p role="status">Policy saved.</p>}
          {editable && (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save approved policy
            </Button>
          )}
        </div>
      </details>
    </Card>
  );
}
