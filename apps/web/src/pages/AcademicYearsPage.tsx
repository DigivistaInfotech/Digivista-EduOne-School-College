import { AcademicYearPlan } from "../components/AcademicYearPlan";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import type { AcademicYear } from "@erp/shared";
import { useAuth, useSchoolId, useSchoolTimezone } from "../auth/AuthContext";
import {
  activateAcademicYear,
  createAcademicYear,
  listAcademicYears,
  updateAcademicYear,
} from "../lib/endpoints";
import { api, errorMessage, fieldErrors } from "../lib/api";
import { formatDate, todayIso } from "../lib/format";
import { ConfirmDialog, Dialog } from "../components/Dialog";
import { useToast } from "../components/ToastProvider";
import { MasterImportActions } from "../components/MasterImportActions";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
} from "../components/ui";

const STATUS_TONES = {
  planned: "info",
  active: "success",
  closed: "neutral",
  archived: "warning",
} as const;

export function AcademicYearsPage(): ReactNode {
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; year: AcademicYear } | null
  >(null);
  const [activating, setActivating] = useState<AcademicYear | null>(null);
  const [copyTarget, setCopyTarget] = useState<AcademicYear | null>(null);
  const [copySourceId, setCopySourceId] = useState("");

  const years = useQuery({
    queryKey: ["academic-years", schoolId],
    queryFn: () => listAcademicYears(schoolId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["academic-years", schoolId],
    });
    void queryClient.invalidateQueries({ queryKey: ["overview", schoolId] });
    void queryClient.invalidateQueries({ queryKey: ["sections", schoolId] });
  };

  const activate = useMutation({
    mutationFn: (year: AcademicYear) => activateAcademicYear(schoolId, year.id),
    onSuccess: (year) => {
      toast.notify("success", `${year.name} is now the active academic year.`);
      setActivating(null);
      invalidate();
    },
    onError: (error) => toast.notify("error", errorMessage(error)),
  });
  const copyStructure = useMutation({
    mutationFn: () => api<{ sectionsCreated: number; subjectMappingsCreated: number }>(
      `/api/schools/${schoolId}/academic-years/${copyTarget!.id}/copy-structure`,
      { method: "POST", body: JSON.stringify({ sourceYearId: copySourceId }) },
    ),
    onSuccess: (result) => {
      toast.notify("success", `Structure copied: ${result.sectionsCreated} sections and ${result.subjectMappingsCreated} subject mappings added.`);
      setCopyTarget(null);
      setCopySourceId("");
      invalidate();
    },
    onError: (error) => toast.notify("error", errorMessage(error)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic years"
        description="Only one year can be active per school. Activating a year closes the previous active year."
        actions={
          can("academic.year.manage") ? (
            <div className="flex flex-wrap gap-2">
              {can("imports.manage") && <MasterImportActions entityType="academic_years" />}
              <Button onClick={() => setDialog({ mode: "create" })}>
                <Icon name="plus" className="h-4 w-4" />
                New academic year
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card>
        {years.isPending ? (
          <TableSkeleton rows={4} columns={5} />
        ) : years.isError ? (
          <ErrorState
            message={errorMessage(years.error)}
            onRetry={() => void years.refetch()}
          />
        ) : years.data.items.length === 0 ? (
          <EmptyState
            title="No academic years yet"
            description="Create the first year to start defining classes, sections and enrollments."
            icon="calendar"
            action={
              can("academic.year.manage") ? (
                <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
                  Create academic year
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Code</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Status</th>
                  {can("academic.year.manage") && (
                    <th className="text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {years.data.items.map((year) => (
                  <tr key={year.id}>
                    <td className="font-medium text-slate-900">{year.name}</td>
                    <td className="font-mono text-xs">{year.code}</td>
                    <td>{formatDate(year.startsOn)}</td>
                    <td>{formatDate(year.endsOn)}</td>
                    <td>
                      <Badge tone={STATUS_TONES[year.status]}>
                        {year.status}
                      </Badge>
                    </td>
                    {can("academic.year.manage") && (
                      <td>
                        <div className="flex justify-end gap-2">
                          {year.status !== "active" &&
                            year.status !== "archived" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setActivating(year)}
                              >
                                Activate
                              </Button>
                            )}
                          {year.status !== "archived" && years.data.items.some((source) => source.id !== year.id && source.startsOn < year.startsOn) && (
                            <Button size="sm" variant="secondary" onClick={() => {
                              const source = years.data.items.filter((item) => item.id !== year.id && item.startsOn < year.startsOn).sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
                              setCopySourceId(source?.id ?? "");
                              setCopyTarget(year);
                            }}>Copy structure</Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDialog({ mode: "edit", year })}
                          >
                            Edit
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AcademicYearPlan years={years.data?.items ?? []} />

      {dialog && (
        <YearDialog
          mode={dialog.mode}
          year={dialog.mode === "edit" ? dialog.year : undefined}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            toast.notify("success", message);
            setDialog(null);
            invalidate();
          }}
        />
      )}

      <Dialog
        open={copyTarget !== null}
        title="Copy academic structure"
        description="Reuses school-wide classes and subjects, then adds missing sections and class-subject mappings to the selected year. Existing target records are left untouched."
        onClose={() => { setCopyTarget(null); setCopySourceId(""); }}
        footer={<><Button variant="secondary" onClick={() => setCopyTarget(null)}>Cancel</Button><Button loading={copyStructure.isPending} disabled={!copySourceId} onClick={() => copyStructure.mutate()}>Copy structure</Button></>}
      >
        <Field label={`Copy from year into ${copyTarget?.name ?? "target year"}`} htmlFor="copy-source-year" required>
          <Select id="copy-source-year" value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)} required>
            <option value="">Select previous academic year</option>
            {years.data?.items.filter((source) => source.id !== copyTarget?.id && source.startsOn < (copyTarget?.startsOn ?? "")).map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
          </Select>
        </Field>
      </Dialog>

      <ConfirmDialog
        open={activating !== null}
        title="Activate academic year"
        message={
          <>
            <p>
              <strong>{activating?.name}</strong> will become the active year
              for this school.
            </p>
            <p className="mt-2 text-slate-500">
              The currently active year will be marked as closed. Existing
              enrollment records keep their original year.
            </p>
          </>
        }
        confirmLabel="Activate year"
        busy={activate.isPending}
        onConfirm={() => activating && activate.mutate(activating)}
        onClose={() => setActivating(null)}
      />
    </div>
  );
}

function YearDialog({
  mode,
  year,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  year?: AcademicYear;
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const schoolId = useSchoolId();
  const timeZone = useSchoolTimezone();
  const [code, setCode] = useState(year?.code ?? "");
  const [name, setName] = useState(year?.name ?? "");
  const [startsOn, setStartsOn] = useState(
    year?.startsOn ?? todayIso(timeZone),
  );
  const [endsOn, setEndsOn] = useState(
    year?.endsOn ?? nextYear(todayIso(timeZone)),
  );
  const [status, setStatus] = useState<AcademicYear["status"]>(
    year?.status ?? "planned",
  );
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const mutation = useMutation({
    mutationFn: () =>
      mode === "create"
        ? createAcademicYear(schoolId, { code, name, startsOn, endsOn, status })
        : updateAcademicYear(schoolId, year!.id, {
            name,
            startsOn,
            endsOn,
            status,
          }),
    onSuccess: (saved) =>
      onSaved(
        mode === "create" ? `${saved.name} created` : `${saved.name} updated`,
      ),
    onError: (caught) => {
      setError(errorMessage(caught));
      setErrors(fieldErrors(caught));
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setErrors({});
    mutation.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "create" ? "New academic year" : `Edit ${year?.name}`}
      description="Dates use the school's calendar year; they do not need to match the calendar year exactly."
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button form="year-form" type="submit" loading={mutation.isPending}>
            {mode === "create" ? "Create year" : "Save changes"}
          </Button>
        </>
      }
    >
      <form id="year-form" className="space-y-4" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            htmlFor="year-code"
            required
            error={errors.code?.[0]}
          >
            <Input
              id="year-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="2026-2027"
              disabled={mode === "edit"}
              required
            />
          </Field>
          <Field
            label="Name"
            htmlFor="year-name"
            required
            error={errors.name?.[0]}
          >
            <Input
              id="year-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Academic Year 2026-27"
              required
            />
          </Field>
          <Field
            label="Starts on"
            htmlFor="year-start"
            required
            error={errors.startsOn?.[0]}
          >
            <Input
              id="year-start"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Ends on"
            htmlFor="year-end"
            required
            error={errors.endsOn?.[0]}
          >
            <Input
              id="year-end"
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
              required
            />
          </Field>
        </div>
        <Field
          label="Status"
          htmlFor="year-status"
          hint="Activating a year from this form also closes the previously active year."
        >
          <Select
            id="year-status"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as AcademicYear["status"])
            }
          >
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            {year?.status === "archived" && (
              <option value="archived">Archived</option>
            )}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

function nextYear(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
