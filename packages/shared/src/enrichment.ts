import { z } from "zod";

export const activityClubInput = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(150),
  category: z.enum([
    "sports",
    "arts",
    "stem",
    "literary",
    "music",
    "dance",
    "robotics",
    "environment",
    "drama",
  ]),
  venue: z.string().trim().max(100).default(""),
  meetingSchedule: z.string().trim().max(150).default(""),
  maxMembers: z.number().int().min(1).max(500).default(40),
});
export const activitySessionInput = z
  .object({
    clubId: z.string().uuid(),
    title: z.string().trim().min(2).max(150),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    kind: z.enum(["session", "competition"]),
    venue: z.string().trim().max(100).default(""),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    message: "End time must follow start time",
    path: ["endsAt"],
  });
export const activityParticipationInput = z.object({
  studentId: z.string().uuid(),
  status: z.enum(["present", "absent", "excused"]),
  house: z.string().trim().max(60).default(""),
  score: z.number().min(0).max(100000).nullable().default(null),
  rank: z.number().int().min(1).max(10000).nullable().default(null),
  achievement: z.string().trim().max(500).default(""),
});
export const enrichmentQuestionInput = z
  .object({
    grade: z.number().int().min(1).max(12),
    subject: z.string().trim().min(2).max(100),
    chapter: z.string().trim().min(1).max(160),
    topic: z.string().trim().min(1).max(160),
    kind: z.enum(["objective", "short", "long", "very_long"]),
    question: z.string().trim().min(5).max(10000),
    answer: z.string().trim().min(1).max(20000),
    options: z.array(z.string().trim().min(1).max(1000)).max(6).default([]),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    sourceTitle: z.string().trim().min(2).max(250),
    sourceUrl: z
      .string()
      .url()
      .max(2000)
      .refine(
        (value) => /^https?:\/\//i.test(value),
        "Use an http or https source URL",
      )
      .nullable()
      .default(null),
    asOf: z.string().date().nullable().default(null),
    currentAffairs: z.boolean().default(false),
    language: z.enum(["en", "hi"]).default("en"),
    status: z.enum(["draft", "published"]).default("draft"),
  })
  .superRefine((value, ctx) => {
    if (
      value.kind === "objective" &&
      (value.options.length < 2 ||
        !value.options.includes(value.answer) ||
        new Set(value.options).size !== value.options.length)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Objective questions need distinct choices and an answer matching one choice",
        path: ["options"],
      });
    }
    if (value.kind !== "objective" && value.options.length)
      ctx.addIssue({
        code: "custom",
        message: "Only objective questions use choices",
        path: ["options"],
      });
    if (value.currentAffairs && (!value.asOf || !value.sourceUrl))
      ctx.addIssue({
        code: "custom",
        message: "Current affairs require a source URL and an as-of date",
        path: ["sourceUrl"],
      });
  });
export const paperBlueprintInput = z
  .object({
    title: z.string().trim().min(2).max(160),
    grade: z.number().int().min(1).max(12),
    subject: z.string().trim().min(2).max(100),
    chapters: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
    language: z.enum(["en", "hi"]).default("en"),
    variantCount: z.number().int().min(1).max(4).default(1),
    durationMinutes: z.number().int().min(5).max(300).default(60),
    sections: z
      .array(
        z.object({
          kind: z.enum(["objective", "short", "long", "very_long"]),
          count: z.number().int().min(1).max(50),
          marksEach: z.number().int().min(1).max(30),
        }),
      )
      .min(1)
      .max(4),
  })
  .refine(
    (value) =>
      new Set(value.sections.map((section) => section.kind)).size ===
      value.sections.length,
    { message: "Use each question type once", path: ["sections"] },
  );

export type ActivityClubInput = z.infer<typeof activityClubInput>;
export type ActivitySessionInput = z.infer<typeof activitySessionInput>;
export type ActivityParticipationInput = z.infer<
  typeof activityParticipationInput
>;
export type EnrichmentQuestionInput = z.infer<typeof enrichmentQuestionInput>;
export type PaperBlueprintInput = z.infer<typeof paperBlueprintInput>;
export interface ActivityClub extends ActivityClubInput {
  id: string;
  memberCount: number;
}
export interface ActivitySession extends ActivitySessionInput {
  id: string;
  clubName: string;
}
export interface ActivityStudent {
  id: string;
  name: string;
  className: string;
  grade: number;
  sectionId: string;
  academicYearId: string;
}
export interface ActivityMember {
  studentId: string;
  name: string;
  academicYearId: string;
  achievements: string | null;
}
export interface ActivityParticipation extends ActivityParticipationInput {
  id: string;
  studentName: string;
  certificateId: string | null;
}
export interface EnrichmentQuestion extends EnrichmentQuestionInput {
  id: string;
  reviewedAt: string | null;
}
export type LearnerQuestion = Omit<EnrichmentQuestion, "answer" | "status">;
export interface PaperQuestion {
  id: string;
  kind: EnrichmentQuestionInput["kind"];
  question: string;
  answer: string;
  options: string[];
  marks: number;
  chapter: string;
  sourceTitle: string;
}
export interface GeneratedPaper {
  id: string;
  title: string;
  grade: number;
  subject: string;
  language: "en" | "hi";
  variant: string;
  totalMarks: number;
  durationMinutes: number;
  questions: PaperQuestion[];
}
