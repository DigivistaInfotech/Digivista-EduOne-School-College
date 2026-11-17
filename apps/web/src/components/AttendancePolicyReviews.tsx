import { useQuery } from "@tanstack/react-query";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatMoney } from "../lib/format";
import { Card } from "./ui";
interface Reviews {
  active: boolean;
  note: string;
  items: Array<{
    id: string;
    name: string;
    admissionNumber: string;
    lateDays: number;
    absentDays: number;
    protectedStudent: boolean;
    lateReview: boolean;
    absenceReview: boolean;
    terminationReview: boolean;
    proposedFine: number;
    penaltyApplied: false;
    terminationApplied: false;
  }>;
}
export function AttendancePolicyReviews() {
  const school = useSchoolId();
  const query = useQuery({
    queryKey: ["attendance-policy-reviews", school],
    queryFn: () =>
      api<Reviews>(`/api/schools/${school}/attendance/policy-reviews`),
  });
  return (
    <Card>
      <details className="p-5">
        <summary className="cursor-pointer font-bold">
          Late arrival & absence follow-up · {query.data?.items.length ?? 0}{" "}
          review(s)
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm">
            School-approved review thresholds only. Proposals never create a fee
            charge, stop admission or terminate a student automatically.
            Elementary and unclassified grades are protected from
            financial/withdrawal proposals.
          </p>
          {query.error && <p role="alert">{errorMessage(query.error)}</p>}
          {query.data && !query.data.active && (
            <p>
              No effective review policy. Authorised administrators can
              configure it in Institution masters.
            </p>
          )}
          {query.data?.active && query.data.items.length === 0 && (
            <p>No recorded attendance currently meets the review thresholds.</p>
          )}
          {query.data?.items.length !== 0 && (
            <div className="overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Late days</th>
                    <th>Absent days</th>
                    <th>Review</th>
                    <th>Fine proposal</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.name}
                        <small className="block">{i.admissionNumber}</small>
                      </td>
                      <td>{i.lateDays}</td>
                      <td>{i.absentDays}</td>
                      <td>
                        {[
                          i.lateReview ? "Late arrival follow-up" : "",
                          i.absenceReview ? "Absence follow-up" : "",
                          i.terminationReview
                            ? "Authorised lifecycle review — no action taken"
                            : "",
                        ]
                          .filter(Boolean)
                          .join("; ")}
                        {i.protectedStudent && (
                          <small className="block">
                            Elementary / unclassified protection
                          </small>
                        )}
                      </td>
                      <td>
                        {i.proposedFine
                          ? `${formatMoney(i.proposedFine)} — not charged`
                          : "No charge"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">{query.data?.note}</p>
        </div>
      </details>
    </Card>
  );
}
