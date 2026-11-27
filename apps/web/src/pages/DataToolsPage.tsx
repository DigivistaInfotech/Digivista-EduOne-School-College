import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ImportRow, SavedReport } from '@erp/shared';
import { useAuth, useSchoolId } from '../auth/AuthContext';
import {
  cancelImport,
  commitImport,
  createSavedReport,
  deleteSavedReport,
  getImport,
  listAcademicYears,
  listImports,
  listSavedReports,
  listSections,
  previewImport,
  reportExportUrl,
  updateSavedReport,
} from '../lib/endpoints';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Dialog } from '../components/Dialog';
import { Tabs } from '../components/Tabs';
import { useToast } from '../components/ToastProvider';
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
  LinkButton,
  PageHeader,
  Select,
  TableSkeleton,
  Textarea,
} from '../components/ui';

type Tab = 'saved' | 'imports';

const REPORT_TYPES = ['students', 'attendance', 'fees'] as const;
const ENTITY_TYPES = ['library_books', 'vendors', 'academic_years', 'classes', 'sections', 'subjects', 'subject_offerings', 'staff', 'rooms', 'timetable_periods', 'fee_heads', 'institution_masters'] as const;
const IMPORT_TEMPLATES: Record<(typeof ENTITY_TYPES)[number], string> = {
  library_books: '/api/import-templates/library-books-import.csv',
  vendors: '/api/import-templates/vendors-import.csv',
  academic_years: '/api/import-templates/academic-years-import.csv',
  classes: '/api/import-templates/classes-import.csv',
  sections: '/api/import-templates/sections-import.csv',
  subjects: '/api/import-templates/subjects-import.csv',
  subject_offerings: '/api/import-templates/subject-offerings-import.csv',
  staff: '/api/import-templates/staff-import.csv',
  rooms: '/api/import-templates/rooms-import.csv',
  timetable_periods: '/api/import-templates/timetable-periods-import.csv',
  fee_heads: '/api/import-templates/fee-heads-import.csv',
  institution_masters: '/api/import-templates/institution-masters-import.csv',
};
const IMPORT_STATUSES = ['previewed', 'committed', 'cancelled'] as const;

type SavedDialog =
  | { kind: 'saved'; report?: SavedReport }
  | { kind: 'import' }
  | { kind: 'batch'; id: string }
  | null;

export function DataToolsPage(): ReactNode {
  const [searchParams] = useSearchParams();
  const schoolId = useSchoolId();
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const canSaved = can('reports.saved.manage');
  const canImport = can('imports.manage');

  const [tab, setTab] = useState<Tab>(() => searchParams.get('tab') === 'imports' ? 'imports' : 'saved');
  const [importStatus, setImportStatus] = useState('');
  const [importEntity, setImportEntity] = useState('');
  const [dialog, setDialog] = useState<SavedDialog>(() => searchParams.get('tab') === 'imports' && canImport ? { kind: 'import' } : null);
  const [formError, setFormError] = useState('');

  const saved = useQuery({
    queryKey: ['saved-reports', schoolId],
    queryFn: () => listSavedReports(schoolId),
    enabled: canSaved && tab === 'saved',
  });
  const imports = useQuery({
    queryKey: ['imports', schoolId, importStatus, importEntity],
    queryFn: () =>
      listImports(schoolId, {
        status: importStatus || undefined,
        entityType: importEntity || undefined,
      }),
    enabled: canImport && tab === 'imports',
  });
  const years = useQuery({
    queryKey: ['academic-years', schoolId],
    queryFn: () => listAcademicYears(schoolId),
    enabled: canSaved && tab === 'saved',
  });
  const sections = useQuery({
    queryKey: ['sections', schoolId],
    queryFn: () => listSections(schoolId),
    enabled: canSaved && tab === 'saved',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['saved-reports', schoolId] });
    void queryClient.invalidateQueries({ queryKey: ['imports', schoolId] });
    void queryClient.invalidateQueries({ queryKey: ['import', schoolId] });
  };

  const saveSaved = useMutation({
    mutationFn: (input: {
      id?: string;
      body: Parameters<typeof createSavedReport>[1];
    }) =>
      input.id
        ? updateSavedReport(schoolId, input.id, input.body)
        : createSavedReport(schoolId, input.body),
    onSuccess: () => {
      toast.notify('success', 'Saved view saved.');
      setDialog(null);
      invalidate();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const removeSaved = useMutation({
    mutationFn: (id: string) => deleteSavedReport(schoolId, id),
    onSuccess: () => {
      toast.notify('success', 'Saved view deleted.');
      invalidate();
    },
    onError: (error) => toast.notify('error', errorMessage(error)),
  });
  const preview = useMutation({
    mutationFn: (input: Parameters<typeof previewImport>[1]) => previewImport(schoolId, input),
    onSuccess: (result) => {
      toast.notify(
        'success',
        `Preview ready: ${result.validRows} valid, ${result.invalidRows} invalid.`,
      );
      setDialog({ kind: 'batch', id: result.id });
      invalidate();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const commit = useMutation({
    mutationFn: (id: string) => commitImport(schoolId, id),
    onSuccess: (result) => {
      toast.notify('success', `Import committed: ${result.created} records created.`);
      invalidate();
    },
    onError: (error) => toast.notify('error', errorMessage(error)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelImport(schoolId, id),
    onSuccess: () => {
      toast.notify('success', 'Import cancelled.');
      invalidate();
    },
    onError: (error) => toast.notify('error', errorMessage(error)),
  });

  const yearOptions = years.data?.items ?? [];
  const sectionOptions = sections.data?.items ?? [];
  const tabs: Array<{ value: Tab; label: string }> = [
    ...(canSaved ? [{ value: 'saved' as Tab, label: 'Saved report views' }] : []),
    ...(canImport ? [{ value: 'imports' as Tab, label: 'CSV imports' }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saved views & data tools"
        description="Saved views store a name and filters; results and exports are recomputed by the report endpoints. CSV imports are previewed first so every row is validated before anything is written."
        actions={
          <div className="flex flex-wrap gap-2">
            {canSaved && (
              <Button variant="secondary" onClick={() => setDialog({ kind: 'saved' })}>
                <Icon name="plus" className="h-4 w-4" />
                New saved view
              </Button>
            )}
            {canImport && (
              <Button onClick={() => setDialog({ kind: 'import' })}>
                <Icon name="paperclip" className="h-4 w-4" />
                Import CSV
              </Button>
            )}
          </div>
        }
      />

      <Tabs value={tab} onChange={setTab} tabs={tabs} label="Data tools views" />

      {tab === 'saved' && canSaved && (
        <Card>
          <CardHeader
            title="Saved report views"
            description="Shared views are visible to other staff with the saved-reports permission. Downloading runs the current report with the saved filters."
          />
          {saved.isPending ? (
            <TableSkeleton rows={5} columns={5} />
          ) : saved.isError ? (
            <ErrorState message={errorMessage(saved.error)} onRetry={() => void saved.refetch()} />
          ) : (saved.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="No saved views"
              description="Save a set of report filters to reuse them later."
              icon="clipboard"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Report</th>
                    <th>Filters</th>
                    <th>Sharing</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {saved.data!.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <p className="font-medium text-slate-900">{row.name}</p>
                        <p className="text-xs text-slate-500">
                          {row.createdByName ?? 'Unknown'} · {formatDateTime(row.createdAt)}
                        </p>
                      </td>
                      <td>
                        <Badge tone="info">{row.reportType}</Badge>
                      </td>
                      <td className="text-xs text-slate-600">
                        {describeFilters(row, yearOptions, sectionOptions)}
                      </td>
                      <td>
                        <Badge tone={row.shared ? 'success' : 'neutral'}>
                          {row.shared ? 'shared' : 'private'}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-2">
                          <LinkButton
                            size="sm"
                            variant="ghost"
                            href={reportExportUrl(schoolId, row.reportType, {
                              from: row.filters.from,
                              to: row.filters.to,
                              academicYearId: row.filters.academicYearId,
                              sectionId: row.filters.sectionId,
                            })}
                          >
                            Download CSV
                          </LinkButton>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDialog({ kind: 'saved', report: row })}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={removeSaved.isPending}
                            onClick={() => removeSaved.mutate(row.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'imports' && canImport && (
        <Card>
          <CardHeader
            title="Import batches"
            description="Batches stay previewed until they are committed. Commit is all or nothing for the valid rows, and a committed or cancelled batch can never be re-applied."
            actions={
              <div className="flex flex-wrap gap-2">
                <Select
                  aria-label="Filter imports by status"
                  value={importStatus}
                  onChange={(event) => setImportStatus(event.target.value)}
                  className="w-36"
                >
                  <option value="">All statuses</option>
                  {IMPORT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter imports by entity"
                  value={importEntity}
                  onChange={(event) => setImportEntity(event.target.value)}
                  className="w-40"
                >
                  <option value="">All entities</option>
                  {ENTITY_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </div>
            }
          />
          {imports.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : imports.isError ? (
            <ErrorState
              message={errorMessage(imports.error)}
              onRetry={() => void imports.refetch()}
            />
          ) : (imports.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              title="No imports"
              description="Upload a CSV to preview and validate it."
              icon="paperclip"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Entity</th>
                    <th className="text-right">Rows</th>
                    <th className="text-right">Valid</th>
                    <th className="text-right">Invalid</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.data!.items.map((row) => (
                    <tr key={row.id}>
                      <td className="max-w-xs truncate text-sm text-slate-700">{row.filename}</td>
                      <td>
                        <Badge tone="info">{row.entityType}</Badge>
                      </td>
                      <td className="text-right tabular-nums">{row.totalRows}</td>
                      <td className="text-right tabular-nums">{row.validRows}</td>
                      <td className="text-right tabular-nums">{row.invalidRows}</td>
                      <td>
                        <Badge
                          tone={
                            row.status === 'committed'
                              ? 'success'
                              : row.status === 'cancelled'
                                ? 'neutral'
                                : 'warning'
                          }
                        >
                          {row.status}
                        </Badge>
                        {row.status === 'committed' && (
                          <p className="mt-1 text-xs text-slate-500">
                            {row.createdRows} created
                          </p>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDialog({ kind: 'batch', id: row.id })}
                          >
                            Preview
                          </Button>
                          {row.status === 'previewed' && (
                            <>
                              <Button
                                size="sm"
                                loading={commit.isPending}
                                disabled={row.validRows === 0}
                                onClick={() => commit.mutate(row.id)}
                              >
                                Commit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={cancel.isPending}
                                onClick={() => cancel.mutate(row.id)}
                              >
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {dialog?.kind === 'saved' && (
        <SavedViewDialog
          key={dialog.report?.id ?? 'new-saved-view'}
          report={dialog.report}
          years={yearOptions.map((year) => ({ id: year.id, name: year.name }))}
          sections={sectionOptions.map((section) => ({
            id: section.id,
            name: `${section.className} · ${section.name}`,
          }))}
          error={formError}
          saving={saveSaved.isPending}
          onClose={() => {
            setDialog(null);
            setFormError('');
          }}
          onSave={(body) => saveSaved.mutate({ id: dialog.report?.id, body })}
        />
      )}

      {dialog?.kind === 'import' && (
        <ImportDialog
          error={formError}
          saving={preview.isPending}
          onClose={() => {
            setDialog(null);
            setFormError('');
          }}
          onSave={(body) => preview.mutate(body)}
        />
      )}

      {dialog?.kind === 'batch' && (
        <BatchDialog
          schoolId={schoolId}
          batchId={dialog.id}
          canCommit={canImport}
          committing={commit.isPending}
          cancelling={cancel.isPending}
          onCommit={(id) => commit.mutate(id)}
          onCancel={(id) => cancel.mutate(id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function describeFilters(
  report: SavedReport,
  years: Array<{ id: string; name: string }>,
  sections: Array<{ id: string; className: string; name: string }>,
): string {
  const parts: string[] = [];
  if (report.filters.academicYearId) {
    const year = years.find((entry) => entry.id === report.filters.academicYearId);
    parts.push(year ? year.name : 'year');
  }
  if (report.filters.sectionId) {
    const section = sections.find((entry) => entry.id === report.filters.sectionId);
    parts.push(section ? `${section.className} · ${section.name}` : 'section');
  }
  if (report.filters.from) parts.push(`from ${report.filters.from}`);
  if (report.filters.to) parts.push(`to ${report.filters.to}`);
  return parts.length === 0 ? 'No filters' : parts.join(' · ');
}

function SavedViewDialog({
  report,
  years,
  sections,
  error,
  saving,
  onClose,
  onSave,
}: {
  report?: SavedReport;
  years: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string }>;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createSavedReport>[1]) => void;
}): ReactNode {
  const [name, setName] = useState(report?.name ?? '');
  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]>(
    report?.reportType ?? 'students',
  );
  const [academicYearId, setAcademicYearId] = useState(report?.filters.academicYearId ?? '');
  const [sectionId, setSectionId] = useState(report?.filters.sectionId ?? '');
  const [from, setFrom] = useState(report?.filters.from ?? '');
  const [to, setTo] = useState(report?.filters.to ?? '');
  const [shared, setShared] = useState(report?.shared ?? false);

  return (
    <Dialog
      open
      onClose={onClose}
      title={report ? 'Edit saved view' : 'New saved view'}
      description="Only filters supported by the chosen report can be saved; the server rejects anything else."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="saved-view-form" loading={saving}>
            Save view
          </Button>
        </>
      }
    >
      <form
        id="saved-view-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const filters: Record<string, string> = {};
          if (academicYearId) filters.academicYearId = academicYearId;
          if (sectionId) filters.sectionId = sectionId;
          if (reportType === 'attendance') {
            if (from) filters.from = from;
            if (to) filters.to = to;
          }
          onSave({ name, reportType, filters, shared });
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="saved-name" required>
            <Input
              id="saved-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="Report" htmlFor="saved-type" required>
            <Select
              id="saved-type"
              value={reportType}
              onChange={(event) => setReportType(event.target.value as typeof reportType)}
            >
              {REPORT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Academic year" htmlFor="saved-year">
            <Select
              id="saved-year"
              value={academicYearId}
              onChange={(event) => setAcademicYearId(event.target.value)}
            >
              <option value="">All years</option>
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Section" htmlFor="saved-section">
            <Select
              id="saved-section"
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
            >
              <option value="">All sections</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </Select>
          </Field>
          {reportType === 'attendance' && (
            <>
              <Field label="From" htmlFor="saved-from">
                <Input
                  id="saved-from"
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </Field>
              <Field label="To" htmlFor="saved-to">
                <Input
                  id="saved-to"
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </Field>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={shared}
            onChange={(event) => setShared(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Share with other staff who can manage saved views
        </label>
      </form>
    </Dialog>
  );
}

function ImportDialog({
  error,
  saving,
  onClose,
  onSave,
}: {
  error: string;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof previewImport>[1]) => void;
}): ReactNode {
  const [searchParams] = useSearchParams();
  const initialEntity = ENTITY_TYPES.find((value) => value === searchParams.get('entityType')) ?? 'library_books';
  const [entityType, setEntityType] = useState<(typeof ENTITY_TYPES)[number]>(initialEntity);
  const [csv, setCsv] = useState('');
  const [fileError, setFileError] = useState('');

  return (
    <Dialog
      open
      onClose={onClose}
      title="Preview CSV import"
      description="Nothing is written until you commit the preview. Choose a file or paste CSV text."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="import-form" loading={saving} disabled={!csv.trim()}>
            Preview rows
          </Button>
        </>
      }
    >
      <form
        id="import-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ entityType, filename: `${entityType}-import.csv`, csv });
        }}
      >
        {(error || fileError) && <Alert tone="danger">{error || fileError}</Alert>}
        <Field label="Entity" htmlFor="import-entity" required>
          <Select
            id="import-entity"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value as typeof entityType)}
          >
            {ENTITY_TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p>Student admission imports are on the Students page so the complete admission form, guardian links, document checklist and enrollment validation are applied together.</p>
          {entityType === 'library_books' && (
            <p>
              Required column: <code>title</code>. Optional columns include author, isbn,
              category and copies.
            </p>
          )}
          {entityType === 'vendors' && <p>Required column: name.</p>}
          {!['library_books', 'vendors'].includes(entityType) && <p>Use the downloaded sheet headers exactly. Reference columns use school-local codes. Example rows are marked sample_only=yes; replace or remove them before commit. Each row is validated before a transaction commits the batch.</p>}
        </div>
        <a
          className="inline-flex text-sm font-semibold text-teal-700 underline"
          href={IMPORT_TEMPLATES[entityType]}
          download
        >
          Download {entityType.replaceAll('_', ' ')} CSV template
        </a>
        <Field label="CSV or Excel file" htmlFor="import-file" hint="The workbook is converted in your browser; no file is stored on the server.">
          <input
            id="import-file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm text-slate-600"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileError('');
              try {
                setCsv(file.name.toLowerCase().endsWith('.xlsx') ? await readXlsxAsCsv(file) : await file.text());
              } catch (error) {
                setCsv('');
                setFileError(error instanceof Error ? error.message : 'The selected file could not be read.');
              }
            }}
          />
        </Field>
        <Field label="CSV content" htmlFor="import-csv" required>
          <Textarea
            id="import-csv"
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            rows={8}
            className="font-mono text-xs"
            required
          />
        </Field>
      </form>
    </Dialog>
  );
}

async function readXlsxAsCsv(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose an Excel file smaller than 5 MiB.');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('This is not a valid Excel workbook.');
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Excel workbook directory is invalid.');
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const compressed = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, compressed);
    else if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else throw new Error('This Excel workbook uses an unsupported compression method.');
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const xml = (name: string) => {
    const content = files.get(name);
    if (!content) throw new Error(`Workbook is missing ${name}.`);
    return new DOMParser().parseFromString(decoder.decode(content), 'application/xml');
  };
  const shared = files.has('xl/sharedStrings.xml') ? Array.from(xml('xl/sharedStrings.xml').getElementsByTagName('si'), (item) => Array.from(item.getElementsByTagName('t'), (text) => text.textContent ?? '').join('')) : [];
  const rows: string[][] = [];
  for (const rowElement of Array.from(xml('xl/worksheets/sheet1.xml').getElementsByTagName('row'))) {
    const row: string[] = [];
    for (const cell of Array.from(rowElement.getElementsByTagName('c'))) {
      const letters = (cell.getAttribute('r') ?? '').replace(/[0-9]/g, '');
      const column = [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
      const value = cell.getElementsByTagName('v')[0]?.textContent ?? '';
      row[column] = cell.getAttribute('t') === 's' ? shared[Number(value)] ?? '' : cell.getAttribute('t') === 'inlineStr' ? cell.getElementsByTagName('t')[0]?.textContent ?? '' : value;
    }
    rows.push(row.map((value) => value ?? ''));
  }
  return rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
}

function BatchDialog({
  schoolId,
  batchId,
  canCommit,
  committing,
  cancelling,
  onCommit,
  onCancel,
  onClose,
}: {
  schoolId: string;
  batchId: string;
  canCommit: boolean;
  committing: boolean;
  cancelling: boolean;
  onCommit: (id: string) => void;
  onCancel: (id: string) => void;
  onClose: () => void;
}): ReactNode {
  const detail = useQuery({
    queryKey: ['import', schoolId, batchId],
    queryFn: () => getImport(schoolId, batchId),
  });

  const batch = detail.data;

  return (
    <Dialog
      open
      onClose={onClose}
      title={batch ? `Import · ${batch.filename}` : 'Import batch'}
      description={batch ? `${batch.entityType} · ${batch.status}` : undefined}
      size="lg"
      footer={
        batch && batch.status === 'previewed' && canCommit ? (
          <>
            <Button
              variant="secondary"
              loading={cancelling}
              onClick={() => onCancel(batch.id)}
            >
              Cancel batch
            </Button>
            <Button
              loading={committing}
              disabled={batch.validRows === 0}
              onClick={() => onCommit(batch.id)}
            >
              Commit {batch.validRows} valid rows
            </Button>
          </>
        ) : undefined
      }
    >
      {detail.isPending ? (
        <TableSkeleton rows={6} columns={4} />
      ) : detail.isError ? (
        <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
      ) : batch ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm text-slate-600">
            <span>{batch.totalRows} rows</span>
            <span>{batch.validRows} valid</span>
            <span>{batch.invalidRows} invalid</span>
            {batch.status === 'committed' && <span>{batch.createdRows} created</span>}
          </div>
          {batch.status === 'committed' && (
            <Alert tone="success">
              This batch is committed and cannot be applied again.
            </Alert>
          )}
          {batch.status === 'cancelled' && (
            <Alert tone="warning">This batch was cancelled and cannot be committed.</Alert>
          )}
          {batch.invalidRows > 0 && batch.status === 'previewed' && (
            <Alert tone="warning">
              Invalid rows are skipped on commit. Fix the file and preview again if you need every
              row imported.
            </Alert>
          )}
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-right">#</th>
                  <th>Action</th>
                  <th>Data</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {(batch.rows ?? []).map((row) => (
                  <ImportRowView key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function ImportRowView({ row }: { row: ImportRow }): ReactNode {
  return (
    <tr>
      <td className="text-right tabular-nums">{row.rowNumber}</td>
      <td>
        <Badge
          tone={
            row.errors.length > 0
              ? 'danger'
              : row.action === 'skip'
                ? 'neutral'
                : row.action === 'update'
                  ? 'warning'
                  : 'success'
          }
        >
          {row.errors.length > 0 ? 'invalid' : row.action}
        </Badge>
      </td>
      <td className="max-w-md text-xs text-slate-600">
        <code className="break-all">
          {Object.entries(row.payload)
            .map(([key, value]) => `${key}=${value}`)
            .join(' · ')}
        </code>
      </td>
      <td className="text-xs text-rose-600">
        {row.errors.length === 0 ? '—' : row.errors.join('; ')}
      </td>
    </tr>
  );
}
