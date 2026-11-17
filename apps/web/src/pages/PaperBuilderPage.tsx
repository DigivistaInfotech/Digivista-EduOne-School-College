import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { paperBlueprintInput, type PaperBlueprintInput } from "@erp/shared";
import { useSchoolId } from "../auth/AuthContext";
import { discoveryApi } from "../lib/enrichmentApi";
import { errorMessage } from "../lib/api";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
} from "../components/ui";

const kinds = ["objective", "short", "long", "very_long"] as const;
const labels = {
  objective: "Objective",
  short: "Short answer",
  long: "Long answer",
  very_long: "Very long answer",
};

export function PaperBuilderPage() {
  const schoolId = useSchoolId();
  const client = useQueryClient();
  const papers = useQuery({
    queryKey: ["question-papers", schoolId],
    queryFn: () => discoveryApi.papers(schoolId),
  });
  const [sections, setSections] = useState(
    kinds.map((kind, index) => ({
      kind,
      count: index < 2 ? 2 : 1,
      marksEach: [1, 2, 5, 9][index]!,
    })),
  );
  const [validation, setValidation] = useState("");
  const total = sections.reduce(
    (sum, section) => sum + section.count * section.marksEach,
    0,
  );
  const generate = useMutation({
    mutationFn: (input: PaperBlueprintInput) =>
      discoveryApi.generate(schoolId, input),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["question-papers", schoolId] }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = paperBlueprintInput.safeParse({
      title: data.get("title"),
      grade: Number(data.get("grade")),
      subject: data.get("subject"),
      language: data.get("language"),
      chapters: String(data.get("chapters"))
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      durationMinutes: Number(data.get("durationMinutes")),
      variantCount: Number(data.get("variantCount")),
      sections: sections.filter((section) => section.count > 0),
    });
    if (!parsed.success) {
      setValidation(
        parsed.error.issues.map((issue) => issue.message).join(". "),
      );
      return;
    }
    setValidation("");
    generate.mutate(parsed.data);
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Question Paper Builder"
        description="Choose class, subject, textbook chapters and a marks blueprint. Generate up to four distinct sets from your reviewed question bank."
        actions={
          <Link to="/discovery" className="text-sm font-bold text-teal-700">
            Manage question bank →
          </Link>
        }
      />
      <Alert tone="info">
        Only published, teacher-reviewed questions are used. Questions are
        selected from your bank, not invented from an unseen textbook. Papers
        remain staff-only drafts for final teacher review.
      </Alert>
      <Card>
        <CardHeader
          title="Paper blueprint"
          description="Set the count to zero to omit a question type. Marks are calculated from the counts and marks per question."
        />
        <form onSubmit={submit} className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Paper title" htmlFor="paper-title">
              <Input
                id="paper-title"
                name="title"
                required
                minLength={2}
                placeholder="Class 8 · Science · Term 1"
              />
            </Field>
            <Field label="Class" htmlFor="paper-grade">
              <Select id="paper-grade" name="grade" required>
                {papers.data?.grades.map((grade) => (
                  <option key={grade} value={grade}>
                    Class {grade}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Subject (match question bank)"
              htmlFor="paper-subject"
            >
              <Input
                id="paper-subject"
                name="subject"
                required
                placeholder="Science / GK"
              />
            </Field>
            <Field label="Chapters (comma separated)" htmlFor="paper-chapters">
              <Input
                id="paper-chapters"
                name="chapters"
                placeholder="Leave blank for all chapters"
              />
            </Field>
            <Field label="Content language" htmlFor="paper-language">
              <Select id="paper-language" name="language">
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
              </Select>
            </Field>
            <Field label="Duration (minutes)" htmlFor="paper-duration">
              <Input
                id="paper-duration"
                name="durationMinutes"
                type="number"
                min={5}
                max={300}
                defaultValue={60}
                required
              />
            </Field>
            <Field label="Number of sets" htmlFor="paper-variants">
              <Select id="paper-variants" name="variantCount">
                {[1, 2, 3, 4].map((number) => (
                  <option key={number} value={number}>
                    {number}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sections.map((section, index) => (
              <div
                key={section.kind}
                className="space-y-3 rounded-xl border border-slate-200 p-4"
              >
                <h3 className="text-sm font-bold">{labels[section.kind]}</h3>
                <Field label="Questions" htmlFor={`count-${section.kind}`}>
                  <Input
                    id={`count-${section.kind}`}
                    type="number"
                    min={0}
                    max={50}
                    value={section.count}
                    onChange={(event) =>
                      setSections(
                        sections.map((value, i) =>
                          i === index
                            ? { ...value, count: Number(event.target.value) }
                            : value,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Marks each" htmlFor={`marks-${section.kind}`}>
                  <Input
                    id={`marks-${section.kind}`}
                    type="number"
                    min={1}
                    max={30}
                    value={section.marksEach}
                    onChange={(event) =>
                      setSections(
                        sections.map((value, i) =>
                          i === index
                            ? {
                                ...value,
                                marksEach: Number(event.target.value),
                              }
                            : value,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="font-bold">Total: {total} marks per set</p>
            <Button
              type="submit"
              loading={generate.isPending}
              disabled={!papers.data?.grades.length || total === 0}
            >
              Generate paper sets
            </Button>
          </div>
          {validation && <Alert tone="danger">{validation}</Alert>}
          {generate.isError && (
            <Alert tone="danger">{errorMessage(generate.error)}</Alert>
          )}
          {generate.isSuccess && (
            <Alert tone="success">
              Paper sets saved. Review the question paper and answer key before
              use.
            </Alert>
          )}
        </form>
      </Card>
      {papers.isError && (
        <ErrorState
          message={errorMessage(papers.error)}
          onRetry={() => void papers.refetch()}
        />
      )}
      {!papers.isPending && !papers.data?.items.length && (
        <EmptyState
          title="No papers generated yet"
          description="Start by adding and reviewing questions for your class and subject, then generate a paper above."
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {papers.data?.items.map((paper) => (
          <Card key={paper.id}>
            <CardHeader
              title={`${paper.title} · Set ${paper.variant}`}
              description={`Class ${paper.grade} · ${paper.subject} · ${paper.totalMarks} marks · ${paper.durationMinutes} minutes`}
            />
            <div className="flex flex-wrap gap-4 p-5">
              <a
                href={discoveryApi.printUrl(schoolId, paper.id)}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-bold text-teal-700"
              >
                Review / print question paper
              </a>
              <a
                href={discoveryApi.printUrl(schoolId, paper.id, true)}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-bold text-teal-700"
              >
                Staff answer key
              </a>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
