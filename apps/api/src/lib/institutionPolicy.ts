import { z } from "zod";
import { getPool } from "../db";
export const operatingPolicyInput = z
  .object({
    management: z
      .enum(["government", "government_aided", "private"])
      .default("private"),
    feeCollectionMode: z
      .enum(["central", "assigned_teacher"])
      .default("central"),
    collectionEnabled: z.boolean().default(false),
    attendanceThreshold: z.number().min(1).max(100).default(80),
    lateReviewAfterDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .nullable()
      .default(null),
    absenceReviewAfterDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .nullable()
      .default(null),
    terminationReviewAfterDays: z
      .number()
      .int()
      .min(1)
      .max(730)
      .nullable()
      .default(null),
    lateFineProposalAmount: z.number().min(0).max(100000).default(0),
    absenceFineProposalAmount: z.number().min(0).max(100000).default(0),
    minGradeForFinancialReview: z.number().int().min(9).max(30).default(9),
    effectiveFrom: z.string().date().nullable().default(null),
    authorityReference: z.string().trim().max(1000).default(""),
    sourceUrl: z.union([z.string().url(), z.literal("")]).default(""),
    automaticPenalty: z.literal(false).default(false),
    automaticTermination: z.literal(false).default(false),
  })
  .superRefine((v, ctx) => {
    if (
      v.feeCollectionMode === "assigned_teacher" &&
      v.management === "private"
    )
      ctx.addIssue({
        code: "custom",
        path: ["feeCollectionMode"],
        message: "Private institutions use the central collection desk",
      });
    if (
      (v.collectionEnabled ||
        v.lateFineProposalAmount > 0 ||
        v.absenceFineProposalAmount > 0 ||
        v.terminationReviewAfterDays !== null) &&
      (!v.authorityReference || !v.effectiveFrom)
    )
      ctx.addIssue({
        code: "custom",
        path: ["authorityReference"],
        message: "Authority reference and effective date are required",
      });
  });
export type OperatingPolicy = z.infer<typeof operatingPolicyInput>;
export const DEFAULT_OPERATING_POLICY = operatingPolicyInput.parse({});
export async function getOperatingPolicy(
  school: string,
): Promise<OperatingPolicy> {
  const row = (
    await getPool().query<{ policy: unknown }>(
      "SELECT policy FROM institution_operating_policy WHERE school_id=$1",
      [school],
    )
  ).rows[0];
  if(row)return operatingPolicyInput.parse(row.policy);
  // Bootstrap the institution category from its existing current-state profile.
  const legacy=(await getPool().query<{management:string}>(`SELECT c.config_value->>'management' AS management FROM school_configurations c
    WHERE c.school_id=$1 AND c.status='published' AND c.config_key='student_policy_'||coalesce((SELECT r.config_value->>'stateCode' FROM school_configurations r WHERE r.school_id=$1 AND r.config_key='regional_settings' AND r.status='published' ORDER BY r.version DESC LIMIT 1),'UP') ORDER BY c.version DESC LIMIT 1`,[school])).rows[0];
  return {...DEFAULT_OPERATING_POLICY,management:['government','government_aided','private'].includes(legacy?.management??'')?legacy!.management as OperatingPolicy['management']:'private'};
}
export async function centralManagement(school:string):Promise<OperatingPolicy['management']|null>{
 const row=(await getPool().query<{policy:unknown}>('SELECT policy FROM institution_operating_policy WHERE school_id=$1',[school])).rows[0];
 return row?operatingPolicyInput.parse(row.policy).management:null;
}
