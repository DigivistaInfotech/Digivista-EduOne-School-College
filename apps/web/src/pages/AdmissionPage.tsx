import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useSchoolId, useSchoolTimezone } from '../auth/AuthContext';
import {
  admitStudent,
  listAcademicYears,
  listClasses,
  listSections,
  type AdmissionInput,
} from '../lib/endpoints';
import { errorMessage, fieldErrors } from '../lib/api';
import { todayIso } from '../lib/format';
import { GUARDIAN_PORTAL_STATUSES, RELATIONSHIP_TYPES } from '../lib/statuses';
import { useToast } from '../components/ToastProvider';
import { ClassSectionSelect } from '../components/ClassSectionSelect';
import { AdmissionPolicyGuidance } from '../components/AdmissionPolicyGuidance';
import {
  Alert,
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
} from '../components/ui';

interface GuardianDraft {
  key: number;
  firstName: string;
  lastName: string;
  occupation: string;
  email: string;
  phone: string;
  relationshipType: string;
  isPrimary: boolean;
  portalAccessStatus: string;
}

function emptyGuardian(key: number, isPrimary: boolean, relationshipType = 'guardian'): GuardianDraft {
  return {
    key,
    firstName: '',
    lastName: '',
    occupation: '',
    email: '',
    phone: '',
    relationshipType,
    isPrimary,
    portalAccessStatus: 'pending',
  };
}

const DOCUMENT_ITEMS = [
  { key: 'studentPhoto', label: 'Student passport-size photo' },
  { key: 'birthCertificate', label: 'Birth certificate' },
  { key: 'aadhaarCard', label: 'Aadhaar card (if required)' },
  { key: 'previousReportCard', label: 'Previous class report card (if applicable)' },
  { key: 'transferCertificate', label: 'Transfer certificate (if applicable)' },
  { key: 'migrationCertificate', label: 'Migration certificate (if applicable)' },
  { key: 'addressProof', label: 'Address proof (if required)' },
] as const;
const DOCUMENT_STATUSES = ['not_provided', 'received', 'verified', 'not_applicable'] as const;

export function AdmissionPage(): ReactNode {
  const schoolId = useSchoolId();
  const timeZone = useSchoolTimezone();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [aadhaarLast4, setAadhaarLast4] = useState('');
  const [previousClass, setPreviousClass] = useState('');
  const [previousSchoolName, setPreviousSchoolName] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [medicalInformation, setMedicalInformation] = useState('');
  const [admissionDocuments, setAdmissionDocuments] = useState<AdmissionInput['admissionDocuments']>({
    studentPhoto: 'not_provided', birthCertificate: 'not_provided', aadhaarCard: 'not_provided',
    previousReportCard: 'not_provided', transferCertificate: 'not_provided',
    migrationCertificate: 'not_provided', addressProof: 'not_provided',
  });
  const [academicYearId, setAcademicYearId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [startsOn, setStartsOn] = useState(todayIso(timeZone));
  const [guardians, setGuardians] = useState<GuardianDraft[]>([
    emptyGuardian(1, true, 'father'), emptyGuardian(2, false, 'mother'),
  ]);
  const [nextKey, setNextKey] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const years = useQuery({
    queryKey: ['academic-years', schoolId],
    queryFn: () => listAcademicYears(schoolId),
  });
  const sections = useQuery({
    queryKey: ['sections', schoolId, academicYearId],
    queryFn: () => listSections(schoolId, { academicYearId: academicYearId || undefined }),
    enabled: Boolean(academicYearId),
  });
  const classes = useQuery({
    queryKey: ['classes', schoolId],
    queryFn: () => listClasses(schoolId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (academicYearId || !years.data) return;
    const preferred =
      years.data.items.find((year) => year.status === 'active') ?? years.data.items[0];
    if (preferred) setAcademicYearId(preferred.id);
  }, [years.data, academicYearId]);

  useEffect(() => {
    if (!sections.data) return;
    if (!sections.data.items.some((section) => section.id === sectionId)) {
      setSectionId(sections.data.items[0]?.id ?? '');
    }
  }, [sections.data, sectionId]);

  const selectedSection = sections.data?.items.find((section) => section.id === sectionId);
  const selectedClass = classes.data?.items.find((record) => record.id === selectedSection?.classId);
  const capacityWarning =
    selectedSection?.capacity != null && selectedSection.enrolled >= selectedSection.capacity;

  const mutation = useMutation({
    mutationFn: (input: AdmissionInput) => admitStudent(schoolId, input),
    onSuccess: (student) => {
      toast.notify('success', `${student.firstName} admitted as ${student.admissionNumber}.`);
      void queryClient.invalidateQueries({ queryKey: ['students', schoolId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', schoolId] });
      void queryClient.invalidateQueries({ queryKey: ['sections', schoolId] });
      navigate(`/students/${student.id}`);
    },
    onError: (caught) => {
      setError(errorMessage(caught));
      setErrors(fieldErrors(caught));
    },
  });

  const guardianFieldErrors = useMemo(() => {
    const indexed: Record<number, Record<string, string[]>> = {};
    for (const [key, value] of Object.entries(errors)) {
      const match = /^guardians\.(\d+)\.(\w+)$/.exec(key);
      if (match) {
        const index = Number(match[1]);
        indexed[index] = { ...(indexed[index] ?? {}), [match[2]!]: value };
      }
    }
    return indexed;
  }, [errors]);

  if (!can('students.admission.create')) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-semibold text-slate-900">Admissions are not enabled for your role</p>
        <p className="mt-1 text-sm text-slate-500">
          Ask a school administrator if you need to admit students.
        </p>
      </Card>
    );
  }

  if (years.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="New admission" />
        <Card>
          <TableSkeleton rows={6} columns={2} />
        </Card>
      </div>
    );
  }

  if (years.isError) {
    return <ErrorState message={errorMessage(years.error)} onRetry={() => void years.refetch()} />;
  }

  if (years.data.items.length === 0) {
    return (
      <EmptyState
        title="Create an academic year first"
        description="Admissions need an academic year and a section. Set up the academic structure, then come back."
        icon="calendar"
        action={
          <Link to="/academic/years">
            <Button size="sm">Go to academic years</Button>
          </Link>
        }
      />
    );
  }

  function setPrimary(key: number): void {
    setGuardians((current) =>
      current.map((guardian) => ({ ...guardian, isPrimary: guardian.key === key })),
    );
  }

  function updateGuardian(key: number, patch: Partial<GuardianDraft>): void {
    setGuardians((current) =>
      current.map((guardian) => (guardian.key === key ? { ...guardian, ...patch } : guardian)),
    );
  }

  function addGuardian(): void {
    setGuardians((current) => [...current, emptyGuardian(nextKey, current.length === 0)]);
    setNextKey((key) => key + 1);
  }

  function removeGuardian(key: number): void {
    setGuardians((current) => {
      const next = current.filter((guardian) => guardian.key !== key);
      if (next.length > 0 && !next.some((guardian) => guardian.isPrimary)) {
        next[0] = { ...next[0]!, isPrimary: true };
      }
      return next;
    });
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    setErrors({});
    mutation.mutate({
      firstName: firstName.trim(),
      middleName: middleName.trim() || undefined,
      lastName: lastName.trim() || undefined,
      dateOfBirth,
      gender: gender as AdmissionInput['gender'],
      admissionNumber: admissionNumber.trim() || undefined,
      aadhaarLast4: aadhaarLast4.trim() || undefined,
      previousClass: previousClass.trim() || undefined,
      previousSchoolName: previousSchoolName.trim() || undefined,
      homeAddress: homeAddress.trim(),
      city: city.trim(),
      state: state.trim(),
      postalCode: postalCode.trim(),
      emergencyContact: emergencyContact.trim(),
      bloodGroup: bloodGroup || undefined,
      medicalInformation: medicalInformation.trim() || undefined,
      admissionDocuments,
      academicYearId,
      sectionId,
      startsOn,
      guardians: guardians.filter((guardian) => guardian.firstName.trim()).map((guardian, index) => ({
        firstName: guardian.firstName.trim(),
        lastName: guardian.lastName.trim() || undefined,
        occupation: guardian.occupation.trim() || undefined,
        email: guardian.email.trim() || undefined,
        phone: guardian.phone.trim() || undefined,
        relationshipType: guardian.relationshipType,
        isPrimary: index === 0 || guardian.isPrimary,
        portalAccessStatus: guardian.portalAccessStatus,
      })),
    });
  }

  return (
    <form className="grid items-start gap-4 lg:grid-cols-2" onSubmit={submit} noValidate>
      <div className="lg:col-span-2">
      <PageHeader
        title="New admission"
        description="Capture the student, family, safety and document checklist once. The school and campus are attached automatically from your selected institution."
        actions={
          <>
            {can('students.admission.create') && <LinkButton variant="secondary" href="/students?import=1">Import CSV / Excel</LinkButton>}
            <Link to="/students">
              <Button variant="secondary" type="button">Cancel</Button>
            </Link>
          </>
        }
      />

      <AdmissionPolicyGuidance />
      </div>
      {error && <Alert tone="danger" title="Admission could not be saved">{error}</Alert>}

      <Card className="lg:col-span-2">
        <CardHeader
          title="Student details"
          description="Required fields are marked *. The admission number is generated when left blank. Aadhaar is optional; enter only its last four digits."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name" htmlFor="first-name" required error={errors.firstName?.[0]}>
            <Input
              id="first-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          <Field label="Middle name" htmlFor="middle-name" error={errors.middleName?.[0]}>
            <Input
              id="middle-name"
              value={middleName}
              onChange={(event) => setMiddleName(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Last name" htmlFor="last-name" error={errors.lastName?.[0]}>
            <Input
              id="last-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Date of birth" htmlFor="dob" required error={errors.dateOfBirth?.[0]}>
            <Input
              id="dob"
              type="date"
              max={todayIso(timeZone)}
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              required
            />
          </Field>
          <Field label="Gender" htmlFor="student-gender" required error={errors.gender?.[0]}>
            <Select id="student-gender" value={gender} onChange={(event) => setGender(event.target.value)} required>
              <option value="">Select</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="not_disclosed">Prefer not to disclose</option>
            </Select>
          </Field>
          <Field
            label="Admission number"
            htmlFor="admission-number"
            hint="Leave blank to use the school sequence."
            error={errors.admissionNumber?.[0]}
          >
            <Input
              id="admission-number"
              value={admissionNumber}
              onChange={(event) => setAdmissionNumber(event.target.value)}
              placeholder="Auto-generated"
              autoComplete="off"
            />
          </Field>
          <Field label="Aadhaar last four digits" htmlFor="aadhaar-last-four" hint="Optional. Never enter the full Aadhaar number." error={errors.aadhaarLast4?.[0]}>
            <Input id="aadhaar-last-four" inputMode="numeric" maxLength={4} value={aadhaarLast4} onChange={(event) => setAadhaarLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Previous school" description="Complete for transfer or later-grade admissions; leave blank for a first school admission." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Previous school name" htmlFor="previous-school">
            <Input id="previous-school" value={previousSchoolName} onChange={(event) => setPreviousSchoolName(event.target.value)} />
          </Field>
          <Field label="Previous class" htmlFor="previous-class">
            <Input id="previous-class" value={previousClass} onChange={(event) => setPreviousClass(event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Address and safety" description="These shared details are needed for school communication and emergency follow-up." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Home address" htmlFor="home-address" required error={errors.homeAddress?.[0]}>
            <Input id="home-address" value={homeAddress} onChange={(event) => setHomeAddress(event.target.value)} required />
          </Field>
          <Field label="City" htmlFor="home-city" required error={errors.city?.[0]}>
            <Input id="home-city" value={city} onChange={(event) => setCity(event.target.value)} required />
          </Field>
          <Field label="State" htmlFor="home-state" required error={errors.state?.[0]}>
            <Input id="home-state" value={state} onChange={(event) => setState(event.target.value)} required />
          </Field>
          <Field label="PIN code" htmlFor="home-pin" required error={errors.postalCode?.[0]}>
            <Input id="home-pin" inputMode="numeric" maxLength={6} value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required />
          </Field>
          <Field label="Emergency contact number" htmlFor="emergency-contact" required error={errors.emergencyContact?.[0]} hint="May be the primary guardian number.">
            <Input id="emergency-contact" type="tel" value={emergencyContact} onChange={(event) => setEmergencyContact(event.target.value)} required />
          </Field>
          <Field label="Blood group" htmlFor="student-blood-group" error={errors.bloodGroup?.[0]}>
            <Select id="student-blood-group" value={bloodGroup} onChange={(event) => setBloodGroup(event.target.value)}>
              <option value="">Not recorded</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((group) => <option key={group} value={group}>{group}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Medical information or allergies" htmlFor="medical-information" hint="Optional. Record only information the school needs to keep the student safe.">
              <textarea id="medical-information" className="field-input min-h-24" value={medicalInformation} onChange={(event) => setMedicalInformation(event.target.value)} maxLength={2000} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Placement"
          description="The section must belong to the selected academic year."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Academic year" htmlFor="placement-year" required error={errors.academicYearId?.[0]}>
            <Select
              id="placement-year"
              value={academicYearId}
              onChange={(event) => setAcademicYearId(event.target.value)}
              required
            >
              {years.data.items.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                  {year.status === 'active' ? ' (active)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Class / Section"
            htmlFor="placement-section"
            required
            error={errors.sectionId?.[0]}
            hint={selectedClass ? `${selectedClass.name} · ${selectedSection?.enrolled ?? 0} enrolled` : undefined}
          >
            <ClassSectionSelect
              id="placement-section"
              value={sectionId}
              onChange={(id) => setSectionId(id)}
              academicYearId={academicYearId}
              required
            />
          </Field>
          <Field label="Enrollment starts" htmlFor="starts-on" required error={errors.startsOn?.[0]}>
            <Input
              id="starts-on"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
              required
            />
          </Field>
        </div>
        {capacityWarning && (
          <div className="px-5 pb-5">
            <Alert tone="warning">
              {selectedSection?.className} {selectedSection?.name} is at or above its recorded
              capacity ({selectedSection?.enrolled}/{selectedSection?.capacity}). You can still admit,
              but confirm this is intended.
            </Alert>
          </div>
        )}
        {!sections.isPending && sections.data?.items.length === 0 && (
          <div className="px-5 pb-5">
            <Alert tone="warning" title="No sections available">
              This academic year has no sections. Create one under Academic → Sections first.
            </Alert>
          </div>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Parents and guardians"
          description="Each parent or guardian you add needs a phone or email so records can be matched safely. Add the other parent if available; only one can be the primary contact."
          actions={
            guardians.length < 5 ? (
              <Button type="button" variant="secondary" size="sm" onClick={addGuardian}>
                <Icon name="plus" className="h-3.5 w-3.5" />
                Add guardian
              </Button>
            ) : undefined
          }
        />
        <div className="divide-y divide-slate-100">
          {guardians.map((guardian, index) => {
            const currentErrors = guardianFieldErrors[index] ?? {};
            return (
              <div key={guardian.key} className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {index === 0 ? 'Father / primary guardian' : index === 1 ? 'Mother / second guardian' : `Guardian ${index + 1}`}
                    </span>
                    {guardian.isPrimary && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                        Primary contact
                      </span>
                    )}
                  </div>
                  {guardians.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeGuardian(guardian.key)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field
                    label="First name"
                    htmlFor={`guardian-${guardian.key}-first`}
                    required={index === 0}
                    error={currentErrors.firstName?.[0]}
                  >
                    <Input
                      id={`guardian-${guardian.key}-first`}
                      value={guardian.firstName}
                      onChange={(event) => updateGuardian(guardian.key, { firstName: event.target.value })}
                      required={index === 0}
                    />
                  </Field>
                  <Field
                    label="Last name"
                    htmlFor={`guardian-${guardian.key}-last`}
                    error={currentErrors.lastName?.[0]}
                  >
                    <Input
                      id={`guardian-${guardian.key}-last`}
                      value={guardian.lastName}
                      onChange={(event) => updateGuardian(guardian.key, { lastName: event.target.value })}
                    />
                  </Field>
                  <Field label="Occupation" htmlFor={`guardian-${guardian.key}-occupation`}>
                    <Input id={`guardian-${guardian.key}-occupation`} value={guardian.occupation} onChange={(event) => updateGuardian(guardian.key, { occupation: event.target.value })} />
                  </Field>
                  <Field
                    label="Relationship"
                    htmlFor={`guardian-${guardian.key}-relationship`}
                    required={index === 0}
                    error={currentErrors.relationshipType?.[0]}
                  >
                    <Select
                      id={`guardian-${guardian.key}-relationship`}
                      value={guardian.relationshipType}
                      onChange={(event) =>
                        updateGuardian(guardian.key, { relationshipType: event.target.value })
                      }
                    >
                      {RELATIONSHIP_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Email"
                    htmlFor={`guardian-${guardian.key}-email`}
                    hint="Enter an email or phone number; either one is required to match this guardian across records."
                    error={currentErrors.email?.[0]}
                  >
                    <Input
                      id={`guardian-${guardian.key}-email`}
                      type="email"
                      value={guardian.email}
                      onChange={(event) => updateGuardian(guardian.key, { email: event.target.value })}
                      placeholder="guardian@example.test"
                    />
                  </Field>
                  <Field
                    label="Phone"
                    htmlFor={`guardian-${guardian.key}-phone`}
                    error={currentErrors.phone?.[0]}
                  >
                    <Input
                      id={`guardian-${guardian.key}-phone`}
                      value={guardian.phone}
                      onChange={(event) => updateGuardian(guardian.key, { phone: event.target.value })}
                      placeholder="+1 555 0100"
                    />
                  </Field>
                  <Field label="Portal access" htmlFor={`guardian-${guardian.key}-portal`}>
                    <Select
                      id={`guardian-${guardian.key}-portal`}
                      value={guardian.portalAccessStatus}
                      onChange={(event) => updateGuardian(guardian.key, { portalAccessStatus: event.target.value })}
                    >
                      {GUARDIAN_PORTAL_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </Select>
                  </Field>
                </div>
                <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="radio"
                    name="primary-guardian"
                    className="h-4 w-4 text-brand-600"
                    checked={guardian.isPrimary}
                    onChange={() => setPrimary(guardian.key)}
                  />
                  Primary contact for this student
                </label>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Admission documents" description="Choose a status for each document. Mark conditional documents as not_applicable when they are not needed for this admission." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {DOCUMENT_ITEMS.map((document) => (
            <Field key={document.key} label={document.label} htmlFor={`document-${document.key}`}>
              <Select
                id={`document-${document.key}`}
                value={admissionDocuments[document.key]}
                onChange={(event) => setAdmissionDocuments((current) => ({ ...current, [document.key]: event.target.value as typeof current[typeof document.key] }))}
              >
                {DOCUMENT_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
              </Select>
            </Field>
          ))}
        </div>
        <p className="px-5 pb-5 text-xs text-slate-500">This checklist tracks whether each item is pending, received or verified. It does not upload file attachments.</p>
      </Card>

      <div className="sticky bottom-0 z-20 -mx-2 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-6px_16px_rgba(15,23,42,0.08)] backdrop-blur lg:col-span-2">
        <Link to="/students">
          <Button variant="secondary" type="button">
            Cancel
          </Button>
        </Link>
        <Button
          type="submit"
          loading={mutation.isPending}
          disabled={!sectionId || !academicYearId || !guardians[0]?.firstName.trim()}
        >
          Admit student
        </Button>
      </div>
    </form>
  );
}
