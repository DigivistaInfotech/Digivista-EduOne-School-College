import { useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AsterleafBrand } from '../components/AsterleafLogo';
import { Button, Card } from '../components/ui';
import { roleLabel } from '../lib/format';

export function InstitutionSelectionPage(): ReactNode {
  const { status, user, memberships, setActiveSchool, logout } = useAuth();
  const navigate = useNavigate();
  const [selectedSchoolId, setSelectedSchoolId] = useState('');

  if (status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Checking your session…</div>;
  }
  if (status === 'anonymous') return <Navigate to="/login" replace />;

  function continueToSchool(): void {
    if (!memberships.some((entry) => entry.schoolId === selectedSchoolId)) return;
    setActiveSchool(selectedSchoolId);
    navigate('/', { replace: true });
  }

  return (
    <main className="min-h-screen bg-[#F3F6FA] px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <AsterleafBrand showTagline={false} />
          <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
            <p className="text-sm font-semibold text-[#087F83]">Signed in as {user?.displayName}</p>
            <h1 className="mt-2 text-2xl font-extrabold text-[#182944]">Choose your institution</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Select a school you are assigned to. Your modules and access will follow the role granted to you in that school.
            </p>
          </div>

          <div className="space-y-3 px-6 py-6 sm:px-8">
            {memberships.map((entry) => {
              const selected = selectedSchoolId === entry.schoolId;
              return (
                <button
                  key={entry.schoolId}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedSchoolId(entry.schoolId)}
                  className={`w-full rounded-2xl border-2 p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087F83] focus-visible:ring-offset-2 ${selected ? 'border-[#087F83] bg-[#DDF4EC]/50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <span className="flex flex-wrap items-start justify-between gap-3">
                    <span>
                      <span className="block text-base font-bold text-[#182944]">{entry.schoolName}</span>
                      <span className="mt-1 block text-xs text-slate-500">Institution code: {entry.schoolCode}</span>
                    </span>
                    {selected && <span className="rounded-full bg-[#087F83] px-2.5 py-1 text-xs font-bold text-white">Selected</span>}
                  </span>
                  <span className="mt-3 flex flex-wrap gap-2">
                    {entry.roles.length ? entry.roles.map((role) => (
                      <span key={role} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{roleLabel(role)}</span>
                    )) : <span className="text-xs text-slate-500">No role assigned</span>}
                  </span>
                </button>
              );
            })}

            {memberships.length === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
                This account is not assigned to an active institution. Ask your institution administrator to grant access.
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button size="lg" disabled={!selectedSchoolId || !memberships.some((entry) => entry.schoolId === selectedSchoolId)} onClick={continueToSchool}>
                Continue to selected school
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
