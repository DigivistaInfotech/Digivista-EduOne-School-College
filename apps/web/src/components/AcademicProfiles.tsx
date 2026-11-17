import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { Button, Card, Field, Input, Select } from "./ui";
interface Choice {
  id: string;
  name: string;
  status?: string;
}
interface Master {
  id: string;
  kind: string;
  label: string;
  active: boolean;
}
interface Lookups {
  masters: Master[];
  people: Array<Choice & { isTeacher: boolean }>;
  rooms: Choice[];
  classes: Choice[];
  sections: Array<
    Choice & {
      classId: string;
      academicYearId: string;
      yearStartsOn: string;
      yearEndsOn: string;
    }
  >;
}
interface ClassProfile {
  id: string;
  name: string;
  stageId: string | null;
  mediumId: string | null;
  stream: string;
  coordinatorUserId: string | null;
  nextClassId: string | null;
  canEdit: boolean;
  activeSectionCount: number;
  capacitySummary: Array<{
    academicYearId: string;
    academicYearName: string;
    sectionCount: number;
    totalCapacity: number | null;
    enrolled: number;
  }>;
}
interface SectionProfile {
  canEdit:boolean;
  id: string;
  classId: string;
  academicYearId: string;
  yearStartsOn: string;
  yearEndsOn: string;
  capacity: number | null;
  enrolled: number;
  availableSeats: number | null;
  overCapacity: boolean;
  assignedSubjectCount: number;
  classTeacherUserId: string | null;
  coTeacherUserId: string | null;
  roomId: string | null;
  shiftId: string | null;
  mediumId: string | null;
  stream: string;
  nextSectionId: string | null;
}
function useLookups() {
  const school = useSchoolId();
  return useQuery({
    queryKey: ["academic-profile-lookups", school],
    queryFn: () =>
      api<Lookups>(`/api/schools/${school}/academic/profile-lookups`),
  });
}
function Choices({
  label,
  id,
  value,
  items,
  onChange,
  disabled = false,
}: {
  label: string;
  id: string;
  value: string | null;
  items: Choice[];
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Not set</option>
        {value && !items.some((i) => i.id === value) && (
          <option value={value}>Saved reference — review availability</option>
        )}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
const masterChoices = (
  lookups: Lookups,
  kind: string,
  current: string | null,
) =>
  lookups.masters
    .filter((m) => m.kind === kind && (m.active || m.id === current))
    .map((m) => ({
      id: m.id,
      name: m.label + (m.active ? "" : " (inactive)"),
    }));
export function AcademicClassProfiles({ classes }: { classes: Choice[] }) {
  const school = useSchoolId();
  const [id, setId] = useState("");
  const lookups = useLookups();
  const query = useQuery({
    queryKey: ["academic-class-profile", school, id],
    queryFn: () =>
      api<ClassProfile>(`/api/schools/${school}/classes/${id}/profile`),
    enabled: !!id,
  });
  return (
    <Card>
      <details>
        <summary className="font-bold cursor-pointer">
          Additional class details & promotion planning
        </summary>
        <div className="mt-4 space-y-4">
          <Field label="Class for additional details" htmlFor="profile-class">
            <Select
              id="profile-class"
              value={id}
              onChange={(e) => setId(e.target.value)}
            >
              <option value="">Select a class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {(query.error || lookups.error) && (
            <p role="alert">{errorMessage(query.error || lookups.error)}</p>
          )}
          {query.data && lookups.data && (
            <ClassEditor key={id} profile={query.data} lookups={lookups.data} />
          )}
        </div>
      </details>
    </Card>
  );
}
function ClassEditor({
  profile,
  lookups,
}: {
  profile: ClassProfile;
  lookups: Lookups;
}) {
  const school = useSchoolId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const allowed = can("academic.class.manage") && profile.canEdit;
  const [value, setValue] = useState({
    stageId: profile.stageId,
    mediumId: profile.mediumId,
    stream: profile.stream,
    coordinatorUserId: profile.coordinatorUserId,
    nextClassId: profile.nextClassId,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${school}/classes/${profile.id}/profile`, {
        method: "PUT",
        body: JSON.stringify(value),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["academic-class-profile", school, profile.id],
      });
    },
  });
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-3"
    >
      <p className="text-sm">
        {profile.activeSectionCount} active section(s) across academic years.
        These optional details supplement the existing class record.
      </p>
      {profile.capacitySummary.length > 0 && (
        <ul className="space-y-1 text-sm">
          {profile.capacitySummary.map((summary) => (
            <li key={summary.academicYearId}>
              {summary.academicYearName}: {summary.sectionCount} section(s) ·{" "}
              {summary.enrolled} enrolled · Capacity{" "}
              {summary.totalCapacity ?? "not fully configured"}
              {summary.totalCapacity !== null
                ? ` · Available ${Math.max(0, summary.totalCapacity - summary.enrolled)}${summary.enrolled > summary.totalCapacity ? " · Capacity warning" : ""}`
                : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Choices
          label="Academic stage"
          id="class-stage"
          value={value.stageId}
          items={masterChoices(lookups, "academic_stage", value.stageId)}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, stageId: v })}
        />
        <Choices
          label="Teaching medium"
          id="class-medium"
          value={value.mediumId}
          items={masterChoices(lookups, "language_medium", value.mediumId)}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, mediumId: v })}
        />
        <Field
          label="Stream / specialisation (optional)"
          htmlFor="class-stream"
        >
          <Input
            id="class-stream"
            disabled={!allowed}
            value={value.stream}
            maxLength={120}
            onChange={(e) => setValue({ ...value, stream: e.target.value })}
          />
        </Field>
        <Choices
          label="Class coordinator"
          id="class-coordinator"
          value={value.coordinatorUserId}
          items={lookups.people}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, coordinatorUserId: v })}
        />
        <Choices
          label="Next class for promotion planning"
          id="class-next"
          value={value.nextClassId}
          items={lookups.classes.filter(
            (c) =>
              c.id !== profile.id &&
              (c.status === "active" || c.id === value.nextClassId),
          )}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, nextClassId: v })}
        />
      </div>
      <p className="text-xs text-slate-500">
        The next-class mapping is a planning reference. It does not move
        students automatically. Coordinator selection does not grant account
        permissions. Administrators can extend stage and medium values in
        Institution masters.
      </p>
      {save.error && <p role="alert">{errorMessage(save.error)}</p>}
      {save.isSuccess && <p role="status">Class details saved.</p>}
      {allowed && (
        <Button type="submit" disabled={save.isPending}>
          Save additional class details
        </Button>
      )}
    </form>
  );
}
export function AcademicSectionProfiles({ sections }: { sections: Choice[] }) {
  const school = useSchoolId();
  const [id, setId] = useState("");
  const lookups = useLookups();
  const query = useQuery({
    queryKey: ["academic-section-profile", school, id],
    queryFn: () =>
      api<SectionProfile>(`/api/schools/${school}/sections/${id}/profile`),
    enabled: !!id && sections.some((s) => s.id === id),
  });
  return (
    <Card>
      <details>
        <summary className="font-bold cursor-pointer">
          Additional section details & live capacity
        </summary>
        <div className="mt-4 space-y-4">
          <Field
            label="Section for additional details"
            htmlFor="profile-section"
          >
            <Select
              id="profile-section"
              value={id}
              onChange={(e) => setId(e.target.value)}
            >
              <option value="">Select a section</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          {(query.error || lookups.error) && (
            <p role="alert">{errorMessage(query.error || lookups.error)}</p>
          )}
          {query.data && lookups.data && (
            <SectionEditor
              key={id}
              profile={query.data}
              lookups={lookups.data}
            />
          )}
        </div>
      </details>
    </Card>
  );
}
function SectionEditor({
  profile,
  lookups,
}: {
  profile: SectionProfile;
  lookups: Lookups;
}) {
  const school = useSchoolId();
  const { can } = useAuth();
  const qc = useQueryClient();
  const allowed = can("academic.section.manage")&&profile.canEdit;
  const [value, setValue] = useState({
    classTeacherUserId: profile.classTeacherUserId,
    coTeacherUserId: profile.coTeacherUserId,
    roomId: profile.roomId,
    shiftId: profile.shiftId,
    mediumId: profile.mediumId,
    stream: profile.stream,
    nextSectionId: profile.nextSectionId,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${school}/sections/${profile.id}/profile`, {
        method: "PUT",
        body: JSON.stringify(value),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["academic-section-profile", school, profile.id],
      });
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-3"
    >
      <p
        className={`rounded-xl p-3 text-sm ${profile.overCapacity ? "bg-amber-50 text-amber-900" : "bg-teal-50 text-teal-900"}`}
      >
        Enrolled: {profile.enrolled} · Capacity: {profile.capacity ?? "Not set"}{" "}
        · Available seats: {profile.availableSeats ?? "Not calculated"}
        {profile.overCapacity
          ? " · Capacity warning: enrollment exceeds configured capacity"
          : ""}
        . {profile.assignedSubjectCount} subject(s) have current teaching
        assignments.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choices
          label="Class teacher"
          id="section-class-teacher"
          value={value.classTeacherUserId}
          items={lookups.people.filter((p) => p.isTeacher)}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, classTeacherUserId: v })}
        />
        <Choices
          label="Co-teacher"
          id="section-co-teacher"
          value={value.coTeacherUserId}
          items={lookups.people.filter((p) => p.isTeacher)}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, coTeacherUserId: v })}
        />
        <Choices
          label="Room / location"
          id="section-room"
          value={value.roomId}
          items={lookups.rooms}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, roomId: v })}
        />
        <Choices
          label="Shift"
          id="section-shift"
          value={value.shiftId}
          items={masterChoices(lookups, "academic_shift", value.shiftId)}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, shiftId: v })}
        />
        <Choices
          label="Teaching medium"
          id="section-medium"
          value={value.mediumId}
          items={masterChoices(lookups, "language_medium", value.mediumId)}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, mediumId: v })}
        />
        <Field
          label="Stream / specialisation (optional)"
          htmlFor="section-stream"
        >
          <Input
            id="section-stream"
            value={value.stream}
            disabled={!allowed}
            maxLength={120}
            onChange={(e) => setValue({ ...value, stream: e.target.value })}
          />
        </Field>
        <Choices
          label="Next-year section planning reference"
          id="section-next"
          value={value.nextSectionId}
          items={lookups.sections.filter(
            (s) =>
              s.yearStartsOn > profile.yearEndsOn &&
              (s.status === "active" || s.id === value.nextSectionId),
          )}
          disabled={!allowed}
          onChange={(v) => setValue({ ...value, nextSectionId: v })}
        />
      </div>
      <p className="text-xs text-slate-500">
        Capacity comes from active enrollments. Class/co-teacher selections do
        not alter timetable lessons or account permissions. Next-year mapping is
        a reference only; enrollment history stays intact.
      </p>
      {save.error && <p role="alert">{errorMessage(save.error)}</p>}
      {save.isSuccess && <p role="status">Section details saved.</p>}
      {allowed && (
        <Button type="submit" disabled={save.isPending}>
          Save additional section details
        </Button>
      )}
    </form>
  );
}
