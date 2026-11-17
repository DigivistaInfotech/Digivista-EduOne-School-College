/** Stable, namespaced library code derived from the existing central person. */
export function libraryMemberCode(
  kind: "student" | "staff",
  centralNumber: string,
  personId: string,
): string {
  const prefix = kind === "student" ? "STU" : "STF";
  const code = `${prefix}-${centralNumber.trim()}`;
  return centralNumber.trim() && code.length <= 40
    ? code
    : `${prefix}-${personId.replaceAll("-", "")}`;
}
