import { useEffect, useRef, useState } from "react";
import type { AttendanceRegisterRow } from "@erp/shared";
import { attendanceFromSpeech } from "../lib/voiceAttendance";
import { Button, Field, Input, Select } from "./ui";
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
export function VoiceAttendance({
  rows,
  onApply,
}: {
  rows: AttendanceRegisterRow[];
  onApply: (id: string, status: "present" | "absent") => void;
}) {
  const [student, setStudent] = useState(rows[0]?.studentId ?? "");
  const [lang, setLang] = useState("hi-IN");
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const speech = useRef<Recognition | null>(null);
  const engine =
    (window as SpeechWindow).SpeechRecognition ??
    (window as SpeechWindow).webkitSpeechRecognition;
  const proposed = attendanceFromSpeech(transcript);
  const selected = rows.find((r) => r.studentId === student);
  useEffect(
    () => () => {
      if (speech.current) {
        speech.current.onend = null;
        speech.current.onresult = null;
        speech.current.onerror = null;
        speech.current.abort();
      }
    },
    [],
  );
  function start() {
    if (!engine || listening) return;
    setError("");
    setTranscript("");
    const recognition = new engine();
    speech.current = recognition;
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) =>
      setTranscript(e.results[0]?.[0]?.transcript ?? "");
    recognition.onerror = (e) => {
      setError(
        `Voice input unavailable: ${e.error}. Use the normal attendance controls.`,
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError(
        "Microphone could not start. Check browser support and microphone permission.",
      );
    }
  }
  function apply() {
    if (!selected || !proposed || listening) return;
    onApply(selected.studentId, proposed);
    const index = rows.findIndex((r) => r.studentId === student);
    setStudent(rows[index + 1]?.studentId ?? "");
    setTranscript("");
  }
  return (
    <details className="m-4 rounded-xl border border-teal-200 bg-teal-50/30 p-4">
      <summary className="cursor-pointer font-bold">
        Voice attendance · optional test
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm">
          Select the student, say “yes / present” or “no / absent” (हाँ / नहीं),
          review the result and apply it to the draft. Use Save attendance to
          store the register.
        </p>
        <p className="text-xs text-slate-600">
          No paid API key is configured. Browser recognition support varies and
          may use the browser provider’s online speech service. Audio is not
          stored by this application. Start only after agreeing to use that
          service; your browser will request microphone permission.
        </p>
        {!engine && (
          <p role="status">
            Speech recognition is unavailable in this browser. You can test the
            draft parser below, or use a supported browser.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Student for voice mark" htmlFor="voice-student">
            <Select
              id="voice-student"
              value={student}
              onChange={(e) => {
                speech.current?.abort();
                setStudent(e.target.value);
                setTranscript("");
              }}
              disabled={listening}
            >
              <option value="">Select unmarked student</option>
              {rows.map((r) => (
                <option key={r.studentId} value={r.studentId}>
                  {r.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Recognition language" htmlFor="voice-lang">
            <Select
              id="voice-lang"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              disabled={listening}
            >
              <option value="hi-IN">Hindi</option>
              <option value="en-IN">English (India)</option>
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!engine || !selected || listening}
            onClick={start}
          >
            Start microphone
          </Button>
          <Button
            variant="secondary"
            disabled={!listening}
            onClick={() => {
              speech.current?.abort();
              setListening(false);
            }}
          >
            Stop
          </Button>
        </div>
        {listening && <p role="status">Listening for {selected?.fullName}…</p>}
        <Field
          label="Recognised words / test transcript"
          htmlFor="voice-transcript"
        >
          <Input
            id="voice-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            disabled={listening}
            placeholder="yes / no / हाँ / नहीं"
          />
        </Field>
        <p aria-live="polite">
          {transcript
            ? proposed
              ? `Draft proposal: ${selected?.fullName ?? "Select student"} — ${proposed}`
              : "No unambiguous yes/no recognised. Please repeat or use manual controls."
            : "No voice mark proposed."}
        </p>
        {error && <p role="alert">{error}</p>}
        <Button disabled={!selected || !proposed || listening} onClick={apply}>
          Apply reviewed mark to draft & next
        </Button>
      </div>
    </details>
  );
}
