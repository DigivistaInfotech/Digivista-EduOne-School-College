import { z } from "zod";
import { INDIA_STATES } from "./regional";

export const stateCodeInput = z
  .string()
  .refine(
    (value) => INDIA_STATES.some((state) => state.code === value),
    "Choose a supported Indian state or union territory",
  );
export const studentPolicyInput = z
  .object({
    stateCode: stateCodeInput,
    management: z
      .enum(["government", "private", "government_aided"])
      .default("private"),
    minorityStatus: z.boolean().default(false),
    policyReference: z.string().trim().max(500).default(""),
    admissionRequirements: z
      .array(z.string().trim().min(1).max(250))
      .max(30)
      .default([]),
    feeHeads: z
      .array(
        z.object({
          code: z.string().trim().min(2).max(40),
          name: z.string().trim().min(2).max(120),
          description: z.string().trim().max(500).default(""),
        }),
      )
      .max(100)
      .default([]),
    lateFee: z.object({
      enabled: z.boolean().default(false),
      graceDays: z.number().int().min(0).max(365).default(0),
      percentPerMonth: z.number().min(0).max(100).default(0),
      maxAmount: z.number().min(0).max(99999999).default(0),
    }),
    reviewAfterDays: z.number().int().min(1).max(730).nullable().default(null),
    readmissionInstructions: z.string().trim().max(2000).default(""),
  })
  .refine(
    (value) =>
      new Set(value.feeHeads.map((head) => head.code.toUpperCase())).size ===
      value.feeHeads.length,
    { message: "Fee head codes must be unique", path: ["feeHeads"] },
  );
export type StudentPolicy = z.infer<typeof studentPolicyInput>;
export const defaultStudentPolicy = (stateCode: string): StudentPolicy => ({
  stateCode,
  management: "private",
  minorityStatus: false,
  policyReference: "",
  admissionRequirements: [],
  feeHeads: [],
  lateFee: { enabled: false, graceDays: 0, percentPerMonth: 0, maxAmount: 0 },
  reviewAfterDays: null,
  readmissionInstructions: "",
});
export interface StudentLifecycleReview {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  stateCode: string;
  outstanding: number;
  status: "pending" | "continued" | "withdrawn" | "readmitted";
  grade: number | null;
  createdAt: string;
  decisionNote: string | null;
  policy: StudentPolicy;
}
