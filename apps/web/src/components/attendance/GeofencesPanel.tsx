import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { SchoolGeofence } from '@erp/shared';
import { createGeofence, listGeofences, updateGeofence } from '../../lib/endpoints';
import { errorMessage } from '../../lib/api';
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

const LOCATION_TYPES = [
  { value: 'campus', label: 'Main Campus / Academic Wing' },
  { value: 'sports_ground', label: 'Sports Complex / Ground' },
  { value: 'transport_depot', label: 'Transport Depot / Bus Yard' },
  { value: 'approved_offsite', label: 'Approved Off-site Activity / Excursion' },
  { value: 'event_venue', label: 'External Event Venue' },
] as const;

export function GeofencesPanel({ schoolId }: { schoolId: string }): ReactNode {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [activeDialog, setActiveDialog] = useState<{
    kind: 'create' | 'edit';
    geofence?: SchoolGeofence;
  } | null>(null);

  const geofencesQuery = useQuery({
    queryKey: ['school-geofences', schoolId],
    queryFn: () => listGeofences(schoolId),
  });

  const saveMutation = useMutation({
    mutationFn: (input: { id?: string; body: Parameters<typeof createGeofence>[1] }) =>
      input.id
        ? updateGeofence(schoolId, input.id, input.body)
        : createGeofence(schoolId, input.body),
    onSuccess: (data: any) => {
      toast.notify('success', data.message || 'Geofence perimeter saved successfully.');
      setActiveDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['school-geofences', schoolId] });
      void queryClient.invalidateQueries({ queryKey: ['staff-punch-status', schoolId] });
    },
    onError: (err) => {
      toast.notify('error', errorMessage(err));
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="School Geofence Boundaries"
          description="Authorised geographic zones within which staff members are permitted to punch in or out. Includes main campus, sports grounds, bus depots and approved off-site school activities."
          actions={
            <Button onClick={() => setActiveDialog({ kind: 'create' })}>
              <Icon name="plus" className="h-4 w-4" />
              Add Geofence
            </Button>
          }
        />

        {geofencesQuery.isPending ? (
          <TableSkeleton rows={4} columns={7} />
        ) : geofencesQuery.isError ? (
          <ErrorState
            message={errorMessage(geofencesQuery.error)}
            onRetry={() => void geofencesQuery.refetch()}
          />
        ) : geofencesQuery.data.items.length === 0 ? (
          <EmptyState
            title="No geofences configured"
            description="Create a campus geofence boundary to enable location-verified staff attendance."
            icon="shield"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name & Type</th>
                  <th>Coordinates</th>
                  <th>Radius</th>
                  <th>Max Accuracy</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {geofencesQuery.data.items.map((gf) => (
                  <tr key={gf.id}>
                    <td>
                      <div className="space-y-1">
                        <span className="font-semibold text-slate-800">{gf.name}</span>
                        <div className="text-xs text-slate-500 capitalize">
                          {gf.locationType.replace('_', ' ')}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs text-slate-700">
                      {gf.latitude.toFixed(6)}, {gf.longitude.toFixed(6)}
                    </td>
                    <td className="text-sm text-slate-700">{gf.radiusMeters} m</td>
                    <td className="text-sm text-slate-700">±{gf.maxAccuracyThresholdMeters} m</td>
                    <td>
                      <Badge tone={gf.isActive ? 'success' : 'neutral'}>
                        {gf.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="text-xs text-slate-600 max-w-xs truncate" title={gf.notes || ''}>
                      {gf.notes || '—'}
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setActiveDialog({ kind: 'edit', geofence: gf })}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {activeDialog && (
        <GeofenceDialog
          geofence={activeDialog.geofence}
          saving={saveMutation.isPending}
          onClose={() => setActiveDialog(null)}
          onSave={(body) => saveMutation.mutate({ id: activeDialog.geofence?.id, body })}
        />
      )}
    </div>
  );
}

function GeofenceDialog({
  geofence,
  saving,
  onClose,
  onSave,
}: {
  geofence?: SchoolGeofence;
  saving: boolean;
  onClose: () => void;
  onSave: (body: Parameters<typeof createGeofence>[1]) => void;
}): ReactNode {
  const [name, setName] = useState(geofence?.name ?? '');
  const [locationType, setLocationType] = useState(geofence?.locationType ?? 'campus');
  const [latitude, setLatitude] = useState(geofence ? String(geofence.latitude) : '26.853245');
  const [longitude, setLongitude] = useState(geofence ? String(geofence.longitude) : '80.946123');
  const [radiusMeters, setRadiusMeters] = useState(String(geofence?.radiusMeters ?? 150));
  const [maxAccuracyThresholdMeters, setMaxAccuracy] = useState(
    String(geofence?.maxAccuracyThresholdMeters ?? 100),
  );
  const [isActive, setIsActive] = useState(geofence?.isActive ?? true);
  const [notes, setNotes] = useState(geofence?.notes ?? '');
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  function useCurrentLocation() {
    setLocating(true);
    setLocError(null);
    if (!navigator.geolocation) {
      setLocError('Geolocation not supported by browser.');
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        setMaxAccuracy(String(Math.max(30, Math.round(pos.coords.accuracy * 1.5))));
        setLocating(false);
      },
      (err) => {
        setLocError(`GPS acquisition failed: ${err.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSave({
      name: name.trim(),
      locationType,
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusMeters: Number(radiusMeters),
      maxAccuracyThresholdMeters: Number(maxAccuracyThresholdMeters),
      isActive,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={geofence ? 'Edit Geofence Boundary' : 'Create School Geofence'}
      description="Define geographic perimeter, radius and GPS accuracy tolerances for staff biometric punch verification."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="geofence-form" loading={saving}>
            Save Geofence
          </Button>
        </>
      }
    >
      <form id="geofence-form" className="space-y-4" onSubmit={handleSubmit}>
        {locError && <Alert tone="warning">{locError}</Alert>}

        <Field label="Geofence Name" htmlFor="gf-name" required>
          <Input
            id="gf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main Academic Block, Football Field"
            required
          />
        </Field>

        <Field label="Location Type" htmlFor="gf-type" required>
          <Select
            id="gf-type"
            value={locationType}
            onChange={(e) => setLocationType(e.target.value as any)}
            required
          >
            {LOCATION_TYPES.map((lt) => (
              <option key={lt.value} value={lt.value}>
                {lt.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Coordinates & Perimeter
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={useCurrentLocation}
            loading={locating}
          >
            <Icon name="shield" className="h-3.5 w-3.5" />
            Set From Current GPS
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude (-90 to +90)" htmlFor="gf-lat" required>
            <Input
              id="gf-lat"
              type="number"
              step="any"
              min={-90}
              max={90}
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              required
            />
          </Field>
          <Field label="Longitude (-180 to +180)" htmlFor="gf-lon" required>
            <Input
              id="gf-lon"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Geofence Radius (meters)"
            htmlFor="gf-radius"
            hint="20m to 5,000m. Campus default is 150m."
            required
          >
            <Input
              id="gf-radius"
              type="number"
              min={20}
              max={5000}
              value={radiusMeters}
              onChange={(e) => setRadiusMeters(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Max GPS Accuracy Threshold (meters)"
            htmlFor="gf-acc"
            hint="Rejects mock or poor GPS readings exceeding this limit."
            required
          >
            <Input
              id="gf-acc"
              type="number"
              min={10}
              max={500}
              value={maxAccuracyThresholdMeters}
              onChange={(e) => setMaxAccuracy(e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label="Description & Notes" htmlFor="gf-notes">
          <Textarea
            id="gf-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Wings, buildings or access gates included in this zone..."
            maxLength={300}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Active (Permit staff punch verification within this perimeter)
        </label>
      </form>
    </Dialog>
  );
}
