import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  enrichmentQuestionInput,
  type EnrichmentQuestion,
  type EnrichmentQuestionInput,
  type LearnerQuestion,
} from "@erp/shared";
import { useAuth, useSchoolId } from "../auth/AuthContext";
import { discoveryApi } from "../lib/enrichmentApi";
import { errorMessage } from "../lib/api";
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
  Textarea,
} from "../components/ui";

export function DiscoveryPage() {
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const staff = can("learning.manage");
  const client = useQueryClient();
  const [gradeChoice, setGradeChoice] = useState<number>();
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("");
  const scope = useQuery({
    queryKey: ["discovery-scope", schoolId],
    queryFn: () => discoveryApi.questions(schoolId, {}),
  });
  const grade = scope.data?.grades.includes(gradeChoice ?? -1)
    ? gradeChoice
    : scope.data?.grades[0];
  const questions = useQuery({
    queryKey: ["discovery", schoolId, grade, subject, language],
    queryFn: () =>
      discoveryApi.questions(schoolId, { grade, subject, language }),
    enabled: grade !== undefined,
  });
  const publish = useMutation({
    mutationFn: (id: string) => discoveryApi.publish(schoolId, id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["discovery", schoolId] }),
  });
  const error = scope.error ?? questions.error;
  return (
    <div className="space-y-6">
      <PageHeader
        title="GK & Subject Practice"
        description={
          staff
            ? "Build a teacher-reviewed, class-wise question bank. Learners see only published questions for their enrolled classes."
            : "Explore GK and subject questions matched to your enrolled class. Try an answer, then see the model explanation."
        }
        actions={
          staff ? (
            <Link
              to="/paper-builder"
              className="text-sm font-bold text-teal-700"
            >
              Generate a question paper →
            </Link>
          ) : undefined
        }
      />
      <Alert tone="info">
        Current affairs show their source and as-of date. Items older than 30
        days leave the student feed. New content must be added and reviewed by a
        teacher; no automatic news feed is connected.
      </Alert>
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Field
          label={staff ? "Class" : "Your linked class"}
          htmlFor="discovery-grade"
        >
          <Select
            id="discovery-grade"
            value={grade ?? ""}
            onChange={(event) => setGradeChoice(Number(event.target.value))}
          >
            {scope.data?.grades.map((value) => (
              <option key={value} value={value}>
                Class {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" htmlFor="discovery-subject">
          <Input
            id="discovery-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="All subjects, or type GK / Science"
          />
        </Field>
        <Field label="Content language" htmlFor="discovery-language">
          <Select
            id="discovery-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">All languages</option>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </Select>
        </Field>
      </div>
      {error ? (
        <ErrorState
          message={errorMessage(error)}
          onRetry={() => {
            void scope.refetch();
            void questions.refetch();
          }}
        />
      ) : scope.isPending || questions.isFetching ? (
        <TableSkeleton rows={3} columns={2} />
      ) : !questions.data?.items.length ? (
        <EmptyState
          title="No reviewed questions here yet"
          description={
            staff
              ? "Add questions with textbook/chapter references, then review and publish them below."
              : "Your teachers can add and publish GK and subject practice for this class."
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {questions.data.items.map((question) => (
            <Card key={`${schoolId}:${question.id}`}>
              <CardHeader
                title={question.topic}
                description={`Class ${question.grade} · ${question.subject} · ${question.chapter}`}
                actions={<Badge>{question.kind.replaceAll("_", " ")}</Badge>}
              />
              <div className="space-y-4 p-5">
                <p className="whitespace-pre-wrap text-sm font-semibold">
                  {question.question}
                </p>
                <p className="text-xs text-slate-500">
                  Source:{" "}
                  {question.sourceUrl ? (
                    <a
                      href={question.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {question.sourceTitle}
                    </a>
                  ) : (
                    question.sourceTitle
                  )}
                  {question.asOf ? ` · As of ${question.asOf}` : ""}
                  {question.reviewedAt ? " · Teacher reviewed" : ""}
                </p>
                {staff && "status" in question ? (
                  <>
                    <Badge>{question.status}</Badge>
                    {question.options.length > 0 && (
                      <ol className="list-inside list-[upper-alpha] text-sm">
                        {question.options.map((option) => (
                          <li key={option}>{option}</li>
                        ))}
                      </ol>
                    )}
                    <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">
                      <strong>Model answer:</strong> {question.answer}
                    </p>
                    {question.status === "draft" && (
                      <Button
                        variant="review"
                        loading={publish.isPending}
                        onClick={() => publish.mutate(question.id)}
                      >
                        Reviewed · Publish for this class
                      </Button>
                    )}
                  </>
                ) : (
                  <PracticeQuestion question={question} />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {publish.isError && (
        <Alert tone="danger">{errorMessage(publish.error)}</Alert>
      )}
      {staff && grade !== undefined && (
        <QuestionDraftForm
          key={`${schoolId}:${grade}`}
          grade={grade}
          onSaved={() => {
            void client.invalidateQueries({
              queryKey: ["discovery", schoolId],
            });
            void client.invalidateQueries({
              queryKey: ["discovery-scope", schoolId],
            });
          }}
        />
      )}
    </div>
  );
}

function PracticeQuestion({
  question,
}: {
  question: EnrichmentQuestion | LearnerQuestion;
}) {
  const schoolId = useSchoolId();
  const [response, setResponse] = useState("");
  const attempt = useMutation({
    mutationFn: () => discoveryApi.practice(schoolId, question.id, response),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        attempt.mutate();
      }}
    >
      {question.kind === "objective" ? (
        <fieldset className="space-y-2">
          <legend className="sr-only">Choose your answer</legend>
          {question.options.map((option) => (
            <label
              className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm"
              key={option}
            >
              <input
                type="radio"
                name={`answer-${question.id}`}
                value={option}
                checked={response === option}
                onChange={() => {
                  setResponse(option);
                  attempt.reset();
                }}
                required
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <Field label="Your written answer" htmlFor={`answer-${question.id}`}>
          <Textarea
            id={`answer-${question.id}`}
            value={response}
            onChange={(event) => {
              setResponse(event.target.value);
              attempt.reset();
            }}
            required
            maxLength={20000}
          />
        </Field>
      )}
      <Button
        type="submit"
        variant="learning"
        loading={attempt.isPending}
        disabled={!response.trim()}
      >
        Check & learn
      </Button>
      {attempt.isError && (
        <Alert tone="danger">{errorMessage(attempt.error)}</Alert>
      )}
      {attempt.data && (
        <Alert tone={attempt.data.correct === false ? "warning" : "success"}>
          <p>{attempt.data.feedback}</p>
          <p className="mt-2 whitespace-pre-wrap">
            <strong>Model answer:</strong> {attempt.data.modelAnswer}
          </p>
        </Alert>
      )}
    </form>
  );
}

function QuestionDraftForm({
  grade,
  onSaved,
}: {
  grade: number;
  onSaved: () => void;
}) {
  const schoolId = useSchoolId();
  const [draft, setDraft] = useState<EnrichmentQuestionInput>({
    grade,
    subject: "GK",
    chapter: "",
    topic: "",
    kind: "objective",
    question: "",
    answer: "",
    options: [],
    difficulty: "medium",
    sourceTitle: "",
    sourceUrl: null,
    asOf: null,
    currentAffairs: false,
    language: "en",
    status: "draft",
  });
  const [optionsText, setOptionsText] = useState("");
  const [validation, setValidation] = useState("");
  const save = useMutation({
    mutationFn: (input: EnrichmentQuestionInput) =>
      discoveryApi.createQuestion(schoolId, input),
    onSuccess: () => {
      onSaved();
      setDraft({ ...draft, question: "", answer: "", topic: "" });
      setOptionsText("");
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = enrichmentQuestionInput.safeParse({
      ...draft,
      options:
        draft.kind === "objective"
          ? optionsText
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
    });
    if (!parsed.success) {
      setValidation(
        parsed.error.issues.map((issue) => issue.message).join(". "),
      );
      return;
    }
    setValidation("");
    save.mutate(parsed.data);
  }
  return (
    <details className="rounded-2xl border border-slate-200 bg-white p-5">
      <summary className="cursor-pointer font-bold">
        Add a teacher-reviewed question · Class {grade}
      </summary>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <p className="text-xs text-slate-500">
          Record the textbook and chapter, or a source URL for current affairs.
          Save a draft, then use “Reviewed · Publish” after checking the
          question and answer.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Subject" htmlFor="question-subject">
            <Input
              id="question-subject"
              value={draft.subject}
              onChange={(event) =>
                setDraft({ ...draft, subject: event.target.value })
              }
              required
            />
          </Field>
          <Field label="Textbook chapter" htmlFor="question-chapter">
            <Input
              id="question-chapter"
              value={draft.chapter}
              onChange={(event) =>
                setDraft({ ...draft, chapter: event.target.value })
              }
              required
            />
          </Field>
          <Field label="Topic" htmlFor="question-topic">
            <Input
              id="question-topic"
              value={draft.topic}
              onChange={(event) =>
                setDraft({ ...draft, topic: event.target.value })
              }
              required
            />
          </Field>
          <Field label="Question type" htmlFor="question-kind">
            <Select
              id="question-kind"
              value={draft.kind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  kind: event.target.value as EnrichmentQuestionInput["kind"],
                })
              }
            >
              <option value="objective">Objective (multiple choice)</option>
              <option value="short">Short answer</option>
              <option value="long">Long answer</option>
              <option value="very_long">Very long answer</option>
            </Select>
          </Field>
          <Field label="Difficulty" htmlFor="question-difficulty">
            <Select
              id="question-difficulty"
              value={draft.difficulty}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  difficulty: event.target
                    .value as EnrichmentQuestionInput["difficulty"],
                })
              }
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
          <Field label="Question language" htmlFor="question-language">
            <Select
              id="question-language"
              value={draft.language}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  language: event.target.value === "hi" ? "hi" : "en",
                })
              }
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
            </Select>
          </Field>
        </div>
        <Field label="Question" htmlFor="question-text">
          <Textarea
            id="question-text"
            value={draft.question}
            onChange={(event) =>
              setDraft({ ...draft, question: event.target.value })
            }
            required
            minLength={5}
          />
        </Field>
        {draft.kind === "objective" && (
          <Field
            label="Options — one per line, 2–6 options"
            htmlFor="question-options"
          >
            <Textarea
              id="question-options"
              value={optionsText}
              onChange={(event) => setOptionsText(event.target.value)}
              required
            />
          </Field>
        )}
        <Field
          label={
            draft.kind === "objective"
              ? "Correct option — copy the exact option text"
              : "Model answer / marking guidance"
          }
          htmlFor="question-answer"
        >
          <Textarea
            id="question-answer"
            value={draft.answer}
            onChange={(event) =>
              setDraft({ ...draft, answer: event.target.value })
            }
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Textbook / source title" htmlFor="question-source">
            <Input
              id="question-source"
              value={draft.sourceTitle}
              onChange={(event) =>
                setDraft({ ...draft, sourceTitle: event.target.value })
              }
              required
            />
          </Field>
          <Field label="Source URL" htmlFor="question-url">
            <Input
              id="question-url"
              type="url"
              value={draft.sourceUrl ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, sourceUrl: event.target.value || null })
              }
              required={draft.currentAffairs}
            />
          </Field>
          <Field label="Source as-of date" htmlFor="question-asof">
            <Input
              id="question-asof"
              type="date"
              value={draft.asOf ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, asOf: event.target.value || null })
              }
              required={draft.currentAffairs}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.currentAffairs}
            onChange={(event) =>
              setDraft({ ...draft, currentAffairs: event.target.checked })
            }
          />
          Current affairs (source and date required; shown to students for 30
          days)
        </label>
        {validation && <Alert tone="danger">{validation}</Alert>}
        {save.isError && (
          <Alert tone="danger">{errorMessage(save.error)}</Alert>
        )}
        {save.isSuccess && (
          <Alert tone="success">
            Draft saved. Review it in the class question list before publishing.
          </Alert>
        )}
        <Button type="submit" loading={save.isPending}>
          Save question draft
        </Button>
      </form>
    </details>
  );
}
