import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSchoolId, useSchoolTimezone } from '../auth/AuthContext';
import { listAuditEvents } from '../lib/endpoints';
import { errorMessage } from '../lib/api';
import { formatDateTime, titleCase } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
} from '../components/ui';

const OUTCOME_TONES = {
  success: 'success',
  denied: 'danger',
  failure: 'warning',
  system: 'info',
} as const;

export function AuditPage(): ReactNode {
  const schoolId = useSchoolId();
  const timeZone = useSchoolTimezone();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const events = useQuery({
    queryKey: ['audit-events', schoolId, page, search, outcome, from, to],
    queryFn: () =>
      listAuditEvents(schoolId, {
        page,
        pageSize: 25,
        search: search.trim() || undefined,
        outcome: outcome || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const totalPages = events.data
    ? Math.max(1, Math.ceil(events.data.total / events.data.pageSize))
    : 1;

  const hasFilters = Boolean(search || outcome || from || to);

  function exportAuditCsv(): void {
    if (!events.data?.items.length) return;
    const headers = ['Timestamp', 'Action', 'Entity', 'Entity ID', 'Outcome', 'Actor', 'Detail'];
    const rows = events.data.items.map((ev) => [
      `"${formatDateTime(ev.occurredAt, timeZone)}"`,
      `"${ev.action}"`,
      `"${ev.entityType}"`,
      `"${ev.entityId ?? ''}"`,
      `"${ev.outcome}"`,
      `"${ev.actorName ?? 'System'}"`,
      `"${(ev.reason ?? ev.summary ?? '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `audit_log_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log & Security Trails"
        description="Append-only authoritative record of system and domain events. Denied attempts are logged with the missing permission code. Sensitive data (passwords, tokens, payment credentials) is strictly redacted."
        actions={
          <Button variant="secondary" onClick={exportAuditCsv} disabled={!events.data?.items.length}>
            <Icon name="download" className="h-4 w-4" />
            Export Audit CSV
          </Button>
        }
      />

      <Card>
        {/* Search & Filter Toolbar */}
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <div className="min-w-56 flex-1">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Search Audit Events</span>
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <Input
                className="!pl-9 !text-xs !min-h-[38px]"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Action, entity, actor or reason..."
                aria-label="Search audit events"
              />
            </div>
          </div>

          <label className="block" htmlFor="audit-outcome">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Outcome</span>
            <Select
              id="audit-outcome"
              className="!w-36 !text-xs !min-h-[38px]"
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Outcomes</option>
              <option value="success">Success</option>
              <option value="denied">Denied (Forbidden)</option>
              <option value="failure">Failure (Error)</option>
              <option value="system">System</option>
            </Select>
          </label>

          <label className="block" htmlFor="audit-from">
            <span className="mb-1 block text-xs font-semibold text-slate-600">From Date</span>
            <Input
              id="audit-from"
              type="date"
              className="!w-36 !text-xs !min-h-[38px]"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>

          <label className="block" htmlFor="audit-to">
            <span className="mb-1 block text-xs font-semibold text-slate-600">To Date</span>
            <Input
              id="audit-to"
              type="date"
              className="!w-36 !text-xs !min-h-[38px]"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setOutcome('');
                setFrom('');
                setTo('');
                setPage(1);
              }}
              className="!min-h-[38px]"
            >
              Clear
            </Button>
          )}
        </div>

        {events.isPending ? (
          <TableSkeleton rows={10} columns={6} />
        ) : events.isError ? (
          <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
        ) : events.data.items.length === 0 ? (
          <EmptyState
            title="No audit events matched"
            description="Try clearing search filters or broadening your date selection."
            icon="shield"
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Outcome</th>
                    <th>Actor</th>
                    <th>Detail / Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {events.data.items.map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(event.occurredAt, timeZone)}
                      </td>
                      <td className="font-mono text-xs font-semibold text-slate-800">{event.action}</td>
                      <td className="text-xs">
                        <span className="font-medium text-slate-700">{titleCase(event.entityType)}</span>
                        {event.entityId && (
                          <span className="block font-mono text-[10px] text-slate-400">
                            {event.entityId.slice(0, 8)}…
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={OUTCOME_TONES[event.outcome]}>{event.outcome}</Badge>
                      </td>
                      <td className="text-xs font-medium text-slate-700">{event.actorName ?? 'System'}</td>
                      <td className="max-w-72 text-xs text-slate-500">
                        {event.reason ?? event.summary ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs font-medium text-slate-600">
              <p>
                Showing {(page - 1) * events.data.pageSize + 1}–
                {Math.min(page * events.data.pageSize, events.data.total)} of {events.data.total} recorded events
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs font-bold text-slate-700 px-1">
                  Page {page} of {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
