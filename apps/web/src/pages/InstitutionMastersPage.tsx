import { OperatingPolicyPanel } from "../components/OperatingPolicyPanel";
import { MasterImportActions } from "../components/MasterImportActions";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { getInstitutionMasters, MASTER_KINDS } from "../lib/institutionMasters";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from "../components/ui";
export function InstitutionMastersPage() {
  const school = useSchoolId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [kind, setKind] = useState("designation");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [institutionType, setType] = useState("all");
  const query = useQuery({
    queryKey: ["institution-masters", school],
    queryFn: () => getInstitutionMasters(school),
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${school}/institution-masters`, {
        method: "POST",
        body: JSON.stringify({ kind, code, label, institutionType }),
      }),
    onSuccess: () => {
      setCode("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["institution-masters", school] });
    },
  });
  const toggle = useMutation({
    mutationFn: (item: { id: string; active: boolean }) =>
      api(`/api/schools/${school}/institution-masters/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !item.active }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["institution-masters", school] });
    },
  });
  const kinds = [
    ...new Set([
      ...MASTER_KINDS,
      ...(query.data?.items.map((i) => i.kind) ?? []),
    ]),
  ];
  const allowed =
    can("school.manage") ||
    (can("hr.employee.manage") &&
      ["staff_type", "designation", "department", "employment_type"].includes(
        kind,
      )) ||
    (can("transport.manage") &&
      [
        "vehicle_model",
        "vehicle_type",
        "fuel_type",
        "maintenance_type",
      ].includes(kind));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Institution masters"
        description="Reusable classifications for school, college and university records. Staff mapping uses master IDs; a designation does not grant application access."
        actions={can("school.manage") && can("imports.manage") ? <MasterImportActions entityType="institution_masters" /> : undefined}
      />
      <OperatingPolicyPanel />
      <Card>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Master category" htmlFor="master-kind">
            <Select
              id="master-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Institution type" htmlFor="master-institution">
            <Select
              id="master-institution"
              value={institutionType}
              onChange={(e) => setType(e.target.value)}
            >
              {["all", "school", "college", "university"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          {allowed && (
            <>
              <Field label="Stable code" htmlFor="master-code">
                <Input
                  id="master-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="assistant_professor"
                  maxLength={60}
                />
              </Field>
              <Field label="Display name" htmlFor="master-name">
                <Input
                  id="master-name"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={120}
                />
              </Field>
              <Button
                onClick={() => save.mutate()}
                disabled={!code.trim() || !label.trim() || save.isPending}
              >
                Add master value
              </Button>
            </>
          )}
        </div>
      </Card>
      {(query.error || save.error || toggle.error) && (
        <p role="alert">
          {errorMessage(query.error || save.error || toggle.error)}
        </p>
      )}
      <Card>
        <div className="overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Institution</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.items
                .filter(
                  (i) =>
                    i.kind === kind &&
                    (institutionType === "all" ||
                      i.institutionType === "all" ||
                      i.institutionType === institutionType),
                )
                .map((i) => (
                  <tr key={i.id}>
                    <td>{i.label}</td>
                    <td>{i.code}</td>
                    <td>{i.institutionType}</td>
                    <td>{i.active ? "Active" : "Inactive"}</td>
                    <td>
                      {allowed && (
                        <Button
                          variant="secondary"
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate(i)}
                        >
                          {i.active ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-sm text-slate-500">
        Existing academic years, classes, sections, subjects, fee heads and
        vendors keep their current master screens. New staff classifications can
        be extended here without changing past records. Deactivated values
        remain on existing records and cannot be selected for new mappings.
      </p>
    </div>
  );
}
