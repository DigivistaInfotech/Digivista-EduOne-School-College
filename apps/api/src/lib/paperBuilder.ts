import { randomInt } from "node:crypto";
import type {
  EnrichmentQuestion,
  PaperBlueprintInput,
  PaperQuestion,
} from "@erp/shared";
import { badRequest } from "./errors";

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Selects only supplied, reviewed questions; it never invents missing content. */
export function buildPaperVariants(
  input: PaperBlueprintInput,
  bank: EnrichmentQuestion[],
): PaperQuestion[][] {
  const pools = input.sections.map((section) => {
    const questions = bank.filter((question) => question.kind === section.kind);
    if (questions.length < section.count)
      throw badRequest(
        `Not enough ${section.kind.replaceAll("_", " ")} questions: need ${section.count}, found ${questions.length}`,
      );
    return { ...section, questions };
  });
  const variants: PaperQuestion[][] = [];
  const fingerprints = new Set<string>();
  for (let variant = 0; variant < input.variantCount; variant++) {
    let selected: PaperQuestion[] | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = pools.flatMap((section) =>
        shuffled(section.questions)
          .slice(0, section.count)
          .map((question) => ({
            id: question.id,
            kind: question.kind,
            question: question.question,
            answer: question.answer,
            options: shuffled(question.options),
            marks: section.marksEach,
            chapter: question.chapter,
            sourceTitle: question.sourceTitle,
          })),
      );
      const wording = candidate.map((question) => question.question.trim().toLowerCase().replace(/\s+/g, ' '));
      if (new Set(wording).size !== wording.length) continue;
      const fingerprint = JSON.stringify(
        candidate.map((question) => [question.id, question.options]),
      );
      if (!fingerprints.has(fingerprint)) {
        fingerprints.add(fingerprint);
        selected = candidate;
        break;
      }
    }
    if (!selected)
      throw badRequest(
        "The question bank has too little variety for distinct sets. Add questions or request fewer sets.",
      );
    variants.push(selected);
  }
  return variants;
}
