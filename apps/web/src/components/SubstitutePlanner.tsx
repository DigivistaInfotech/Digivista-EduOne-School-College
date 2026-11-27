import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TimetableData } from "@erp/shared";
import { useSchoolId } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { Button, Card, Field, Input, Select } from "./ui";
interface Candidate {
  userId: string;
  displayName: string;
  eligible: boolean;
  weeklyPeriods: number;
  maxWeeklyPeriods: number | null;
  reasons: string[];
}
export function SubstitutePlanner({
  data,
  initialSlotId = "",
  onCountChange,
}: {
  data: TimetableData | undefined;
  initialSlotId?: string;
  onCountChange?: (count: number) => void;
}) {
  const school = useSchoolId();
  const qc = useQueryClient();
  const [date, setDate] = useState(() => initialSlotId ? nextWeekdayDate(data?.slots.find((item) => item.id === initialSlotId)?.dayOfWeek ?? 1) : indiaToday());
  const [slot, setSlot] = useState(initialSlotId);
  const [teacher, setTeacher] = useState("");
  const [reason, setReason] = useState("");
  const slots = (data?.slots ?? []).filter(
    (s) => s.dayOfWeek === (new Date(date + "T12:00:00").getDay() || 7),
  );
  const candidates = useQuery({
    queryKey: ["substitute-candidates", school, slot, date],
    queryFn: () =>
      api<{ items: Candidate[];originalTeacherName:string;originalAttendanceStatus:string|null;originalApprovedLeave:boolean }>(
        `/api/schools/${school}/timetable/substitution-candidates?slotId=${slot}&date=${date}`,
      ),
    enabled: !!slot && !!date && slots.some((s) => s.id === slot),
  });
  const assigned = useQuery({
    queryKey: ["substitutions", school, date],
    queryFn: () =>
      api<{
        items: Array<{
          id: string;
          period_name: string;
          section_name: string;
          subject_name: string;
          original_teacher_name: string;
          substitute_teacher_name: string;
          reason: string;
        }>;
      }>(`/api/schools/${school}/timetable/substitutions?date=${date}`),
    enabled: !!date,
  });
  useEffect(() => onCountChange?.(assigned.data?.items.length ?? 0), [assigned.data?.items.length, onCountChange]);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/schools/${school}/timetable/substitutions`, {
        method: "POST",
        body: JSON.stringify({
          slotId: slot,
          substitutionDate: date,
          substituteTeacherUserId: teacher,
          reason,
        }),
      }),
    onSuccess: () => {
      setTeacher("");
      setReason("");
      void qc.invalidateQueries({ queryKey: ["substitute-candidates"] });
      void qc.invalidateQueries({ queryKey: ["substitutions"] });
    },
  });
  return (
    <Card>
      <div
        className="space-y-4 p-5"
        role="region"
        aria-label="Teacher replacement planner"
      >
        <h2 className="text-lg font-bold">Teacher replacement</h2>
        <p className="text-sm text-slate-600">
          Choose the absent teacher’s lesson. Recommendations check verified
          subject and grade eligibility, recorded absence / approved leave,
          overlapping lessons and the weekly workload limit. Confirm
          availability when attendance is unmarked.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Replacement date" htmlFor="sub-date">
            <Input
              id="sub-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSlot("");
                setTeacher("");
              }}
            />
          </Field>
          <Field label="Lesson in selected section" htmlFor="sub-slot">
            <Select
              id="sub-slot"
              value={slot}
              onChange={(e) => {
                setSlot(e.target.value);
                setTeacher("");
              }}
            >
              <option value="">Select lesson</option>
              {slots.map((s) => (
                <option value={s.id} key={s.id}>
                  {data?.periods.find((p) => p.id === s.periodId)?.name} ·{" "}
                  {s.subjectName} · {s.teacherName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!slots.length && (
          <p>No scheduled lessons for this section and date.</p>
        )}
        {candidates.isFetching && <p>Checking available teachers…</p>}
      {candidates.data&&<p className={`rounded-xl p-3 text-sm ${candidates.data.originalApprovedLeave || ["absent", "leave", "half_day"].includes(candidates.data.originalAttendanceStatus ?? "") ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"}`}>{candidates.data.originalApprovedLeave || ["absent", "leave", "half_day"].includes(candidates.data.originalAttendanceStatus ?? "") ? "Cover needed · " : "Original teacher · "}<strong>{candidates.data.originalTeacherName}</strong> · {candidates.data.originalApprovedLeave?'Approved leave':candidates.data.originalAttendanceStatus??'Attendance not recorded — confirm absence / cover reason'}</p>}
        {candidates.data && (
          <>
            {!candidates.data.items.some((c) => c.eligible) && (
              <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">
                No eligible replacement is currently available. Review verified
                subject qualifications, availability and workload with the
                coordinator.
              </p>
            )}
            <Field label="Available replacement" htmlFor="sub-teacher">
              <Select
                id="sub-teacher"
                value={teacher}
                onChange={(e) => setTeacher(e.target.value)}
              >
                <option value="">Select eligible teacher</option>
                {candidates.data.items
                  .filter((c) => c.eligible)
                  .map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.displayName} · {c.weeklyPeriods}/{c.maxWeeklyPeriods}{" "}
                      weekly periods
                    </option>
                  ))}
              </Select>
            </Field>
            <ul className="space-y-1 text-sm">
              {candidates.data.items.map((c) => (
                <li
                  key={c.userId}
                  className={c.eligible ? "text-teal-700" : "text-slate-500"}
                >
                  {c.displayName}: {c.eligible ? "Eligible. " : ""}
                  {c.reasons.join("; ")}
                </li>
              ))}
            </ul>
            {!candidates.data.items.length && (
              <p>
                No replacement teachers found. Check active staff accounts,
                teacher roles and verified subject eligibility.
              </p>
            )}
            <Field label="Reason / handover instructions" htmlFor="sub-reason">
              <Input
                id="sub-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
              />
            </Field>
            <Button
              disabled={!teacher || reason.trim().length < 3 || save.isPending}
              onClick={() => save.mutate()}
            >
              Assign replacement
            </Button>
            <p className="text-xs text-slate-500">
              Assignment updates the dated lesson record. It does not grant new
              user roles or permanent section access.
            </p>
          </>
        )}
        {(candidates.error || save.error || assigned.error) && (
          <p role="alert" className="text-rose-700">
            {errorMessage(candidates.error || save.error || assigned.error)}
          </p>
        )}
        {save.isSuccess && <p role="status">Replacement assigned.</p>}
        <h3 className="font-semibold">Assigned replacements for this date</h3>
        {assigned.data?.items.map((x) => (
          <p key={x.id} className="rounded-xl bg-slate-50 p-3 text-sm">
            {x.period_name} · {x.section_name} · {x.subject_name}:{" "}
            {x.original_teacher_name} → {x.substitute_teacher_name}. {x.reason}
          </p>
        ))}
        {assigned.data?.items.length === 0 && (
          <p className="text-sm text-slate-500">No replacements assigned.</p>
        )}
      </div>
    </Card>
  );
}

function indiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function nextWeekdayDate(dayOfWeek: number): string {
  const [year, month, day] = indiaToday().split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const todayWeekday = next.getUTCDay() || 7;
  next.setUTCDate(next.getUTCDate() + ((dayOfWeek - todayWeekday + 7) % 7));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}
