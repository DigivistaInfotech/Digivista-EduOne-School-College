export type StudentStage =
  | "primary_nursery_g2"
  | "elementary_g3_g5"
  | "middle_g6_g8"
  | "senior_g9_g12"
  | "higher_education"
  | "unclassified";
export function studentStage(grade: number | null | undefined): StudentStage {
  if (
    grade === null ||
    grade === undefined ||
    !Number.isInteger(grade) ||
    grade < 0
  )
    return "unclassified";
  if (grade <= 2) return "primary_nursery_g2";
  if (grade <= 5) return "elementary_g3_g5";
  if (grade <= 8) return "middle_g6_g8";
  if (grade <= 12) return "senior_g9_g12";
  return "higher_education";
}
export const STUDENT_STAGE_LABELS: Record<StudentStage, string> = {
  primary_nursery_g2: "Junior learning · Nursery–Class 2",
  elementary_g3_g5: "Junior learning · Classes 3–5",
  middle_g6_g8: "Middle school · Classes 6–8",
  senior_g9_g12: "Senior school · Classes 9–12",
  higher_education: "College / university learning",
  unclassified: "Student learning · class stage not configured",
};
