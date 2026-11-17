import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { listAttendanceKiosks, listGeofences, registerAttendanceKiosk } from '../../lib/endpoints';
import { errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { Dialog } from '../Dialog';
import { useToast } from '../ToastProvider';
import {
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
} from '../ui';

export function KiosksPanel({ schoolId }: { schoolId: string }): ReactNode {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [showRegisterDialog, setShowRegisterDialog] = useState(false);

  const kiosksQuery = useQuery({
    queryKey: ['attendance-kiosks', schoolId],
    queryFn: () => listAttendanceKiosks(schoolId),
  });

  const geofencesQuery = useQuery({
    queryKey: ['school-geofences', schoolId],
    queryFn: () => listGeofences(schoolId),
  });

  const registerMutation = useMutation({
    mutationFn: (body: Parameters<typeof registerAttendanceKiosk>[1]) =>
      registerAttendanceKiosk(schoolId, body),
    onSuccess: (data: any) => {
      toast.notify('success', data.message || 'Entrance kiosk registered successfully.');
      setShowRegisterDialog(false);
      void queryClient.invalidateQueries({ queryKey: ['attendance-kiosks', schoolId] });
    },
    onError: (err) => {
      toast.notify('error', errorMessage(err));
    },
  });

  const items = kiosksQuery.data?.items ?? [];
  const geofenceOptions = geofencesQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Managed School Entrance Kiosks"
          description="Fixed, school-owned facial biometric punch terminals installed at security turnstiles, staff rooms and campus gates. Kiosks run locked down kiosk apps with mutual TLS and cryptographic pairing keys."
          actions={
            <Button onClick={() => setShowRegisterDialog(true)}>
              <Icon name="plus" className="h-4 w-4" />
              Register Kiosk Device
            </Button>
          }
        />

        {kiosksQuery.isPending ? (
          <TableSkeleton rows={3} columns={6} />
        ) : kiosksQuery.isError ? (
          <ErrorState
            message={errorMessage(kiosksQuery.error)}
            onRetry={() => void kiosksQuery.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No kiosks registered"
            description="Register a school gate terminal to allow high-throughput walk-through staff attendance."
            icon="shield"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device Code & Name</th>
                  <th>Geofence Boundary</th>
                  <th>Status</th>
                  <th>Heartbeat</th>
                  <th>App Version & IP</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {items.map((kiosk) => {
                  const isActive = kiosk.status === 'active';
                  const isMaintenance = kiosk.status === 'maintenance';
                  const tone: 'success' | 'warning' | 'neutral' = isActive
                    ? 'success'
                    : isMaintenance
                    ? 'warning'
                    : 'neutral';

                  return (
                    <tr key={kiosk.id}>
                      <td>
                        <div>
                          <span className="font-semibold text-slate-800">{kiosk.deviceName}</span>
                          <div className="font-mono text-xs text-indigo-700">{kiosk.deviceCode}</div>
                        </div>
                      </td>
                      <td className="text-xs text-slate-700">
                        {kiosk.geofenceName || 'Main Academic Block'}
                      </td>
                      <td>
                        <Badge tone={tone}>{kiosk.status}</Badge>
                      </td>
                      <td className="text-xs text-slate-600">
                        {kiosk.lastHeartbeatAt ? formatDateTime(kiosk.lastHeartbeatAt) : 'Never'}
                      </td>
                      <td className="text-xs font-mono text-slate-600">
                        {kiosk.appVersion || 'v2.4.0'} · {kiosk.ipAddress || '192.168.1.10x'}
                      </td>
                      <td className="text-xs text-slate-500 font-mono">
                        {formatDateTime(kiosk.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showRegisterDialog && (
        <RegisterKioskDialog
          geofences={geofenceOptions}
          saving={registerMutation.isPending}
          onClose={() => setShowRegisterDialog(false)}
          onSave={(body) => registerMutation.mutate(body)}
        />
      )}
    </div>
  );
}

function RegisterKioskDialog({
  geofences,
  saving,
  onClose,
  onSave,
}: {
  geofences: Array<{ id: string; name: string }>;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof registerAttendanceKiosk>[1]) => void;
}): ReactNode {
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [geofenceId, setGeofenceId] = useState(geofences[0]?.id ?? '');
  const [apiKey, setApiKey] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave({
      deviceCode: deviceCode.trim().toUpperCase(),
      deviceName: deviceName.trim(),
      geofenceId: geofenceId || null,
      apiKey,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Register School Entrance Kiosk"
      description="Pair a dedicated Android / iPad tablet installed at turnstile or staff room entrance."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="kiosk-form" loading={saving}>
            Register & Generate Secret
          </Button>
        </>
      }
    >
      <form id="kiosk-form" className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Device Identifier" htmlFor="k-code" required hint="e.g. KIOSK-GATE-02">
            <Input
              id="k-code"
              value={deviceCode}
              onChange={(e) => setDeviceCode(e.target.value)}
              placeholder="KIOSK-GATE-02"
              required
            />
          </Field>
          <Field label="Device Name" htmlFor="k-name" required>
            <Input
              id="k-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="South Security Turnstile Kiosk"
              required
            />
          </Field>
        </div>

        <Field label="Campus Geofence" htmlFor="k-geo" required>
          <Select id="k-geo" value={geofenceId} onChange={(e) => setGeofenceId(e.target.value)} required>
            <option value="">Select Geofence Zone</option>
            {geofences.map((gf) => (
              <option key={gf.id} value={gf.id}>
                {gf.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Pairing Secret Key" htmlFor="k-key" hint="Generated 256-bit device secret">
          <div className="flex gap-2">
            <Input id="k-key" value={apiKey} readOnly className="font-mono text-xs bg-slate-50" />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const nextKey = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join('');
                setApiKey(nextKey);
              }}
            >
              Regenerate
            </Button>
          </div>
        </Field>
      </form>
    </Dialog>
  );
}
