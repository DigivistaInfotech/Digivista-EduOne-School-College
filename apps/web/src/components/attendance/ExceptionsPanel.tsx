import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { StaffAttendanceException } from '@erp/shared';
import { useAuth } from '../../auth/AuthContext';
import {
  listStaffAttendanceExceptions,
  requestStaffAttendanceException,
  reviewStaffAttendanceException,
} from '../../lib/endpoints';
import { errorMessage } from '../../lib/api';
import { formatClock, formatDate } from '../../lib/format';
import { Dialog } from '../Dialog';
import { useToast } from '../ToastProvider';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  Select,
  TableSkeleton,
  Textarea,
} from '../ui';

const EXCEPTION_TYPES = [
  { value: 'gps_failure', label: 'GPS / Location Hardware Failure' },
  { value: 'camera_failure', label: 'Camera / Video Hardware Failure' },
  { value: 'face_mismatch', label: 'Facial Biometric Match Failure' },
  { value: 'approved_offsite_duty', label: 'Approved Off-site Duty / Excursion' },
  { value: 'device_unavailable', label: 'Personal Device Broken / Unavailable' },
  { value: 'missed_punch_in', label: 'Missed Punch-In' },
  { value: 'missed_punch_out', label: 'Missed Punch-Out' },
  { value: 'other', label: 'Other Operational Exception' },
] as const;

export function ExceptionsPanel({ schoolId }: { schoolId: string }): ReactNode {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();

  const canApprove = can('hr.attendance.approve');

  const [statusFilter, setStatusFilter] = useState('');
  const [showRequestDialog, setShowRequestDialog] = useState(false);
  const [reviewItem, setReviewItem] = useState<StaffAttendanceException | null>(null);

  const exceptionsQuery = useQuery({
    queryKey: ['staff-attendance-exceptions', schoolId, statusFilter],
    queryFn: () => listStaffAttendanceExceptions(schoolId, statusFilter || undefined),
  });

  const requestMutation = useMutation({
    mutationFn: (body: Parameters<typeof requestStaffAttendanceException>[1]) =>
      requestStaffAttendanceException(schoolId, body),
    onSuccess: (data: any) => {
      toast.notify('success', data.message || 'Exception request submitted for review.');
      setShowRequestDialog(false);
      void queryClient.invalidateQueries({ queryKey: ['staff-attendance-exceptions', schoolId] });
    },
    onError: (err) => {
      toast.notify('error', errorMessage(err));
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (input: { id: string; status: 'approved' | 'rejected'; reviewNotes: string }) =>
      reviewStaffAttendanceException(schoolId, input.id, {
        status: input.status,
        reviewNotes: input.reviewNotes,
      }),
    onSuccess: (data: any) => {
      toast.notify(
        'success',
        data.message || `Attendance exception ${data.decision || 'reviewed'}.`,
      );
      setReviewItem(null);
      void queryClient.invalidateQueries({ queryKey: ['staff-attendance-exceptions', schoolId] });
      void queryClient.invalidateQueries({ queryKey: ['staff-attendance', schoolId] });
      void queryClient.invalidateQueries({ queryKey: ['staff-punch-status', schoolId] });
    },
    onError: (err) => {
      toast.notify('error', errorMessage(err));
    },
  });

  const items = exceptionsQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Attendance Exceptions & Manual Fallbacks"
          description="Operational fallback queue for staff encountering hardware malfunction, GPS shielding or authorised off-site duties. Segregated four-eyes supervisory review prevents self-approval."
          actions={
            <div className="flex flex-wrap gap-2">
              <Select
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-36"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </Select>
              <Button onClick={() => setShowRequestDialog(true)}>
                <Icon name="plus" className="h-4 w-4" />
                Request Exception
              </Button>
            </div>
          }
        />

        {exceptionsQuery.isPending ? (
          <TableSkeleton rows={4} columns={7} />
        ) : exceptionsQuery.isError ? (
          <ErrorState
            message={errorMessage(exceptionsQuery.error)}
            onRetry={() => void exceptionsQuery.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No exceptions found"
            description="No attendance exceptions match the current filter."
            icon="calendar"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Work Date</th>
                  <th>Employee</th>
                  <th>Exception Type</th>
                  <th>Requested Punches</th>
                  <th>Reason & Document</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((ex) => {
                  const isPending = ex.status === 'pending';
                  const isApproved = ex.status === 'approved';
                  const tone: 'warning' | 'success' | 'danger' = isPending
                    ? 'warning'
                    : isApproved
                    ? 'success'
                    : 'danger';

                  const staffName =
                    ex.firstName && ex.lastName
                      ? `${ex.firstName} ${ex.lastName}`
                      : ex.staffName || ex.employeeNumber || 'Staff Member';

                  return (
                    <tr key={ex.id}>
                      <td className="font-mono text-xs text-slate-800">{formatDate(ex.workDate)}</td>
                      <td>
                        <span className="font-medium text-slate-800">{staffName}</span>
                      </td>
                      <td>
                        <span className="text-xs text-slate-700 capitalize">
                          {ex.exceptionType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="text-xs text-slate-600">
                        {ex.requestedPunchIn ? formatClock(ex.requestedPunchIn) : '—'}
                        {' → '}
                        {ex.requestedPunchOut ? formatClock(ex.requestedPunchOut) : '—'}
                      </td>
                      <td className="max-w-xs text-xs">
                        <p className="text-slate-800 truncate" title={ex.reason}>
                          {ex.reason}
                        </p>
                        {ex.supportingDocumentName && (
                          <div className="flex items-center gap-1 text-slate-500 mt-0.5">
                            <Icon name="paperclip" className="h-3 w-3" />
                            <span className="truncate">{ex.supportingDocumentName}</span>
                          </div>
                        )}
                        {ex.reviewNotes && (
                          <p className="text-slate-500 italic mt-1 border-t border-slate-100 pt-1">
                            Review: {ex.reviewNotes}
                          </p>
                        )}
                      </td>
                      <td>
                        <Badge tone={tone}>{ex.status}</Badge>
                      </td>
                      <td className="text-right">
                        {isPending && canApprove && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setReviewItem(ex)}
                          >
                            Review
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showRequestDialog && (
        <RequestExceptionDialog
          saving={requestMutation.isPending}
          onClose={() => setShowRequestDialog(false)}
          onSave={(body) => requestMutation.mutate(body)}
        />
      )}

      {reviewItem && (
        <ReviewExceptionDialog
          exception={reviewItem}
          currentUserId={user?.id}
          saving={reviewMutation.isPending}
          onClose={() => setReviewItem(null)}
          onReview={(status, reviewNotes) =>
            reviewMutation.mutate({ id: reviewItem.id, status, reviewNotes })
          }
        />
      )}
    </div>
  );
}

function RequestExceptionDialog({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof requestStaffAttendanceException>[1]) => void;
}): ReactNode {
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exceptionType, setExceptionType] = useState('gps_failure');
  const [requestedPunchIn, setRequestedPunchIn] = useState('');
  const [requestedPunchOut, setRequestedPunchOut] = useState('');
  const [reason, setReason] = useState('');
  const [supportingDocumentName, setSupportingDoc] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave({
      workDate,
      exceptionType,
      requestedPunchIn: requestedPunchIn ? new Date(requestedPunchIn).toISOString() : null,
      requestedPunchOut: requestedPunchOut ? new Date(requestedPunchOut).toISOString() : null,
      reason: reason.trim(),
      supportingDocumentName: supportingDocumentName.trim() || null,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Request Attendance Exception"
      description="Submit a verified attendance claim when GPS or camera verification was prevented by hardware or off-site conditions."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="req-exception-form" loading={saving}>
            Submit Request
          </Button>
        </>
      }
    >
      <form id="req-exception-form" className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work Date" htmlFor="ex-date" required>
            <Input
              id="ex-date"
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              required
            />
          </Field>
          <Field label="Exception Type" htmlFor="ex-type" required>
            <Select
              id="ex-type"
              value={exceptionType}
              onChange={(e) => setExceptionType(e.target.value)}
              required
            >
              {EXCEPTION_TYPES.map((et) => (
                <option key={et.value} value={et.value}>
                  {et.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Actual Punch In" htmlFor="ex-pin">
            <Input
              id="ex-pin"
              type="datetime-local"
              value={requestedPunchIn}
              onChange={(e) => setRequestedPunchIn(e.target.value)}
            />
          </Field>
          <Field label="Actual Punch Out" htmlFor="ex-pout">
            <Input
              id="ex-pout"
              type="datetime-local"
              value={requestedPunchOut}
              onChange={(e) => setRequestedPunchOut(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Reason & Justification" htmlFor="ex-reason" required>
          <Textarea
            id="ex-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Detailed explanation of reason (e.g. mobile GPS failure, CBSE science workshop duty at offsite venue)..."
            required
            minLength={10}
            maxLength={600}
          />
        </Field>

        <Field label="Supporting Document (Optional)" htmlFor="ex-doc">
          <Input
            id="ex-doc"
            value={supportingDocumentName}
            onChange={(e) => setSupportingDoc(e.target.value)}
            placeholder="e.g. Deputation_Order_CBSE.pdf"
          />
        </Field>
      </form>
    </Dialog>
  );
}

function ReviewExceptionDialog({
  exception,
  currentUserId,
  saving,
  onClose,
  onReview,
}: {
  exception: StaffAttendanceException;
  currentUserId?: string;
  saving: boolean;
  onClose: () => void;
  onReview: (status: 'approved' | 'rejected', notes: string) => void;
}): ReactNode {
  const [notes, setNotes] = useState('');
  const isSelf = currentUserId && exception.requestedBy === currentUserId;

  const staffName =
    exception.firstName && exception.lastName
      ? `${exception.firstName} ${exception.lastName}`
      : exception.staffName || exception.employeeNumber || 'Staff Member';

  return (
    <Dialog
      open
      onClose={onClose}
      title="Review Staff Attendance Exception"
      description={`Work Date: ${formatDate(exception.workDate)} · Requester: ${staffName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => onReview('rejected', notes.trim() || 'Rejected by supervisor.')}
            disabled={saving || Boolean(isSelf)}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            onClick={() => onReview('approved', notes.trim() || 'Approved by supervisor.')}
            disabled={saving || Boolean(isSelf) || !notes.trim()}
          >
            Approve & Update Attendance
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {isSelf && (
          <Alert tone="danger">
            <strong>Segregation of Duties Enforcement:</strong> You cannot approve your own attendance exception. A
            different supervisor or principal must review and approve this record.
          </Alert>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">Exception Category:</span>
            <span className="font-semibold text-slate-800 capitalize">
              {exception.exceptionType.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Requested Punches:</span>
            <span className="font-mono text-slate-800">
              {exception.requestedPunchIn ? formatClock(exception.requestedPunchIn) : '—'}
              {' → '}
              {exception.requestedPunchOut ? formatClock(exception.requestedPunchOut) : '—'}
            </span>
          </div>
          <div className="border-t border-slate-200 pt-1">
            <span className="text-slate-500">Reason:</span>
            <p className="font-medium text-slate-800 mt-0.5">{exception.reason}</p>
          </div>
        </div>

        <Field label="Supervisory Review Notes" htmlFor="rev-notes" required>
          <Textarea
            id="rev-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Document verification notes, rationale for approval/rejection..."
            required
            minLength={5}
            maxLength={400}
          />
        </Field>
      </div>
    </Dialog>
  );
}
