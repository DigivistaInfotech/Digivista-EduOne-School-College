export function attendanceFromSpeech(
  text: string,
): "present" | "absent" | null {
  const words = text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[.,!?।]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.some((w) => ["not", "don't", "dont"].includes(w))) return null;
  const present = words.some((w) =>
    ["yes", "present", "हाँ", "हां", "जी", "उपस्थित"].includes(w),
  );
  const absent = words.some((w) =>
    ["no", "absent", "नहीं", "नही", "अनुपस्थित"].includes(w),
  );
  return present === absent ? null : present ? "present" : "absent";
}
