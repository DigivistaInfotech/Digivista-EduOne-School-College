import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  RoomRecord,
  TimetableData,
  TimetablePeriod,
  TimetableSlot,
} from "@erp/shared";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import {
  createRoom,
  createTimetablePeriod,
  createTimetableSlot,
  deleteRoom,
  deleteTimetablePeriod,
  deleteTimetableSlot,
  getTimetable,
  listAcademicYears,
  listSections,
  listSubjects,
  updateRoom,
  updateTimetablePeriod,
} from "../lib/endpoints";
import { errorMessage, fieldErrors } from "../lib/api";
import { formatClock } from "../lib/format";
import { Dialog, ConfirmDialog } from "../components/Dialog";
import { useToast } from "../components/ToastProvider";
import { SubstitutePlanner } from "../components/SubstitutePlanner";
import { MasterImportActions } from "../components/MasterImportActions";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
  Textarea,
  cn,
} from "../components/ui";

const DAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 7, label: "Sunday", short: "Sun" },
];

type Tab = "grid" | "substitutions" | "periods" | "rooms";
type ConfirmTarget =
  | { kind: "slot"; id: string; label: string }
  | { kind: "period"; id: string; label: string }
  | { kind: "room"; id: string; label: string };

export function TimetablePage(): ReactNode {
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = can("academic.timetable.manage");
  const canReplace =
    canManage || can("hr.employee.manage") || can("school.manage");

  const [yearId, setYearId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [substitutionCount, setSubstitutionCount] = useState(0);
  const [todayDay, setTodayDay] = useState(() => new Date().getDay() || 7);
  const [tab, setTab] = useState<Tab>("grid");
  const [dialog, setDialog] = useState<
    | { kind: "slot" }
    | { kind: "period"; period?: TimetablePeriod }
    | { kind: "room"; room?: RoomRecord }
    | null
  >(null);
  const [confirming, setConfirming] = useState<ConfirmTarget | null>(null);

  const years = useQuery({
    queryKey: ["academic-years", schoolId],
    queryFn: () => listAcademicYears(schoolId),
  });
  const sections = useQuery({
    queryKey: ["sections", schoolId, yearId],
    queryFn: () => listSections(schoolId, { academicYearId: yearId }),
    enabled: Boolean(yearId),
  });
  const subjects = useQuery({
    queryKey: ["subjects", schoolId],
    queryFn: () => listSubjects(schoolId),
  });
  const timetable = useQuery({
    queryKey: ["timetable", schoolId, yearId, sectionId],
    queryFn: () =>
      getTimetable(schoolId, { academicYearId: yearId, sectionId }),
    enabled: Boolean(yearId && sectionId),
  });

  useEffect(() => {
    if (yearId || !years.data) return;
    const preferred =
      years.data.items.find((year) => year.status === "active") ??
      years.data.items[0];
    if (preferred) setYearId(preferred.id);
  }, [years.data, yearId]);

  useEffect(() => {
    if (!sections.data) return;
    if (!sections.data.items.some((section) => section.id === sectionId)) {
      setSectionId(sections.data.items[0]?.id ?? "");
    }
  }, [sections.data, sectionId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["timetable", schoolId] });
  };

  const remove = useMutation({
    mutationFn: (target: ConfirmTarget) => {
      if (target.kind === "slot")
        return deleteTimetableSlot(schoolId, target.id);
      if (target.kind === "period")
        return deleteTimetablePeriod(schoolId, target.id);
      return deleteRoom(schoolId, target.id);
    },
    onSuccess: () => {
      toast.notify("success", `${labelForKind(confirming!.kind)} deleted.`);
      setConfirming(null);
      invalidate();
    },
    onError: (error) => {
      setConfirming(null);
      toast.notify("error", errorMessage(error));
    },
  });

  const data = timetable.data;
  const selectedSection = sections.data?.items.find(
    (section) => section.id === sectionId,
  );
  const classOptions = [...new Map((sections.data?.items ?? []).map((section) => [section.classId, section.className])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const sectionOptions = (sections.data?.items ?? []).filter((section) => !selectedSection || section.classId === selectedSection.classId);
  const activeSubjects =
    subjects.data?.items.filter((subject) => subject.status === "active") ?? [];
  const yearName = years.data?.items.find((year) => year.id === yearId)?.name ?? "Academic year";

  return (
    <div className="print-surface space-y-6">
      <PageHeader
        title="Timetable"
        description="Build a section's weekly timetable, review teacher replacements and print the selected class schedule. Conflicting section, teacher or room bookings are rejected."
        actions={
          tab === "grid" ? (
            <>
              <Button className="print-hide" variant="secondary" onClick={() => setTodayDay(new Date().getDay() || 7)}>
                Today
              </Button>
              <Button className="print-hide" variant="secondary" onClick={() => window.print()}>
                Print timetable
              </Button>
              {canManage && <Button className="print-hide"
                onClick={() => setDialog({ kind: "slot" })}
                disabled={!sectionId || activeSubjects.length === 0}
                title={
                  activeSubjects.length === 0
                    ? "Create a subject before adding timetable slots"
                    : undefined
                }
              >
                <Icon name="plus" className="h-4 w-4" />
                Add lesson
              </Button>}
            </>
          ) : canManage && tab === "periods" ? <div className="flex flex-wrap gap-2">{can("imports.manage") && <MasterImportActions entityType="timetable_periods" />}<Button onClick={() => setDialog({ kind: "period" })}><Icon name="plus" className="h-4 w-4" />New period</Button></div>
            : canManage && tab === "rooms" ? <div className="flex flex-wrap gap-2">{can("imports.manage") && <MasterImportActions entityType="rooms" />}<Button onClick={() => setDialog({ kind: "room" })}><Icon name="plus" className="h-4 w-4" />New room</Button></div>
              : undefined
        }
      />

      <div className="print-hide flex flex-wrap items-end gap-4">
        <Field label="Academic year" htmlFor="tt-year">
          <Select
            id="tt-year"
            value={yearId}
            onChange={(event) => {
              setYearId(event.target.value);
              setSectionId("");
              setSelectedSlotId("");
            }}
            className="min-w-48"
          >
            {years.data?.items.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
                {year.status === "active" ? " (active)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stage / Class" htmlFor="tt-class">
          <Select id="tt-class" value={selectedSection?.classId ?? ""} onChange={(event) => {
            const next = sections.data?.items.find((section) => section.classId === event.target.value);
            setSectionId(next?.id ?? "");
            setSelectedSlotId("");
          }} className="min-w-48" disabled={!yearId || !classOptions.length}>
            {classOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Section" htmlFor="tt-section">
          <Select id="tt-section" value={sectionId} onChange={(event) => { setSectionId(event.target.value); setSelectedSlotId(""); }} className="min-w-40" disabled={!sectionOptions.length}>
            {sectionOptions.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
          </Select>
        </Field>
        {selectedSection && (
          <p className="pb-2 text-sm text-slate-500">
            {selectedSection.enrolled} enrolled ·{" "}
            {timetable.data?.slots.length ?? 0} weekly slots
          </p>
        )}
      </div>

      <div
        className="print-hide flex gap-1 overflow-x-auto border-b border-slate-200"
        role="tablist"
        aria-label="Timetable views"
      >
        {(
          [
            ["grid", "Weekly timetable"],
            ["substitutions", "Substitutions"],
            ["periods", "Periods"],
            ["rooms", "Rooms"],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === value
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {label}{value === "substitutions" && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{substitutionCount}</span>}
          </button>
        ))}
      </div>

      <div className="print-only mb-4 hidden border-b border-slate-300 pb-3">
        <h1 className="text-xl font-bold">{selectedSection?.className} · {selectedSection?.name} timetable</h1>
        <p>{yearName}</p>
      </div>
      {years.isError || sections.isError ? (
        <ErrorState
          message={errorMessage(years.error ?? sections.error)}
          onRetry={() => {
            void years.refetch();
            void sections.refetch();
          }}
        />
      ) : !yearId ? (
        <Card>
          <EmptyState
            title="No academic year selected"
            description="Create an academic year before building a timetable."
            icon="calendar"
          />
        </Card>
      ) : !sectionId ? (
        <Card>
          <EmptyState
            title="No section selected"
            description="Create a section for this academic year to build its timetable."
            icon="layers"
          />
        </Card>
      ) : timetable.isPending ? (
        <Card>
          <TableSkeleton rows={6} columns={6} />
        </Card>
      ) : timetable.isError ? (
        <ErrorState
          message={errorMessage(timetable.error)}
          onRetry={() => void timetable.refetch()}
        />
      ) : tab === "grid" ? (
        <TimetableGrid
          data={data!}
          canManage={canManage}
          selectedSlotId={selectedSlotId}
          todayDay={todayDay}
          onSelectSlot={(slot) => setSelectedSlotId(slot.id)}
          onAssignSubstitute={(slot) => { setSelectedSlotId(slot.id); setTab("substitutions"); }}
          onAdd={() => setDialog({ kind: "slot" })}
          onRemove={(slot) =>
            setConfirming({
              kind: "slot",
              id: slot.id,
              label: `${slot.subjectName} · ${slot.teacherName}`,
            })
          }
        />
      ) : tab === "substitutions" ? canReplace ? (
        <SubstitutePlanner key={`${yearId}-${sectionId}-${selectedSlotId}`} data={data} initialSlotId={selectedSlotId} onCountChange={setSubstitutionCount} />
      ) : <Card><EmptyState title="Substitutions are not enabled for your role" description="Ask an administrator for timetable management or staff management permission." /></Card>
      : tab === "periods" ? (
        <PeriodsTable
          periods={data!.periods}
          canManage={canManage}
          onEdit={(period) => setDialog({ kind: "period", period })}
          onRemove={(period) =>
            setConfirming({ kind: "period", id: period.id, label: period.name })
          }
        />
      ) : (
        <RoomsTable
          rooms={data!.rooms}
          canManage={canManage}
          onEdit={(room) => setDialog({ kind: "room", room })}
          onRemove={(room) =>
            setConfirming({ kind: "room", id: room.id, label: room.name })
          }
        />
      )}

      {dialog?.kind === "slot" && data && (
        <SlotDialog
          data={data}
          sectionId={sectionId}
          sections={sections.data?.items ?? []}
          subjects={activeSubjects}
          onClose={() => setDialog(null)}
          onSaved={() => {
            toast.notify("success", "Timetable slot added.");
            setDialog(null);
            invalidate();
          }}
        />
      )}

      {dialog?.kind === "period" && yearId && (
        <PeriodDialog
          academicYearId={yearId}
          period={dialog.period}
          onClose={() => setDialog(null)}
          onSaved={() => {
            toast.notify(
              "success",
              dialog.period ? "Period updated." : "Period created.",
            );
            setDialog(null);
            invalidate();
          }}
        />
      )}

      {dialog?.kind === "room" && (
        <RoomDialog
          room={dialog.room}
          onClose={() => setDialog(null)}
          onSaved={() => {
            toast.notify(
              "success",
              dialog.room ? "Room updated." : "Room created.",
            );
            setDialog(null);
            invalidate();
          }}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={`Delete ${confirming ? labelForKind(confirming.kind) : ""}`}
        message={
          <p>
            <strong>{confirming?.label}</strong> will be removed. This cannot be
            undone.
          </p>
        }
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        onConfirm={() => confirming && remove.mutate(confirming)}
        onClose={() => setConfirming(null)}
      />
    </div>
  );
}

function labelForKind(kind: ConfirmTarget["kind"]): string {
  return kind === "slot"
    ? "timetable slot"
    : kind === "period"
      ? "period"
      : "room";
}

function TimetableGrid({
  data,
  canManage,
  selectedSlotId,
  todayDay,
  onSelectSlot,
  onAssignSubstitute,
  onAdd,
  onRemove,
}: {
  data: TimetableData;
  canManage: boolean;
  selectedSlotId: string;
  todayDay: number;
  onSelectSlot: (slot: TimetableSlot) => void;
  onAssignSubstitute: (slot: TimetableSlot) => void;
  onAdd: () => void;
  onRemove: (slot: TimetableSlot) => void;
}): ReactNode {
  const days = data.slots.some((slot) => slot.dayOfWeek > 5) ? DAYS : DAYS.slice(0, 5);
  const selectedSlot = data.slots.find((slot) => slot.id === selectedSlotId);
  const selectedPeriod = data.periods.find((period) => period.id === selectedSlot?.periodId);
  if (data.periods.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No periods configured"
          description="Add lesson periods first, then place subjects into the weekly grid."
          icon="calendar"
          action={
            canManage ? <Button onClick={onAdd}>Add period</Button> : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
    <Card>
      <CardHeader
        title="Weekly grid"
        description="Empty cells mean the lesson is not scheduled. Add a slot to fill one."
      />
      <div className="overflow-x-auto">
        <table className="data-table min-w-[900px]">
          <thead>
            <tr>
              <th className="w-40">Period</th>
              {days.map((day) => (
                <th key={day.value} className={todayDay === day.value ? "bg-teal-50 text-teal-900" : ""}>{day.label}{todayDay === day.value ? " · Today" : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.periods.map((period) => (
              period.isBreak ? <tr key={period.id} className="bg-amber-50">
                <th scope="row" className="align-middle text-left">
                  <p className="font-bold">{period.name}</p>
                  <p className="font-mono text-xs font-normal">{formatClock(period.startsAt)}–{formatClock(period.endsAt)}</p>
                </th>
                <td colSpan={days.length} className="text-center font-bold tracking-wide text-amber-900">Break · {period.name}</td>
              </tr> : <tr key={period.id}>
                <td className="align-top">
                  <p className="font-medium text-slate-900">{period.name}</p>
                  <p className="font-mono text-xs text-slate-500">
                    {formatClock(period.startsAt)}–{formatClock(period.endsAt)}
                  </p>
                  {period.isBreak && <Badge tone="warning">Break</Badge>}
                </td>
                {days.map((day) => {
                  const slot = data.slots.find(
                    (entry) =>
                      entry.periodId === period.id &&
                      entry.dayOfWeek === day.value,
                  );
                  return (
                    <td key={day.value} className={`align-top ${todayDay === day.value ? "bg-teal-50/40" : ""}`}>
                      {slot ? (
                        <div className="space-y-1.5">
                          <button type="button" aria-pressed={selectedSlotId === slot.id} onClick={() => onSelectSlot(slot)} className={`timetable-subject-card block w-full rounded-lg border-l-4 p-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${subjectCardTone(slot.subjectId)} ${selectedSlotId === slot.id ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}>
                            <p className="text-sm font-bold">{slot.subjectName}</p>
                            <p className="text-xs">{slot.teacherName}</p>
                            {slot.roomName && <p className="text-xs opacity-80">{slot.roomName}</p>}
                          </button>
                          {canManage && <button type="button" onClick={() => onRemove(slot)} className="print-hide text-xs font-medium text-rose-700 hover:underline">Remove</button>}
                        </div>
                      ) : canManage ? (
                        <button
                          type="button"
                          onClick={onAdd}
                          className="print-hide text-xs font-medium text-brand-700 hover:underline"
                        >
                          + Add
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    <Card className="print-hide">
      <CardHeader title="Lesson details" description={selectedSlot ? `${selectedSlot.className} · ${selectedSlot.sectionName}` : "Select a lesson in the weekly grid."} />
      {selectedSlot && selectedPeriod ? <div className="space-y-4 p-4">
        <div className="rounded-lg bg-teal-50 p-3 text-sm font-semibold text-teal-900">{DAYS.find((day) => day.value === selectedSlot.dayOfWeek)?.label} · {selectedPeriod.name} · {formatClock(selectedPeriod.startsAt)}–{formatClock(selectedPeriod.endsAt)}</div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subject</p><p className="mt-1 text-lg font-bold">{selectedSlot.subjectName}</p></div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Regular teacher</p><p className="mt-1">{selectedSlot.teacherName}</p></div>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Room</p><p className="mt-1">{selectedSlot.roomName ?? "Not assigned"}</p></div>
        <Button className="w-full print-hide" variant="secondary" onClick={() => onAssignSubstitute(selectedSlot)}>Check / assign substitute</Button>
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Optional notes</p><p className="mt-1 text-sm text-slate-700">{selectedSlot.notes || "No notes recorded."}</p></div>
        {canManage && <Button className="w-full" onClick={onAdd}>Add another lesson</Button>}
      </div> : <EmptyState title="No lesson selected" description="Choose a subject card to see its day, period, teacher and room." />}
    </Card>
    </div>
  );
}

function subjectCardTone(subjectId: string): string {
  const tones = [
    "border-sky-500 bg-sky-50 text-sky-950",
    "border-violet-500 bg-violet-50 text-violet-950",
    "border-emerald-500 bg-emerald-50 text-emerald-950",
    "border-amber-500 bg-amber-50 text-amber-950",
    "border-rose-500 bg-rose-50 text-rose-950",
    "border-cyan-500 bg-cyan-50 text-cyan-950",
  ];
  let hash = 0;
  for (const char of subjectId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}

function PeriodsTable({
  periods,
  canManage,
  onEdit,
  onRemove,
}: {
  periods: TimetablePeriod[];
  canManage: boolean;
  onEdit: (period: TimetablePeriod) => void;
  onRemove: (period: TimetablePeriod) => void;
}): ReactNode {
  return (
    <Card>
      <CardHeader
        title="Periods"
        description="Ordered lesson blocks used by every section."
      />
      {periods.length === 0 ? (
        <EmptyState
          title="No periods yet"
          description="Add the school day's lesson periods."
          icon="calendar"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Type</th>
                {canManage && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id}>
                  <td className="font-mono text-xs">{period.sequenceNo}</td>
                  <td className="font-medium text-slate-900">{period.name}</td>
                  <td className="font-mono text-xs">
                    {formatClock(period.startsAt)}
                  </td>
                  <td className="font-mono text-xs">
                    {formatClock(period.endsAt)}
                  </td>
                  <td>
                    <Badge tone={period.isBreak ? "warning" : "brand"}>
                      {period.isBreak ? "Break" : "Lesson"}
                    </Badge>
                  </td>
                  {canManage && (
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onEdit(period)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRemove(period)}
                        >
                          Delete
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
  );
}

function RoomsTable({
  rooms,
  canManage,
  onEdit,
  onRemove,
}: {
  rooms: RoomRecord[];
  canManage: boolean;
  onEdit: (room: RoomRecord) => void;
  onRemove: (room: RoomRecord) => void;
}): ReactNode {
  return (
    <Card>
      <CardHeader
        title="Rooms"
        description="Physical spaces available for scheduling."
      />
      {rooms.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description="Add classrooms and labs before scheduling."
          icon="home"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Capacity</th>
                <th>Status</th>
                {canManage && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id}>
                  <td className="font-mono text-xs">{room.code}</td>
                  <td className="font-medium text-slate-900">{room.name}</td>
                  <td>{room.capacity ?? "—"}</td>
                  <td>
                    <Badge
                      tone={room.status === "active" ? "success" : "neutral"}
                    >
                      {room.status}
                    </Badge>
                  </td>
                  {canManage && (
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onEdit(room)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRemove(room)}
                        >
                          Delete
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
  );
}

function SlotDialog({
  data,
  sectionId,
  sections,
  subjects,
  onClose,
  onSaved,
}: {
  data: TimetableData;
  sectionId: string;
  sections: Array<{ id: string; className: string; name: string }>;
  subjects: Array<{ id: string; name: string; code: string }>;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const schoolId = useSchoolId();
  const lessonPeriods = data.periods.filter((period) => !period.isBreak);
  const [periodId, setPeriodId] = useState(lessonPeriods[0]?.id ?? "");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [teacherUserId, setTeacherUserId] = useState(
    data.teachers[0]?.id ?? "",
  );
  const [roomId, setRoomId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const currentSection = sections.find((section) => section.id === sectionId);

  const mutation = useMutation({
    mutationFn: () =>
      createTimetableSlot(schoolId, {
        academicYearId: data.academicYearId!,
        sectionId,
        periodId,
        dayOfWeek,
        subjectId,
        teacherUserId,
        roomId: roomId || null,
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
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
      title="Add timetable slot"
      description={
        currentSection
          ? `${currentSection.className} · ${currentSection.name}`
          : "Weekly lesson slot"
      }
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
            form="slot-form"
            type="submit"
            loading={mutation.isPending}
            disabled={!periodId || !subjectId || !teacherUserId}
          >
            Add slot
          </Button>
        </>
      }
    >
      <form id="slot-form" className="space-y-4" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {lessonPeriods.length === 0 && (
          <Alert tone="warning">
            Every period is marked as a break. Add a lesson period before
            scheduling.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Day"
            htmlFor="slot-day"
            required
            error={errors.dayOfWeek?.[0]}
          >
            <Select
              id="slot-day"
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(Number(event.target.value))}
            >
              {DAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Period"
            htmlFor="slot-period"
            required
            error={errors.periodId?.[0]}
          >
            <Select
              id="slot-period"
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
            >
              {lessonPeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name} ({formatClock(period.startsAt)}–
                  {formatClock(period.endsAt)})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Subject"
            htmlFor="slot-subject"
            required
            error={errors.subjectId?.[0]}
          >
            <Select
              id="slot-subject"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name} ({subject.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Teacher"
            htmlFor="slot-teacher"
            required
            error={errors.teacherUserId?.[0]}
          >
            <Select
              id="slot-teacher"
              value={teacherUserId}
              onChange={(event) => setTeacherUserId(event.target.value)}
            >
              {data.teachers.length === 0 && (
                <option value="">No teaching users</option>
              )}
              {data.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room" htmlFor="slot-room" error={errors.roomId?.[0]}>
            <Select
              id="slot-room"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
            >
              <option value="">No room</option>
              {data.rooms
                .filter((room) => room.status === "active")
                .map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Field label="Lesson notes (optional)" htmlFor="slot-notes" hint="Add a brief topic or handover note for staff; maximum 500 characters.">
          <Textarea id="slot-notes" value={notes} onChange={(event) => setNotes(event.target.value.slice(0, 500))} maxLength={500} rows={3} />
        </Field>
      </form>
    </Dialog>
  );
}

function PeriodDialog({
  academicYearId,
  period,
  onClose,
  onSaved,
}: {
  academicYearId: string;
  period?: TimetablePeriod;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const schoolId = useSchoolId();
  const [name, setName] = useState(period?.name ?? "");
  const [sequenceNo, setSequenceNo] = useState(period?.sequenceNo ?? 1);
  const [startsAt, setStartsAt] = useState(
    period?.startsAt.slice(0, 5) ?? "08:00",
  );
  const [endsAt, setEndsAt] = useState(period?.endsAt.slice(0, 5) ?? "08:45");
  const [isBreak, setIsBreak] = useState(period?.isBreak ?? false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const mutation = useMutation({
    mutationFn: () =>
      period
        ? updateTimetablePeriod(schoolId, period.id, {
            name,
            sequenceNo,
            startsAt,
            endsAt,
            isBreak,
          })
        : createTimetablePeriod(schoolId, {
            academicYearId,
            name,
            sequenceNo,
            startsAt,
            endsAt,
            isBreak,
          }),
    onSuccess: onSaved,
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
      title={period ? `Edit ${period.name}` : "New period"}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button form="period-form" type="submit" loading={mutation.isPending}>
            {period ? "Save changes" : "Create period"}
          </Button>
        </>
      }
    >
      <form id="period-form" className="space-y-4" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            htmlFor="period-name"
            required
            error={errors.name?.[0]}
          >
            <Input
              id="period-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Period 1"
              required
            />
          </Field>
          <Field
            label="Order"
            htmlFor="period-order"
            required
            error={errors.sequenceNo?.[0]}
          >
            <Input
              id="period-order"
              type="number"
              min={1}
              max={30}
              value={sequenceNo}
              onChange={(event) => setSequenceNo(Number(event.target.value))}
              required
            />
          </Field>
          <Field
            label="Starts at"
            htmlFor="period-start"
            required
            error={errors.startsAt?.[0]}
          >
            <Input
              id="period-start"
              type="time"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Ends at"
            htmlFor="period-end"
            required
            error={errors.endsAt?.[0]}
          >
            <Input
              id="period-end"
              type="time"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
              required
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded text-brand-600"
            checked={isBreak}
            onChange={(event) => setIsBreak(event.target.checked)}
          />
          This period is a break (lunch, assembly) and holds no lessons
        </label>
      </form>
    </Dialog>
  );
}

function RoomDialog({
  room,
  onClose,
  onSaved,
}: {
  room?: RoomRecord;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const schoolId = useSchoolId();
  const [code, setCode] = useState(room?.code ?? "");
  const [name, setName] = useState(room?.name ?? "");
  const [capacity, setCapacity] = useState(room?.capacity?.toString() ?? "");
  const [status, setStatus] = useState<RoomRecord["status"]>(
    room?.status ?? "active",
  );
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        code,
        name,
        capacity: capacity === "" ? null : Number(capacity),
        status,
      };
      return room
        ? updateRoom(schoolId, room.id, payload)
        : createRoom(schoolId, payload);
    },
    onSuccess: onSaved,
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
      title={room ? `Edit ${room.name}` : "New room"}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button form="room-form" type="submit" loading={mutation.isPending}>
            {room ? "Save changes" : "Create room"}
          </Button>
        </>
      }
    >
      <form id="room-form" className="space-y-4" onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            htmlFor="room-code"
            required
            error={errors.code?.[0]}
          >
            <Input
              id="room-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="R-101"
              required
            />
          </Field>
          <Field
            label="Name"
            htmlFor="room-name"
            required
            error={errors.name?.[0]}
          >
            <Input
              id="room-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Room 101"
              required
            />
          </Field>
          <Field
            label="Capacity"
            htmlFor="room-capacity"
            error={errors.capacity?.[0]}
          >
            <Input
              id="room-capacity"
              type="number"
              min={0}
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </Field>
          <Field label="Status" htmlFor="room-status">
            <Select
              id="room-status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as RoomRecord["status"])
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
