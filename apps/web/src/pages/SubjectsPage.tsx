import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import type { SubjectRecord } from "@erp/shared";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { createSubject, listSubjects, updateSubject } from "../lib/endpoints";
import { api, errorMessage, fieldErrors } from "../lib/api";
import { Dialog } from "../components/Dialog";
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

const SUBJECT_TYPES = [
  { value: "academic", label: "Academic" },
  { value: "elective", label: "Elective" },
  { value: "activity", label: "Activity" },
];

export function SubjectsPage(): ReactNode {
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; record: SubjectRecord } | null
  >(null);

  const subjects = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => listSubjects(schoolId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["subjects", schoolId] });
    void queryClient.invalidateQueries({ queryKey: ["overview", schoolId] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Subject catalogue shared across classes, used by timetables and grade entry."
        actions={
          can("academic.subject.manage") ? (
            <div className="flex flex-wrap gap-2">
              {can("imports.manage") && <MasterImportActions entityType="subjects" />}
              <Button onClick={() => setDialog({ mode: "create" })}>
                <Icon name="plus" className="h-4 w-4" />
                New subject
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card>
        {subjects.isPending ? (
          <TableSkeleton rows={6} columns={4} />
        ) : subjects.isError ? (
          <ErrorState
            message={errorMessage(subjects.error)}
            onRetry={() => void subjects.refetch()}
          />
        ) : subjects.data.items.length === 0 ? (
          <EmptyState
            title="No subjects yet"
            description="Create the subject catalogue before building timetables or assessments."
            icon="book"
            action={
              can("academic.subject.manage") ? (
                <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
                  Create subject
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Code</th>
                  <th>Type</th>
                  <th>Status</th>
                  {can("academic.subject.manage") && (
                    <th className="text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {subjects.data.items.map((record) => (
                  <tr key={record.id}>
                    <td className="font-medium text-slate-900">
                      {record.name}
                    </td>
                    <td className="font-mono text-xs">{record.code}</td>
                    <td className="capitalize">{record.subjectType}</td>
                    <td>
                      <Badge
                        tone={
                          record.status === "active" ? "success" : "neutral"
                        }
                      >
                        {record.status}
                      </Badge>
                    </td>
                    {can("academic.subject.manage") && (
                      <td className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDialog({ mode: "edit", record })}
                        >
                          Edit
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {can("academic.subject.manage") && (
        <SubjectOfferingPanel subjects={subjects.data?.items ?? []} />
      )}

      {dialog && (
        <SubjectDialog
          mode={dialog.mode}
          record={dialog.mode === "edit" ? dialog.record : undefined}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            toast.notify("success", message);
            setDialog(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function SubjectOfferingPanel({
  subjects,
}: {
  subjects: SubjectRecord[];
}): ReactNode {
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [yearId, setYearId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [selected, setSelected] = useState<string[] | null>(null);
  const offerings = useQuery({
    queryKey: ["subject-offerings", schoolId],
    queryFn: () =>
      api<{
        years: Array<{ id: string; name: string; status: string }>;
        classes: Array<{ id: string; name: string; status: string }>;
        items: Array<{
          academicYearId: string;
          subjectId: string;
          classId: string;
        }>;
      }>(`/api/schools/${schoolId}/subject-offerings`),
  });
  const currentYear =
    yearId ||
    offerings.data?.years.find((y) => y.status === "active")?.id ||
    "";
  const checked =
    selected ??
    offerings.data?.items
      .filter(
        (i) => i.academicYearId === currentYear && i.subjectId === subjectId,
      )
      .map((i) => i.classId) ??
    [];
  const archived =
    offerings.data?.years.find((y) => y.id === currentYear)?.status ===
    "archived";
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${schoolId}/subjects/${subjectId}/class-offerings`, {
        method: "PUT",
        body: JSON.stringify({
          academicYearId: currentYear,
          classIds: checked,
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["subject-offerings", schoolId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["library-classifications", schoolId],
      });
      toast.notify("success", "Subject class offerings saved");
    },
  });
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">Subject class offerings</h2>
        {can("imports.manage") && <MasterImportActions entityType="subject_offerings" />}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Choose which classes offer each subject for an academic year. This
        master supports library book mapping without creating teacher
        assignments or timetable entries. Existing teaching and timetable
        mappings also remain applicable.
      </p>
      {offerings.isError && (
        <Alert tone="danger">{errorMessage(offerings.error)}</Alert>
      )}
      {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Academic year" htmlFor="offering-year" required>
          <Select
            id="offering-year"
            value={currentYear}
            onChange={(e) => {
              setYearId(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">Select academic year</option>
            {offerings.data?.years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.status === "archived" ? " (archived)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" htmlFor="offering-subject" required>
          <Select
            id="offering-subject"
            value={subjectId}
            onChange={(e) => {
              setSubjectId(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">Select subject</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {subjectId && currentYear && (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {offerings.data?.classes
            .filter((c) => c.status === "active" || checked.includes(c.id))
            .map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked.includes(c.id)}
                  disabled={archived || save.isPending}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...checked, c.id]
                        : checked.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}
                {c.status !== "active" ? " (inactive)" : ""}
              </label>
            ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Clearing selections removes explicit offerings for this year only. It
        does not remove recorded teaching assignments, timetable entries or
        existing books.
      </p>
      <Button
        className="mt-4"
        disabled={
          !subjectId ||
          !currentYear ||
          archived ||
          offerings.isPending ||
          offerings.isError
        }
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        Save class offerings
      </Button>
    </Card>
  );
}

function SubjectDialog({
  mode,
  record,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  record?: SubjectRecord;
  onClose: () => void;
  onSaved: (message: string) => void;
}): ReactNode {
  const schoolId = useSchoolId();
  const [code, setCode] = useState(record?.code ?? "");
  const [name, setName] = useState(record?.name ?? "");
  const [subjectType, setSubjectType] = useState(
    record?.subjectType ?? "academic",
  );
  const [status, setStatus] = useState<SubjectRecord["status"]>(
    record?.status ?? "active",
  );
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const mutation = useMutation({
    mutationFn: () =>
      mode === "create"
        ? createSubject(schoolId, { code, name, subjectType, status })
        : updateSubject(schoolId, record!.id, {
            code,
            name,
            subjectType,
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
      title={mode === "create" ? "New subject" : `Edit ${record?.name}`}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            form="subject-form"
            type="submit"
            loading={mutation.isPending}
          >
            {mode === "create" ? "Create subject" : "Save changes"}
          </Button>
        </>
      }
    >
      <form
        id="subject-form"
        className="space-y-4"
        onSubmit={submit}
        noValidate
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            htmlFor="subject-code"
            required
            error={errors.code?.[0]}
          >
            <Input
              id="subject-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="MATH"
              required
            />
          </Field>
          <Field
            label="Name"
            htmlFor="subject-name"
            required
            error={errors.name?.[0]}
          >
            <Input
              id="subject-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mathematics"
              required
            />
          </Field>
          <Field
            label="Type"
            htmlFor="subject-type"
            error={errors.subjectType?.[0]}
          >
            <Select
              id="subject-type"
              value={subjectType}
              onChange={(event) => setSubjectType(event.target.value)}
            >
              {SUBJECT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="subject-status">
            <Select
              id="subject-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as SubjectRecord["status"])
              }
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
