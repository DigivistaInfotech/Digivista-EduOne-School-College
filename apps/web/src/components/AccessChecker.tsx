import { createPortal } from "react-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UserRecord } from "@erp/shared";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { NAV_SECTIONS } from "../lib/navigation";
import { Dialog } from "./Dialog";
import { Button, Field, Select, Input } from "./ui";

interface Access {
  status: string;
  loginEnabled: boolean;
  roles: string[];
  scopes: Array<{ scopeType: string; scopeId: string | null }>;
  visibleSectionIds: string[] | null;
  permissions: Array<{ code: string; description: string; granted: boolean;scopeTypes?:string[] }>;
}
export function AccessChecker() {
  const schoolId = useSchoolId();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const users = useQuery({
    queryKey: ["access-check-users", schoolId],
    queryFn: () =>
      api<{ items: UserRecord[] }>(`/api/schools/${schoolId}/users`),
    enabled: open,
  });
  const access = useQuery({
    queryKey: ["access-check", schoolId, person],
    queryFn: () =>
      api<Access>(`/api/schools/${schoolId}/users/${person}/access`),
    enabled: open && !!person,
    staleTime: 0,
  });
  const user = users.data?.items.find((u) => u.id === person);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="whitespace-nowrap"
        onClick={() => setOpen(true)}
      >
        Access checker
      </Button>
      {createPortal(
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Person and module access"
          size="lg"
          description="Live permission inspection for quick testing. Your administrator session stays active."
        >
          <div className="space-y-4">
            <Field label="Person" htmlFor="access-person">
              <Select
                id="access-person"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">Select a person</option>
                {users.data?.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} · {u.email} · {u.status}
                  </option>
                ))}
              </Select>
            </Field>
            {(users.error || access.error) && (
              <p role="alert">{errorMessage(users.error || access.error)}</p>
            )}
            {access.isFetching && <p>Checking current permissions…</p>}
            {person && (
              <Button
                size="sm"
                variant="secondary"
                disabled={access.isFetching}
                onClick={() => {
                  void access.refetch();
                  void users.refetch();
                }}
              >
                Refresh current access
              </Button>
            )}
            {access.data && (
              <>
                <p className="font-semibold">
                  Account: {access.data.status} ·{" "}
                  {access.data.loginEnabled
                    ? "Access active"
                    : "Access blocked / no active role"}
                </p>
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  {user?.roles.map((r) => (
                    <p key={r.assignmentId}>
                      {r.roleName}: {r.scopeLabel ?? r.scopeType}
                    </p>
                  ))}
                  <p>
                    Section visibility:{" "}
                    {access.data.visibleSectionIds === null
                      ? "School-wide role(s) present; action scopes apply separately"
                      : `${access.data.visibleSectionIds.length} assigned section(s)`}
                    . Parent and student records remain restricted to verified
                    linked children or self.
                  </p>
                </div>
                <details className="rounded-xl border p-3" open>
                  <summary className="font-semibold">
                    Complete module visibility
                  </summary>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    {NAV_SECTIONS.flatMap((g) => g.items).map((item) => {
                      const granted =
                        access.data!.loginEnabled &&
                        (!item.permission ||
                          access.data!.permissions.some(
                            (p) => p.code === item.permission && p.granted,
                          )) &&
                        (!item.anyPermission ||
                          access.data!.permissions.some(
                            (p) =>
                              item.anyPermission!.includes(p.code as never) &&
                              p.granted,
                          ));
                      return (
                        <p key={item.to} className="text-sm">
                          {item.label}:{" "}
                          <strong
                            className={
                              granted ? "text-teal-700" : "text-slate-500"
                            }
                          >
                            {granted ? "Visible" : "Hidden"}
                          </strong>
                        </p>
                      );
                    })}
                  </div>
                </details>
                <Field
                  label="Find module or permission"
                  htmlFor="access-search"
                >
                  <Input
                    id="access-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Attendance, payroll, fees…"
                  />
                </Field>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th>Module / action</th>
                        <th>Access</th><th>Record scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      {access.data.permissions
                        .filter((p) =>
                          (p.code + " " + p.description)
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )
                        .map((p) => (
                          <tr key={p.code} className="border-t">
                            <td className="py-2">
                              {p.description}
                              <small className="block text-slate-500">
                                {p.code}
                              </small>
                            </td>
                            <td
                              className={
                                p.granted
                                  ? "text-teal-700 font-bold"
                                  : "text-slate-500"
                              }
                            >
                              {p.granted ? "Granted" : "Not granted"}
                            </td><td className="text-xs text-slate-500">{p.scopeTypes?.join(', ')||'—'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500">
                  A granted module permission still requires its record scope,
                  approval rules and school membership. Use Users & roles to
                  change grants; this checker only reads them.
                </p>
              </>
            )}
          </div>
        </Dialog>,
        document.body,
      )}
    </>
  );
}
