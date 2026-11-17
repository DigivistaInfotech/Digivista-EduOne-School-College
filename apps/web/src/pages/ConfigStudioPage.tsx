import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useSchoolId } from '../auth/AuthContext';
import { getSchoolConfigs, rollbackSchoolConfig, saveSchoolConfig } from '../lib/endpoints';
import { errorMessage } from '../lib/api';
import { Dialog } from '../components/Dialog';
import { RegionalSettingsPanel } from '../components/RegionalSettingsPanel';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Icon,
  Input,
  PageHeader,
  TableSkeleton,
  cn,
} from '../components/ui';

type ConfigCategory = 'navigation_labels' | 'attendance_policy' | 'workflow_settings' | 'library_policy' | 'branding';

export function ConfigStudioPage(): ReactNode {
  const schoolId = useSchoolId();
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState<ConfigCategory>('navigation_labels');

  const configsQuery = useQuery({
    queryKey: ['school-configs', schoolId],
    queryFn: () => getSchoolConfigs(schoolId),
  });

  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackKey, setRollbackKey] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState(1);
  const [statusMsg, setStatusMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // Local editing states
  const [navLabels, setNavLabels] = useState<Record<string, string>>({
    dashboard: 'Overview',
    academic: 'Academics',
    people: 'Students & Staff',
    attendance: 'Daily Attendance',
    fees: 'Fee Management',
    reports: 'Reports & Analytics',
  });

  const [attPolicy, setAttPolicy] = useState<{
    thresholdPercent: number;
    strictClassOrderMin: number;
    warningGraceDays: number;
  }>({
    thresholdPercent: 80,
    strictClassOrderMin: 6,
    warningGraceDays: 7,
  });

  const [workflows, setWorkflows] = useState<{
    requireTwoPersonApprovalOnPO: boolean;
    blockSelfApproval: boolean;
    parentOfflineReceiptAcknowledgement: boolean;
  }>({
    requireTwoPersonApprovalOnPO: true,
    blockSelfApproval: true,
    parentOfflineReceiptAcknowledgement: true,
  });

  const [branding, setBranding] = useState<{
    brandTheme: string;
    paletteName: string;
    primaryColor: string;
    accentColor: string;
    welcomeMotto: string;
  }>({
    brandTheme: 'DIGI',
    paletteName: 'Asterleaf Midnight & Lagoon (#182944 / #087F83)',
    primaryColor: '#182944',
    accentColor: '#087F83',
    welcomeMotto: 'Learn. Belong. Flourish.',
  });

  const [libraryPolicy, setLibraryPolicy] = useState<{
    defaultLoanDays: number;
    maxConcurrentLoansStudent: number;
    finePerDayRupees: number;
  }>({
    defaultLoanDays: 14,
    maxConcurrentLoansStudent: 2,
    finePerDayRupees: 2.0,
  });

  const saveMutation = useMutation({
    mutationFn: (args: { key: string; value: any; notes?: string }) =>
      saveSchoolConfig(schoolId, args.key, {
        value: args.value,
        status: 'published',
        notes: args.notes || 'Updated via Configuration Studio',
      }),
    onSuccess: (data) => {
      setStatusMsg({
        tone: 'success',
        text: `Successfully published version ${data.version} for ${data.configKey}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['school-configs', schoolId] });
      setTimeout(() => setStatusMsg(null), 3000);
    },
    onError: (err) => {
      setStatusMsg({ tone: 'danger', text: errorMessage(err) });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: (args: { key: string; targetVersion: number }) =>
      rollbackSchoolConfig(schoolId, args.key, { targetVersion: args.targetVersion }),
    onSuccess: (data) => {
      setStatusMsg({
        tone: 'success',
        text: `Rolled back ${data.configKey} to version ${data.rolledBackTo}. New version is ${data.newVersion}.`,
      });
      setRollbackOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['school-configs', schoolId] });
      setTimeout(() => setStatusMsg(null), 3000);
    },
    onError: (err) => {
      setStatusMsg({ tone: 'danger', text: errorMessage(err) });
    },
  });

  if (configsQuery.isPending) return <TableSkeleton rows={4} columns={3} />;
  if (configsQuery.isError) {
    return <ErrorState message={errorMessage(configsQuery.error)} onRetry={() => void configsQuery.refetch()} />;
  }

  const configs = configsQuery.data.configs;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuration Studio"
        description="Adapt school branding, menu labels, attendance thresholds and approval workflows from the dashboard without code changes."
      />

      {statusMsg && <Alert tone={statusMsg.tone}>{statusMsg.text}</Alert>}

      <RegionalSettingsPanel />

      {/* Category selector */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist">
        {(
          [
            ['navigation_labels', 'Navigation & Menu Labels', 'layers'],
            ['attendance_policy', 'Attendance Policy & Thresholds', 'check'],
            ['workflow_settings', 'Workflow & Approval Safeguards', 'shield'],
            ['branding', 'Branding & Visual Tokens', 'sparkle'],
            ['library_policy', 'Library & Fine Rules', 'book'],
          ] as Array<[ConfigCategory, string, any]>
        ).map(([catKey, label, iconName]) => (
          <button
            key={catKey}
            type="button"
            role="tab"
            aria-selected={activeCategory === catKey}
            onClick={() => setActiveCategory(catKey)}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition',
              activeCategory === catKey
                ? 'bg-brand-900 text-white shadow-sm'
                : 'bg-white text-slate-700 hover:bg-slate-100',
            )}
          >
            <Icon name={iconName} className="h-3.5 w-3.5" />
            {label}
            {configs[catKey]?.version && (
              <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-900 font-mono">
                v{configs[catKey].version}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Navigation & Menu Labels */}
      {activeCategory === 'navigation_labels' && (
        <Card>
          <CardHeader
            title="Menu & Navigation Customization"
            description="Customize display labels for sidebar items. (e.g. rename 'Staff & HR' or 'Overview')."
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Overview Label">
                <Input
                  value={navLabels.dashboard}
                  onChange={(e) => setNavLabels({ ...navLabels, dashboard: e.target.value })}
                />
              </Field>
              <Field label="Academics Label">
                <Input
                  value={navLabels.academic}
                  onChange={(e) => setNavLabels({ ...navLabels, academic: e.target.value })}
                />
              </Field>
              <Field label="People Label">
                <Input
                  value={navLabels.people}
                  onChange={(e) => setNavLabels({ ...navLabels, people: e.target.value })}
                />
              </Field>
              <Field label="Daily Attendance Label">
                <Input
                  value={navLabels.attendance}
                  onChange={(e) => setNavLabels({ ...navLabels, attendance: e.target.value })}
                />
              </Field>
              <Field label="Fees & Finance Label">
                <Input
                  value={navLabels.fees}
                  onChange={(e) => setNavLabels({ ...navLabels, fees: e.target.value })}
                />
              </Field>
              <Field label="Reports Label">
                <Input
                  value={navLabels.reports}
                  onChange={(e) => setNavLabels({ ...navLabels, reports: e.target.value })}
                />
              </Field>
            </div>

            <div className="flex justify-between items-center border-t border-slate-100 pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRollbackKey('navigation_labels');
                  setRollbackTarget(Math.max(1, (configs.navigation_labels?.version ?? 2) - 1));
                  setRollbackOpen(true);
                }}
              >
                Rollback to Previous Version
              </Button>
              <Button
                loading={saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({
                    key: 'navigation_labels',
                    value: navLabels,
                    notes: 'Saved updated menu labels',
                  })
                }
              >
                Publish Menu Labels
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Attendance Policy & Thresholds */}
      {activeCategory === 'attendance_policy' && (
        <Card>
          <CardHeader
            title="Attendance Compliance & Shortage Policy"
            description="Configure minimum attendance percentage and class range rules."
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Minimum Attendance Threshold (%)">
                <Input
                  type="number"
                  min={50}
                  max={95}
                  value={attPolicy.thresholdPercent}
                  onChange={(e) =>
                    setAttPolicy({ ...attPolicy, thresholdPercent: Number(e.target.value) })
                  }
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  School proposal threshold is currently set to 80% (configurable).
                </p>
              </Field>

              <Field label="Enforce Shortage Review From Grade">
                <select
                  value={attPolicy.strictClassOrderMin}
                  onChange={(e) =>
                    setAttPolicy({ ...attPolicy, strictClassOrderMin: Number(e.target.value) })
                  }
                  className="field-input"
                >
                  <option value={1}>Class 1 onwards</option>
                  <option value={6}>Class 6 onwards (Middle & Secondary)</option>
                  <option value={9}>Class 9 onwards (Board Track Only)</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  Class 6+ students below threshold appear in the Attendance Shortage Register.
                </p>
              </Field>

              <Field label="Shortage Warning Grace Period (Days)">
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={attPolicy.warningGraceDays}
                  onChange={(e) =>
                    setAttPolicy({ ...attPolicy, warningGraceDays: Number(e.target.value) })
                  }
                />
              </Field>
            </div>

            <div className="flex justify-between items-center border-t border-slate-100 pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRollbackKey('attendance_policy');
                  setRollbackTarget(Math.max(1, (configs.attendance_policy?.version ?? 2) - 1));
                  setRollbackOpen(true);
                }}
              >
                Rollback Policy
              </Button>
              <Button
                loading={saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({
                    key: 'attendance_policy',
                    value: attPolicy,
                    notes: `Updated attendance threshold to ${attPolicy.thresholdPercent}%`,
                  })
                }
              >
                Publish Policy
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Workflow Settings */}
      {activeCategory === 'workflow_settings' && (
        <Card>
          <CardHeader
            title="Workflow & Separation of Duties"
            description="Enforce two-person verification rules and segregation of duties."
          />
          <div className="space-y-4 p-5">
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={workflows.requireTwoPersonApprovalOnPO}
                  onChange={(e) =>
                    setWorkflows({ ...workflows, requireTwoPersonApprovalOnPO: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Require Two Independent Approvals on Purchase Orders & Requisitions
              </label>

              <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={workflows.blockSelfApproval}
                  onChange={(e) =>
                    setWorkflows({ ...workflows, blockSelfApproval: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Strictly Block Self-Approval across Leave, Attendance Corrections & Refunds
              </label>

              <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={workflows.parentOfflineReceiptAcknowledgement}
                  onChange={(e) =>
                    setWorkflows({
                      ...workflows,
                      parentOfflineReceiptAcknowledgement: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Enable Neutral Parent Offline Payment Acknowledgement Queue
              </label>
            </div>

            <div className="flex justify-between items-center border-t border-slate-100 pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRollbackKey('workflow_settings');
                  setRollbackTarget(Math.max(1, (configs.workflow_settings?.version ?? 2) - 1));
                  setRollbackOpen(true);
                }}
              >
                Rollback Workflows
              </Button>
              <Button
                loading={saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({
                    key: 'workflow_settings',
                    value: workflows,
                    notes: 'Updated workflow separation of duties',
                  })
                }
              >
                Save Workflow Rules
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Branding & Design Tokens */}
      {activeCategory === 'branding' && (
        <Card>
          <CardHeader
            title="School Branding & DIGI Theme Tokens"
            description="Customize school motto, primary Midnight/Lagoon palette, and operational accents."
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Theme Edition">
                <Input value={branding.brandTheme} disabled />
              </Field>
              <Field label="School Motto">
                <Input
                  value={branding.welcomeMotto}
                  onChange={(e) => setBranding({ ...branding, welcomeMotto: e.target.value })}
                />
              </Field>
              <Field label="Primary Teal Token">
                <Input
                  value={branding.primaryColor}
                  onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                />
              </Field>
            </div>

            <div className="flex justify-between items-center border-t border-slate-100 pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRollbackKey('branding');
                  setRollbackTarget(Math.max(1, (configs.branding?.version ?? 2) - 1));
                  setRollbackOpen(true);
                }}
              >
                Rollback Branding
              </Button>
              <Button
                loading={saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({
                    key: 'branding',
                    value: branding,
                    notes: 'Saved updated school branding tokens',
                  })
                }
              >
                Publish Branding Tokens
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Library Policy */}
      {activeCategory === 'library_policy' && (
        <Card>
          <CardHeader
            title="Library Borrowing & Fine Policies"
            description="Set standard borrowing duration, book limits per student, and daily fine rates."
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Default Loan Period (Days)">
                <Input
                  type="number"
                  value={libraryPolicy.defaultLoanDays}
                  onChange={(e) =>
                    setLibraryPolicy({ ...libraryPolicy, defaultLoanDays: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Max Concurrent Books per Student">
                <Input
                  type="number"
                  value={libraryPolicy.maxConcurrentLoansStudent}
                  onChange={(e) =>
                    setLibraryPolicy({
                      ...libraryPolicy,
                      maxConcurrentLoansStudent: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Overdue Fine per Day (₹)">
                <Input
                  type="number"
                  value={libraryPolicy.finePerDayRupees}
                  onChange={(e) =>
                    setLibraryPolicy({
                      ...libraryPolicy,
                      finePerDayRupees: Number(e.target.value),
                    })
                  }
                />
              </Field>
            </div>

            <div className="flex justify-between items-center border-t border-slate-100 pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRollbackKey('library_policy');
                  setRollbackTarget(Math.max(1, (configs.library_policy?.version ?? 2) - 1));
                  setRollbackOpen(true);
                }}
              >
                Rollback Policy
              </Button>
              <Button
                loading={saveMutation.isPending}
                onClick={() =>
                  saveMutation.mutate({
                    key: 'library_policy',
                    value: libraryPolicy,
                    notes: 'Updated library borrowing and fine rules',
                  })
                }
              >
                Save Library Rules
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Rollback Dialog */}
      <Dialog
        open={rollbackOpen}
        onClose={() => setRollbackOpen(false)}
        title="Rollback Configuration Version"
        description={`Revert ${rollbackKey} to an earlier verified version snapshot.`}
      >
        <div className="space-y-4">
          <Field label="Target Version to Restore">
            <Input
              type="number"
              min={1}
              value={rollbackTarget}
              onChange={(e) => setRollbackTarget(Number(e.target.value))}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setRollbackOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={rollbackMutation.isPending}
              onClick={() =>
                rollbackMutation.mutate({ key: rollbackKey, targetVersion: rollbackTarget })
              }
            >
              Confirm Rollback
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
