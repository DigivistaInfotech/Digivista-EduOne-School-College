import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { Button, Card, Field, Input, Select } from "./ui";
interface Term {
  id: string;
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  sequenceNo: number;
}
interface Holiday {
  id: string;
  name: string;
  holidayOn: string;
  notes: string | null;
  academicYearId: string | null;
}
interface Plan {
  canManageYearPlan: boolean;
  year: {
    id: string;
    name: string;
    startsOn: string;
    endsOn: string;
    status: string;
  };
  terms: Term[];
  holidays: Holiday[];
  readiness: Array<{ label: string; count: number | null }>;
  readinessNote: string;
}
export function AcademicYearPlan({
  years,
}: {
  years: Array<{ id: string; name: string }>;
}) {
  const school = useSchoolId();
  const [id, setId] = useState("");
  const query = useQuery({
    queryKey: ["academic-year-plan", school, id],
    queryFn: () =>
      api<Plan>(`/api/schools/${school}/academic-years/${id}/plan`),
    enabled: !!id,
  });
  return (
    <Card>
      <details>
        <summary className="font-bold cursor-pointer">
          Term dates, school holidays & year-end readiness
        </summary>
        <div className="mt-4 space-y-4">
          <Field
            label="Year for academic planning"
            htmlFor="academic-plan-year"
          >
            <Select
              id="academic-plan-year"
              value={id}
              onChange={(e) => setId(e.target.value)}
            >
              <option value="">Select an academic year</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </Field>
          {query.isFetching && <p className="text-sm">Loading year plan…</p>}
          {query.error && <p role="alert">{errorMessage(query.error)}</p>}
          {query.data && <YearEditor key={id} plan={query.data} />}
        </div>
      </details>
    </Card>
  );
}
function YearEditor({ plan }: { plan: Plan }) {
  const school = useSchoolId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const editable = can("academic.year.manage") && plan.canManageYearPlan;
  const [term, setTerm] = useState({
    id: "",
    code: "",
    name: "",
    startsOn: plan.year.startsOn,
    endsOn: plan.year.endsOn,
    sequenceNo: Math.max(0, ...plan.terms.map((item) => item.sequenceNo)) + 1,
  });
  const [holiday, setHoliday] = useState({
    id: "",
    name: "",
    holidayOn: plan.year.startsOn,
    notes: "",
  });
  const refresh = () => {
    void qc.invalidateQueries({
      queryKey: ["academic-year-plan", school, plan.year.id],
    });
    void qc.invalidateQueries({ queryKey: ["holidays", school] });
  };
  const termSave = useMutation({
    mutationFn: () =>
      api(
        `/api/schools/${school}/academic-years/${plan.year.id}/terms${term.id ? "/" + term.id : ""}`,
        {
          method: term.id ? "PUT" : "POST",
          body: JSON.stringify({
            code: term.code || `TERM-${term.sequenceNo}`,
            name: term.name,
            startsOn: term.startsOn,
            endsOn: term.endsOn,
            sequenceNo: term.sequenceNo,
          }),
        },
      ),
    onSuccess: () => {
      setTerm({
        id: "",
        code: "",
        name: "",
        startsOn: plan.year.startsOn,
        endsOn: plan.year.endsOn,
        sequenceNo:
          Math.max(
            term.sequenceNo,
            0,
            ...plan.terms.map((item) => item.sequenceNo),
          ) + 1,
      });
      refresh();
    },
  });
  const holidaySave = useMutation({
    mutationFn: () =>
      api(
        `/api/schools/${school}/academic-years/${plan.year.id}/holidays${holiday.id ? "/" + holiday.id : ""}`,
        {
          method: holiday.id ? "PUT" : "POST",
          body: JSON.stringify({
            name: holiday.name,
            holidayOn: holiday.holidayOn,
            notes: holiday.notes,
          }),
        },
      ),
    onSuccess: () => {
      setHoliday({
        id: "",
        name: "",
        holidayOn: plan.year.startsOn,
        notes: "",
      });
      refresh();
    },
  });
  return (
    <div className="space-y-6">
      <p className="text-sm">
        {plan.year.name}: {plan.year.startsOn} to {plan.year.endsOn}. Existing
        class/year setup is unchanged; these additional dates support planning.
      </p>
      <section aria-label="Academic terms" className="space-y-3">
        <h3 className="font-semibold">Terms</h3>
        {plan.terms.length === 0 ? (
          <p className="text-sm text-slate-500">No terms recorded.</p>
        ) : (
          <div className="overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sequence</th>
                  <th>Term</th>
                  <th>Dates</th>
                  {editable && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {plan.terms.map((t) => (
                  <tr key={t.id}>
                    <td>{t.sequenceNo}</td>
                    <td>
                      {t.name} · {t.code}
                    </td>
                    <td>
                      {t.startsOn} to {t.endsOn}
                    </td>
                    {editable && (
                      <td>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setTerm(t)}
                        >
                          Edit term
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editable && (
          <form
            className="space-y-3 rounded-xl border bg-slate-50 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              termSave.mutate();
            }}
          >
            <h4 className="font-semibold">
              {term.id ? "Edit term" : "Add term"}
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Term name" htmlFor="term-name" required>
                <Input
                  id="term-name"
                  value={term.name}
                  maxLength={100}
                  required
                  onChange={(e) => setTerm({ ...term, name: e.target.value })}
                />
              </Field>
              <Field label="Code (generated if blank)" htmlFor="term-code">
                <Input
                  id="term-code"
                  value={term.code}
                  maxLength={40}
                  onChange={(e) => setTerm({ ...term, code: e.target.value })}
                />
              </Field>
              <Field label="Starts on" htmlFor="term-start" required>
                <Input
                  id="term-start"
                  type="date"
                  min={plan.year.startsOn}
                  max={plan.year.endsOn}
                  value={term.startsOn}
                  required
                  onChange={(e) =>
                    setTerm({ ...term, startsOn: e.target.value })
                  }
                />
              </Field>
              <Field label="Ends on" htmlFor="term-end" required>
                <Input
                  id="term-end"
                  type="date"
                  min={term.startsOn}
                  max={plan.year.endsOn}
                  value={term.endsOn}
                  required
                  onChange={(e) => setTerm({ ...term, endsOn: e.target.value })}
                />
              </Field>
              <Field label="Sequence" htmlFor="term-sequence" required>
                <Input
                  id="term-sequence"
                  type="number"
                  min={1}
                  max={100}
                  value={term.sequenceNo}
                  required
                  onChange={(e) =>
                    setTerm({ ...term, sequenceNo: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <Button type="submit" disabled={termSave.isPending}>
              Save term
            </Button>
            {term.id && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setTerm({
                    id: "",
                    code: "",
                    name: "",
                    startsOn: plan.year.startsOn,
                    endsOn: plan.year.endsOn,
                    sequenceNo:
                      Math.max(
                        0,
                        ...plan.terms.map((item) => item.sequenceNo),
                      ) + 1,
                  })
                }
              >
                Cancel term edit
              </Button>
            )}
            {termSave.error && (
              <p role="alert">{errorMessage(termSave.error)}</p>
            )}
            {termSave.isSuccess && <p role="status">Term saved.</p>}
          </form>
        )}
      </section>
      <section aria-label="Academic holidays" className="space-y-3">
        <h3 className="font-semibold">School holidays</h3>
        <p className="text-xs text-slate-500">
          Uses the same holiday calendar as staff leave. Institution-wide
          holidays in this date range are included; they are managed from the
          central holiday settings.
        </p>
        {plan.holidays.length === 0 ? (
          <p className="text-sm text-slate-500">
            No holidays recorded in this year.
          </p>
        ) : (
          <ul className="space-y-2">
            {plan.holidays.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"
              >
                <span>
                  {h.holidayOn} · {h.name}
                  {h.academicYearId === null ? " · Institution-wide" : ""}
                  {h.notes ? ` · ${h.notes}` : ""}
                </span>
                {editable && h.academicYearId === plan.year.id && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setHoliday({ ...h, notes: h.notes ?? "" })}
                  >
                    Edit holiday
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form
            className="space-y-3 rounded-xl border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              holidaySave.mutate();
            }}
          >
            <h4 className="font-semibold">
              {holiday.id ? "Edit year holiday" : "Add year holiday"}
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Holiday name" htmlFor="year-holiday-name" required>
                <Input
                  id="year-holiday-name"
                  value={holiday.name}
                  maxLength={120}
                  required
                  onChange={(e) =>
                    setHoliday({ ...holiday, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Holiday date" htmlFor="year-holiday-date" required>
                <Input
                  id="year-holiday-date"
                  type="date"
                  min={plan.year.startsOn}
                  max={plan.year.endsOn}
                  value={holiday.holidayOn}
                  required
                  onChange={(e) =>
                    setHoliday({ ...holiday, holidayOn: e.target.value })
                  }
                />
              </Field>
              <Field label="Notes (optional)" htmlFor="year-holiday-notes">
                <Input
                  id="year-holiday-notes"
                  value={holiday.notes}
                  maxLength={1000}
                  onChange={(e) =>
                    setHoliday({ ...holiday, notes: e.target.value })
                  }
                />
              </Field>
            </div>
            <Button type="submit" disabled={holidaySave.isPending}>
              Save year holiday
            </Button>
            {holiday.id && (
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setHoliday({
                    id: "",
                    name: "",
                    holidayOn: plan.year.startsOn,
                    notes: "",
                  })
                }
              >
                Cancel holiday edit
              </Button>
            )}
            {holidaySave.error && (
              <p role="alert">{errorMessage(holidaySave.error)}</p>
            )}
            {holidaySave.isSuccess && <p role="status">Holiday saved.</p>}
          </form>
        )}
      </section>
      {plan.readiness.length > 0 && (
        <section aria-label="Year-end readiness">
          <h3 className="font-semibold">Year-end readiness · review only</h3>
          <ul className="mt-2 space-y-2">
            {plan.readiness.map((check) => (
              <li
                key={check.label}
                className="rounded-xl bg-slate-50 p-3 text-sm"
              >
                {check.label}:{" "}
                <strong>
                  {check.count === null
                    ? "Outside your permission"
                    : check.count}
                </strong>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-600">{plan.readinessNote}</p>
        </section>
      )}
    </div>
  );
}
