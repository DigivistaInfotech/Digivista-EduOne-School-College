import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  listOfflinePaymentQueue,
  updateOfflinePaymentStatus,
  verifyOfflinePayment,
} from '../../lib/endpoints';
import { errorMessage } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import { useToast } from '../ToastProvider';
import { Dialog } from '../Dialog';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  TableSkeleton,
} from '../ui';

export function OfflineQueuePanel({
  schoolId,
  canVerify,
  onVerified,
}: {
  schoolId: string;
  canVerify: boolean;
  onVerified: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [verifyNotes, setVerifyNotes] = useState('');

  const [statusId, setStatusId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<'unmatched' | 'more_info_needed' | 'rejected'>('unmatched');
  const [statusNotes, setStatusNotes] = useState('');
  const [contactOutcome, setContactOutcome] = useState('');

  const queue = useQuery({
    queryKey: ['offline-payment-queue', schoolId],
    queryFn: () => listOfflinePaymentQueue(schoolId),
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyOfflinePayment(schoolId, verifyId!, { notes: verifyNotes || undefined }),
    onSuccess: (res) => {
      toast.notify('success', `Payment verified and allocated. Receipt #${res.receiptNumber} generated.`);
      setVerifyId(null);
      setVerifyNotes('');
      void queryClient.invalidateQueries({ queryKey: ['offline-payment-queue', schoolId] });
      onVerified();
    },
    onError: (err) => {
      toast.notify('error', errorMessage(err));
    },
  });

  const statusMutation = useMutation({
    mutationFn: () =>
      updateOfflinePaymentStatus(schoolId, statusId!, {
        status: newStatus,
        reviewNotes: statusNotes,
        parentContactOutcome: contactOutcome || undefined,
      }),
    onSuccess: () => {
      toast.notify('info', 'Status updated.');
      setStatusId(null);
      setStatusNotes('');
      setContactOutcome('');
      void queryClient.invalidateQueries({ queryKey: ['offline-payment-queue', schoolId] });
    },
    onError: (err) => {
      toast.notify('error', errorMessage(err));
    },
  });

  return (
    <Card>
      <CardHeader
        title="Offline Payment Verification Queue"
        description="Parents submit offline bank/UPI references. Finance verifies them against bank statements and allocates receipts."
      />
      <div className="p-5">
        {queue.isPending ? (
          <TableSkeleton rows={4} columns={6} />
        ) : queue.isError ? (
          <ErrorState message={errorMessage(queue.error)} onRetry={() => void queue.refetch()} />
        ) : queue.data.items.length === 0 ? (
          <EmptyState
            title="Queue is empty"
            description="No pending offline payment submissions from parents."
            icon="clipboard"
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th className="text-right">Amount</th>
                  <th>Method</th>
                  <th>Reference / UTR</th>
                  <th>Paid on</th>
                  <th>Status</th>
                  <th>Notes</th>
                  {canVerify && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {queue.data.items.map((item: any) => (
                  <tr key={item.id}>
                    <td>
                      <p className="font-bold text-slate-900">{item.studentName}</p>
                      <p className="font-mono text-xs text-slate-500">{item.admissionNumber}</p>
                    </td>
                    <td className="text-xs">
                      {item.className ? `${item.className} · ${item.sectionName}` : '—'}
                    </td>
                    <td className="text-right tabular-nums font-mono font-bold text-slate-900">
                      {formatMoney(item.amount)}
                    </td>
                    <td className="capitalize text-xs">{item.paymentMethod.replace(/_/g, ' ')}</td>
                    <td className="font-mono text-xs font-semibold text-brand-800">
                      {item.referenceNumber}
                      {item.bankName && <p className="text-[11px] text-slate-500">{item.bankName}</p>}
                    </td>
                    <td className="text-xs">{formatDate(item.paymentDate)}</td>
                    <td>
                      <Badge
                        tone={
                          item.status === 'verified'
                            ? 'success'
                            : item.status === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {item.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="text-xs text-slate-600 max-w-44 truncate">
                      {item.reviewNotes ?? item.notes ?? '—'}
                    </td>
                    {canVerify && (
                      <td>
                        {item.status !== 'verified' ? (
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => {
                                setVerifyId(item.id);
                                setVerifyNotes('');
                              }}
                            >
                              Verify
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setStatusId(item.id);
                                setNewStatus('unmatched');
                                setStatusNotes('');
                                setContactOutcome('');
                              }}
                            >
                              Query
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700">Receipt Allocated</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog
        open={verifyId !== null}
        onClose={() => setVerifyId(null)}
        title="Confirm Offline Payment Verification"
        description="Have you verified that the school bank account or cashier received these funds? A receipt and allocation will be generated."
      >
        <div className="space-y-4">
          <Field label="Verification Remarks (Optional)">
            <Input
              value={verifyNotes}
              onChange={(e) => setVerifyNotes(e.target.value)}
              placeholder="e.g. Verified with SBI Statement line #412"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setVerifyId(null)}>
              Cancel
            </Button>
            <Button
              loading={verifyMutation.isPending}
              onClick={() => verifyMutation.mutate()}
            >
              Confirm & Generate Receipt
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={statusId !== null}
        onClose={() => setStatusId(null)}
        title="Update Acknowledgement Status"
        description="Mark record if transaction is not found in the school bank account, or if more information is needed from the parent."
      >
        <div className="space-y-4">
          <Field label="New Status">
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as any)}
              className="field-input"
            >
              <option value="unmatched">Unmatched (Reference not found on statement)</option>
              <option value="more_info_needed">More Info Needed (Request bank slip / UTR)</option>
              <option value="rejected">Rejected (Invalid reference / bounced)</option>
            </select>
          </Field>

          <Field label="Explanation Notes (Visible to parent)">
            <Input
              value={statusNotes}
              onChange={(e) => setStatusNotes(e.target.value)}
              placeholder="e.g. Reference not found on 15 Oct statement. Please confirm date."
            />
          </Field>

          <Field label="Parent Contact Outcome (Optional)">
            <Input
              value={contactOutcome}
              onChange={(e) => setContactOutcome(e.target.value)}
              placeholder="e.g. Called parent on 9876540001, requested revised UTR"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStatusId(null)}>
              Cancel
            </Button>
            <Button
              loading={statusMutation.isPending}
              disabled={statusNotes.length < 3}
              onClick={() => statusMutation.mutate()}
            >
              Update Status
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
