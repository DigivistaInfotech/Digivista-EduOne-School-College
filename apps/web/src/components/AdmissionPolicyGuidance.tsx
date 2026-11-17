import { useQuery } from "@tanstack/react-query";
import { useSchoolId } from "../auth/AuthContext";
import { api } from "../lib/api";
import { Alert } from "./ui";

export function AdmissionPolicyGuidance() {
  const schoolId = useSchoolId();
  const policy = useQuery({
    queryKey: ["admission-policy", schoolId],
    queryFn: () =>
      api<{
        stateCode: string | null;
        requirements: string[];
        reference: string;
      }>(`/api/schools/${schoolId}/admission-policy`),
  });
  if (!policy.data?.requirements.length) return null;
  return (
    <Alert tone="info">
      <strong>School admission checklist · {policy.data.stateCode}</strong>
      <ul className="mt-2 list-inside list-disc">
        {policy.data.requirements.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>
      {policy.data.reference && (
        <p className="mt-2 text-xs">
          School policy reference: {policy.data.reference}
        </p>
      )}
    </Alert>
  );
}
