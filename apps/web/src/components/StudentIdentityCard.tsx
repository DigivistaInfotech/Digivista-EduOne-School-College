import type { StudentDetail } from "@erp/shared";
import { useAuth } from "../auth/AuthContext";
import { Dialog } from "./Dialog";
import { Button } from "./ui";
export function StudentIdentityCard({
  student,
  onClose,
}: {
  student: StudentDetail;
  onClose: () => void;
}) {
  const { membership } = useAuth();
  const enrollment = student.enrollments.find(
    (e) => e.enrollmentStatus === "active",
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Student identity card"
      description="Generated from the central student profile. Update the profile to correct card information."
      footer={
        <Button onClick={() => window.print()}>Print identity card</Button>
      }
    >
      <style>{`@media print { body * {visibility:hidden} .student-id-card,.student-id-card * {visibility:visible} .student-id-card {position:absolute;left:0;top:0;width:90mm;box-shadow:none} }`}</style>
      <article className="student-id-card rounded-2xl border-2 border-teal-700 bg-white p-5">
        <h2 className="font-bold text-teal-800">{membership?.schoolName}</h2>
        <p className="text-xs uppercase tracking-wider">Student identity</p>
        <h3 className="mt-5 text-xl font-bold">
          {[student.firstName, student.middleName, student.lastName]
            .filter(Boolean)
            .join(" ")}
        </h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt>Permanent admission / identity number</dt>
            <dd className="font-mono font-bold">{student.admissionNumber}</dd>
          </div>
          <div>
            <dt>Class / section / year</dt>
            <dd>
              {enrollment
                ? `${enrollment.className} · ${enrollment.sectionName} · ${enrollment.academicYearName}`
                : "No active enrollment"}
            </dd>
          </div>
          <div>
            <dt>Blood group</dt>
            <dd>{student.bloodGroup ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt>Emergency contact</dt>
            <dd>{student.emergencyContact ?? "Not recorded"}</dd>
          </div>
        </dl>
        <p className="mt-4 break-all text-[10px] text-slate-500">
          Central student reference: {student.id}
        </p>
        <p className="mt-2 text-xs">
          Status: {student.status}. This card is an identity display and grants
          no application access.
        </p>
      </article>
    </Dialog>
  );
}
