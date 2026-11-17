import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { activityClubInput } from "@erp/shared";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { activityApi } from "../lib/enrichmentApi";
import { errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
} from "../components/ui";

export function ActivitiesPage() {
  const schoolId = useSchoolId();
  const { can, membership } = useAuth();
  const staff = can("learning.manage");
  const client = useQueryClient();
  const [clubSelection, setClubSelection] = useState("");
  const [sessionSelection, setSessionSelection] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const clubs = useQuery({
    queryKey: ["activities", schoolId, "clubs"],
    queryFn: () => activityApi.clubs(schoolId),
  });
  const sessions = useQuery({
    queryKey: ["activities", schoolId, "sessions"],
    queryFn: () => activityApi.sessions(schoolId),
  });
  const club =
    clubs.data?.items.find((item) => item.id === clubSelection) ??
    clubs.data?.items[0];
  const clubSessions =
    sessions.data?.items.filter((item) => item.clubId === club?.id) ?? [];
  const session =
    clubSessions.find((item) => item.id === sessionSelection) ??
    clubSessions[0];
  const students = useQuery({
    queryKey: ["activities", schoolId, "students", search],
    queryFn: () => activityApi.students(schoolId, search),
    enabled: staff,
  });
  const members = useQuery({
    queryKey: ["activities", schoolId, "members", club?.id],
    queryFn: () => activityApi.members(schoolId, club!.id),
    enabled: staff && !!club,
  });
  const participation = useQuery({
    queryKey: ["activities", schoolId, "participation", session?.id],
    queryFn: () => activityApi.participation(schoolId, session!.id),
    enabled: staff && !!session,
  });
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      setNotice("Saved successfully.");
      await client.invalidateQueries({ queryKey: ["activities", schoolId] });
    },
    onError: () => setNotice(""),
  });
  function createClub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = activityClubInput.safeParse({
      code: data.get("code"),
      name: data.get("name"),
      category: data.get("category"),
      maxMembers: Number(data.get("maxMembers")),
      venue: data.get("venue"),
      meetingSchedule: data.get("meetingSchedule"),
    });
    if (!parsed.success) {
      setNotice(parsed.error.issues[0]!.message);
      return;
    }
    action.mutate(() => activityApi.createClub(schoolId, parsed.data));
  }
  const houseTotals = Object.entries(
    (participation.data?.items ?? []).reduce<Record<string, number>>(
      (totals, row) => {
        if (row.status === "present" && row.house)
          totals[row.house] = (totals[row.house] ?? 0) + (row.score ?? 0);
        return totals;
      },
      {},
    ),
  );
  const errors = [
    clubs.error,
    sessions.error,
    students.error,
    members.error,
    participation.error,
  ].filter(Boolean);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Activities Hub"
        description="Sports, GK, arts and clubs in one place. Keep activity attendance separate from the daily school register."
        actions={
          <Link to="/discovery" className="text-sm font-bold text-teal-700">
            Class-wise GK & practice →
          </Link>
        }
      />
      {notice && <Alert tone="info">{notice}</Alert>}
      {action.isError && (
        <Alert tone="danger">{errorMessage(action.error)}</Alert>
      )}
      {errors.length > 0 && (
        <ErrorState
          message={errorMessage(errors[0])}
          onRetry={() =>
            void client.invalidateQueries({
              queryKey: ["activities", schoolId],
            })
          }
        />
      )}
      {clubs.isPending ? (
        <TableSkeleton rows={3} columns={3} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clubs.data?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setClubSelection(item.id);
                setSessionSelection("");
              }}
              className={`rounded-2xl border bg-white p-5 text-left transition hover:shadow-sm ${club?.id === item.id ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}
            >
              <div className="flex justify-between gap-2">
                <h2 className="font-bold">{item.name}</h2>
                <Badge>{item.category}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                {item.meetingSchedule || "Schedule sessions below"} ·{" "}
                {item.venue || "Venue to be set"}
              </p>
              <p className="mt-3 text-xs font-semibold text-teal-700">
                {item.memberCount} / {item.maxMembers} members
              </p>
            </button>
          ))}
        </div>
      )}
      {!clubs.isPending && !clubs.data?.items.length && (
        <EmptyState
          title="Start your first activity club"
          description="Create cricket, GK, debate, arts or other school clubs. Teachers enrol students before taking activity attendance."
        />
      )}
      {staff && (
        <details className="rounded-2xl border border-slate-200 bg-white p-5">
          <summary className="cursor-pointer font-bold">Create a club</summary>
          <form
            onSubmit={createClub}
            className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Field label="Club name" htmlFor="club-name">
              <Input
                id="club-name"
                name="name"
                required
                minLength={2}
                placeholder="Cricket Club / GK Club"
              />
            </Field>
            <Field label="Club code" htmlFor="club-code">
              <Input
                id="club-code"
                name="code"
                required
                minLength={2}
                placeholder="CRICKET-01"
              />
            </Field>
            <Field label="Category" htmlFor="club-category">
              <Select id="club-category" name="category">
                {activityClubInput.shape.category.options.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </Field>
            <Field label="Maximum members" htmlFor="club-capacity">
              <Input
                id="club-capacity"
                name="maxMembers"
                type="number"
                min={1}
                max={500}
                defaultValue={40}
                required
              />
            </Field>
            <Field label="Usual schedule" htmlFor="club-schedule">
              <Input
                id="club-schedule"
                name="meetingSchedule"
                placeholder="Fridays, 3–4 pm"
              />
            </Field>
            <Field label="Venue" htmlFor="club-venue">
              <Input
                id="club-venue"
                name="venue"
                placeholder="School sports ground"
              />
            </Field>
            <div>
              <Button type="submit" loading={action.isPending}>
                Create club
              </Button>
            </div>
          </form>
        </details>
      )}
      {club && (
        <Card>
          <CardHeader
            title={`${club.name} · Activity calendar`}
            description="Dated sessions and house competitions. Times follow your school timezone."
          />
          <div className="space-y-4 p-5">
            {clubSessions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No sessions scheduled yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {clubSessions.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setSessionSelection(item.id)}
                    className={`rounded-xl border p-4 text-left ${session?.id === item.id ? "border-teal-600 bg-teal-50" : "border-slate-200"}`}
                  >
                    <Badge>{item.kind}</Badge>
                    <p className="mt-2 font-bold">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(item.startsAt, membership?.timezone)} –{" "}
                      {formatDateTime(item.endsAt, membership?.timezone)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.venue || club.venue}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {staff && (
              <form
                key={`session:${club.id}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  action.mutate(() =>
                    activityApi.createSession(schoolId, {
                      clubId: club.id,
                      title: String(data.get("title")),
                      kind:
                        data.get("kind") === "competition"
                          ? "competition"
                          : "session",
                      startsAt: new Date(
                        String(data.get("startsAt")),
                      ).toISOString(),
                      endsAt: new Date(
                        String(data.get("endsAt")),
                      ).toISOString(),
                      venue: String(data.get("venue")),
                    }),
                  );
                }}
                className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                <Field
                  label="Session / competition name"
                  htmlFor="session-title"
                >
                  <Input
                    id="session-title"
                    name="title"
                    required
                    minLength={2}
                  />
                </Field>
                <Field label="Activity type" htmlFor="session-kind">
                  <Select id="session-kind" name="kind">
                    <option value="session">Club session</option>
                    <option value="competition">House competition</option>
                  </Select>
                </Field>
                <Field label="Venue" htmlFor="session-venue">
                  <Input
                    id="session-venue"
                    name="venue"
                    defaultValue={club.venue}
                  />
                </Field>
                <Field
                  label="Starts (your device time)"
                  htmlFor="session-start"
                >
                  <Input
                    id="session-start"
                    name="startsAt"
                    type="datetime-local"
                    required
                  />
                </Field>
                <Field label="Ends (your device time)" htmlFor="session-end">
                  <Input
                    id="session-end"
                    name="endsAt"
                    type="datetime-local"
                    required
                  />
                </Field>
                <div className="self-end">
                  <Button type="submit" loading={action.isPending}>
                    Schedule activity
                  </Button>
                </div>
              </form>
            )}
          </div>
        </Card>
      )}
      {staff && club && (
        <Card>
          <CardHeader
            title="Club enrolment"
            description="Only students within your authorised sections are available. Search to find students beyond the first 200 results."
          />
          <div className="space-y-4 p-5">
            <Field label="Find a student" htmlFor="activity-search">
              <Input
                id="activity-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or admission number"
              />
            </Field>
            <form
              key={`enrol:${club.id}:${search}`}
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                action.mutate(() =>
                  activityApi.enrol(
                    schoolId,
                    club.id,
                    String(data.get("studentId")),
                  ),
                );
              }}
            >
              <div className="min-w-64 flex-1">
                <Field label="Student" htmlFor="activity-student">
                  <Select id="activity-student" name="studentId" required>
                    <option value="">Choose student</option>
                    {students.data?.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.className}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit" loading={action.isPending}>
                Enrol student
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {members.data?.items.map((item) => (
                <Badge key={item.studentId}>{item.name}</Badge>
              ))}
            </div>
          </div>
        </Card>
      )}
      {staff && session && (
        <Card>
          <CardHeader
            title={`${session.title} · Attendance & achievements`}
            description="Record present, absent or excused. Add house, score and rank for competitions. Issuing a certificate locks that student's activity record."
          />
          <div className="space-y-4 p-5">
            <form
              key={`attendance:${session.id}`}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                action.mutate(() =>
                  activityApi.record(schoolId, session.id, {
                    studentId: String(data.get("studentId")),
                    status: data.get("status") as
                      "present" | "absent" | "excused",
                    house: String(data.get("house")),
                    score: data.get("score") ? Number(data.get("score")) : null,
                    rank: data.get("rank") ? Number(data.get("rank")) : null,
                    achievement: String(data.get("achievement")),
                  }),
                );
              }}
            >
              <Field label="Club member" htmlFor="participation-student">
                <Select id="participation-student" name="studentId" required>
                  <option value="">Choose member</option>
                  {members.data?.items.map((item) => (
                    <option key={item.studentId} value={item.studentId}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Attendance" htmlFor="participation-status">
                <Select id="participation-status" name="status">
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="excused">Excused</option>
                </Select>
              </Field>
              <Field label="House" htmlFor="participation-house">
                <Input
                  id="participation-house"
                  name="house"
                  maxLength={60}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Score" htmlFor="participation-score">
                <Input
                  id="participation-score"
                  name="score"
                  type="number"
                  min={0}
                  max={100000}
                  step="0.01"
                />
              </Field>
              <Field label="Rank" htmlFor="participation-rank">
                <Input
                  id="participation-rank"
                  name="rank"
                  type="number"
                  min={1}
                  max={10000}
                />
              </Field>
              <Field label="Achievement" htmlFor="participation-achievement">
                <Input
                  id="participation-achievement"
                  name="achievement"
                  maxLength={500}
                />
              </Field>
              <div>
                <Button type="submit" loading={action.isPending}>
                  Save activity record
                </Button>
              </div>
            </form>
            {!!houseTotals.length && (
              <div className="flex flex-wrap gap-2">
                {houseTotals
                  .sort((a, b) => b[1] - a[1])
                  .map(([house, total]) => (
                    <Badge key={house}>
                      {house}: {total} points in visible records
                    </Badge>
                  ))}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Attendance</th>
                    <th>House / score</th>
                    <th>Achievement</th>
                    <th>Certificate</th>
                  </tr>
                </thead>
                <tbody>
                  {participation.data?.items.map((row) => (
                    <tr key={row.id}>
                      <td>{row.studentName}</td>
                      <td>{row.status}</td>
                      <td>
                        {row.house || "—"} · {row.score ?? "—"}
                        {row.rank ? ` · Rank ${row.rank}` : ""}
                      </td>
                      <td>{row.achievement || "—"}</td>
                      <td>
                        {row.certificateId ? (
                          <a
                            href={activityApi.certificateUrl(
                              schoolId,
                              row.certificateId,
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-teal-700"
                          >
                            Print certificate
                          </a>
                        ) : row.status === "present" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate(() =>
                                activityApi.certificate(schoolId, row.id),
                              )
                            }
                          >
                            Issue certificate
                          </Button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
