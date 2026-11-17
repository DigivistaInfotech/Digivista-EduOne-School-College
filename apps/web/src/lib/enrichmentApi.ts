import type {
  ActivityClub,
  ActivityClubInput,
  ActivityMember,
  ActivityParticipation,
  ActivityParticipationInput,
  ActivitySession,
  ActivitySessionInput,
  ActivityStudent,
  EnrichmentQuestion,
  EnrichmentQuestionInput,
  GeneratedPaper,
  LearnerQuestion,
  PaperBlueprintInput,
} from "@erp/shared";
import { api } from "./api";

const base = (schoolId: string) => `/api/schools/${schoolId}`;
const write = <T>(url: string, body: unknown, method = "POST") =>
  api<T>(url, { method, body: JSON.stringify(body) });
export const activityApi = {
  clubs: (id: string) =>
    api<{ items: ActivityClub[] }>(`${base(id)}/activities/clubs`),
  createClub: (id: string, body: ActivityClubInput) =>
    write<{ id: string }>(`${base(id)}/activities/clubs`, body),
  students: (id: string, search: string) =>
    api<{ items: ActivityStudent[] }>(
      `${base(id)}/activities/students?search=${encodeURIComponent(search)}`,
    ),
  members: (id: string, club: string) =>
    api<{ items: ActivityMember[] }>(
      `${base(id)}/activities/clubs/${club}/members`,
    ),
  enrol: (id: string, club: string, studentId: string) =>
    write<{ id: string }>(`${base(id)}/activities/clubs/${club}/members`, {
      studentId,
    }),
  sessions: (id: string) =>
    api<{ items: ActivitySession[] }>(`${base(id)}/activities/sessions`),
  createSession: (id: string, body: ActivitySessionInput) =>
    write<{ id: string }>(`${base(id)}/activities/sessions`, body),
  participation: (id: string, session: string) =>
    api<{ items: ActivityParticipation[] }>(
      `${base(id)}/activities/sessions/${session}/participation`,
    ),
  record: (id: string, session: string, body: ActivityParticipationInput) =>
    write<{ id: string }>(
      `${base(id)}/activities/sessions/${session}/participation`,
      body,
      "PUT",
    ),
  certificate: (id: string, record: string) =>
    write<{ id: string }>(
      `${base(id)}/activities/participation/${record}/certificate`,
      {},
    ),
  certificateUrl: (id: string, certificate: string) =>
    `${base(id)}/activities/certificates/${certificate}/print`,
};
export const discoveryApi = {
  questions: (
    id: string,
    query: {
      grade?: number;
      subject?: string;
      kind?: string;
      language?: string;
    },
  ) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    return api<{
      grades: number[];
      staff: boolean;
      items: Array<EnrichmentQuestion | LearnerQuestion>;
    }>(`${base(id)}/discovery/questions?${params}`);
  },
  createQuestion: (id: string, body: EnrichmentQuestionInput) =>
    write<{ id: string }>(`${base(id)}/discovery/questions`, body),
  publish: (id: string, question: string) =>
    write<{ id: string }>(
      `${base(id)}/discovery/questions/${question}/publish`,
      {},
    ),
  practice: (id: string, question: string, response: string) =>
    write<{ correct: boolean | null; modelAnswer: string; feedback: string }>(
      `${base(id)}/discovery/questions/${question}/practice`,
      { response },
    ),
  papers: (id: string) =>
    api<{ grades: number[]; items: GeneratedPaper[] }>(
      `${base(id)}/discovery/papers`,
    ),
  generate: (id: string, body: PaperBlueprintInput) =>
    write<{ items: GeneratedPaper[] }>(`${base(id)}/discovery/papers`, body),
  printUrl: (id: string, paper: string, answers = false) =>
    `${base(id)}/discovery/papers/${paper}/print?answers=${answers}`,
};
