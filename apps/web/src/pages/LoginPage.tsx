import { useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, errorMessage } from "../lib/api";
import { requestPasswordReset, resetPassword } from "../lib/endpoints";
import { Alert, Button, Field, Icon, Input } from "../components/ui";
import digivistaLogo from "../components/digivista-infotech-logo.png";
import { SchoolChildrenIllustration } from "../components/SchoolChildrenIllustration";
import { IndiaFlag } from "../components/IndiaFlag";

const SIGN_IN_TAGLINE = "One Institution. One Connected Future.";

const DEMO_ACCOUNTS = import.meta.env.DEV ? [
  {
    email: "admin@demo.test",
    password: "Admin@12345",
    role: "Main Administrator (Principal / Management)",
  },
  {
    email: "coordinator@demo.test",
    password: "Coord@12345",
    role: "Academic Coordinator",
  },
  {
    email: "teacher@demo.test",
    password: "Teacher@12345",
    role: "Teacher (Class 1-A · assigned section only)",
  },
  {
    email: "parent@demo.test",
    password: "Parent@12345",
    role: "Parent (Verified linked children Aarav & Anaya)",
  },
  {
    email: "student@demo.test",
    password: "Student@12345",
    role: "Student (Kabir Menon · Senior Secondary)",
  },
  {
    email: "finance@demo.test",
    password: "Finance@12345",
    role: "Finance & Accounts Officer",
  },
  {
    email: "transport@demo.test",
    password: "Staff@12345",
    role: "Transport Supervisor",
  },
  {
    email: "librarian@demo.test",
    password: "Staff@12345",
    role: "Head Librarian",
  },
  {
    email: "auditor@demo.test",
    password: "Auditor@12345",
    role: "Internal Compliance Auditor",
  },
] : [];

export function LoginPage(): ReactNode {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot" | "reset">(() =>
    new URLSearchParams(window.location.search).has("resetToken") ? "reset" : "signin",
  );
  const [resetToken, setResetToken] = useState(() =>
    new URLSearchParams(window.location.search).get("resetToken") ?? "",
  );
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  if (status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(
        email.trim(),
        password,
        needsCode ? totpCode.trim() : undefined,
      );
      navigate("/", { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "mfa_required") {
        setNeedsCode(true);
        setError(null);
        setNotice(
          "Enter the 6-digit code from your authenticator app to finish signing in.",
        );
      } else if (caught instanceof ApiError && caught.code === "invalid_totp") {
        setNeedsCode(true);
        setError(errorMessage(caught));
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestPasswordReset(email.trim());
      setNotice(result.message);
      if (result.devToken) {
        setResetToken(result.devToken);
        setMode("reset");
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setError("The new password and confirmation do not match.");
      setSubmitting(false);
      return;
    }
    try {
      await resetPassword(resetToken.trim(), newPassword);
      setNotice(
        "Your password has been replaced. Sign in with the new password.",
      );
      setMode("signin");
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNeedsCode(false);
      setTotpCode("");
      navigate("/login", { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_1fr] bg-[#F3F6FA]">
      {/* Brand presentation banner with Midnight Navy (#182944) */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[#182944] p-10 xl:p-14 text-white lg:flex">
        {/* Central Educational Artwork & Core Messaging */}
        <div className="relative z-10 my-auto py-6 max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#087F83]/30 px-4 py-1 text-xs font-bold text-[#DDF4EC] border border-[#087F83]/50">
            <IndiaFlag className="h-4 w-6 shrink-0 rounded-sm" />
            <span>For schools, colleges, and universities</span>
          </div>

          <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight leading-[1.12]">
            {SIGN_IN_TAGLINE}
          </h1>

          <p className="mt-4 text-base font-medium text-slate-300 leading-relaxed max-w-xl">
            Manage admissions, attendance, fees, and academics in one place.
          </p>

          {/* High-Fidelity Schoolchildren Illustration */}
          <div className="mt-6 rounded-2xl overflow-hidden border border-white/15 bg-white/5 shadow-2xl p-2 backdrop-blur-xs">
            <SchoolChildrenIllustration className="w-full h-auto rounded-xl" />
          </div>
        </div>

      </section>

      {/* Login / Auth form container */}
      <section className="relative flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200/90 bg-white p-7 sm:p-9 shadow-sm">
          <div className="mb-6">
            <img src={digivistaLogo} alt="Digivista Infotech" className="h-auto w-full max-w-[210px]" />
            <p className="mt-2 text-sm font-bold text-[#182944]">
              Education ERP · Nursery to University
            </p>
            <p className="mt-1 text-xs font-bold text-[#087F83] lg:hidden">
              {SIGN_IN_TAGLINE}
            </p>
          </div>

          <div className="mb-6">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#087F83] block mb-1">
              {mode === "signin"
                ? "Sign In to DIGI"
                : mode === "forgot"
                  ? "Account Recovery"
                  : "New Credentials"}
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight text-[#182944]">
              {mode === "signin"
                ? "Welcome back"
                : mode === "forgot"
                  ? "Reset your password"
                  : "Choose a new password"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {mode === "signin"
                ? "Sign in with the email address registered with your institution."
                : mode === "forgot"
                  ? "We’ll email a single-use reset link to your registered address if an account exists."
                  : "Enter your reset token and new password."}
            </p>
          </div>

          {error && (
            <div className="mb-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
          {notice && (
            <div className="mb-4">
              <Alert tone="info">{notice}</Alert>
            </div>
          )}

          {mode === "signin" && (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Field label="Email address" htmlFor="email">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="min-h-[44px]"
                />
              </Field>

              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••••••"
                    className="pr-12 min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-[#087F83] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F83] transition rounded-lg"
                  >
                    <Icon
                      name={showPassword ? "eyeOff" : "eye"}
                      className="h-4 w-4"
                    />
                  </button>
                </div>
              </Field>

              {needsCode && (
                <Field
                  label="Authenticator 6-Digit Code"
                  htmlFor="totp"
                  hint="Six digits from your configured TOTP app."
                >
                  <Input
                    id="totp"
                    name="totp"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value)}
                    placeholder="123456"
                    className="min-h-[44px]"
                  />
                </Field>
              )}

              <Button
                type="submit"
                loading={submitting}
                className="w-full min-h-[44px] rounded-2xl bg-[#087F83] hover:bg-[#076b6e] text-white"
              >
                Sign In to DIGI
              </Button>

              <div className="flex items-center justify-between pt-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    setNotice(null);
                  }}
                  className="font-bold text-[#087F83] hover:underline"
                >
                  Forgot your password?
                </button>
                {import.meta.env.DEV && (
                  <button
                    type="button"
                    onClick={() => setShowDemo((show) => !show)}
                    className="font-semibold text-slate-500 hover:text-slate-800"
                  >
                    {showDemo ? "Hide demo logins" : "Quick demo accounts"}
                  </button>
                )}
              </div>
            </form>
          )}

          {mode === "forgot" && (
            <form className="space-y-4" onSubmit={handleForgot} noValidate>
              <Field
                label="Your registered email address"
                htmlFor="forgot-email"
              >
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@asterleaf.school"
                  className="min-h-[44px]"
                />
              </Field>

              <Button
                type="submit"
                loading={submitting}
                className="w-full min-h-[44px] rounded-2xl"
              >
                Send Password Reset Link
              </Button>

              <div className="pt-2 text-center text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                    setNotice(null);
                  }}
                  className="font-bold text-[#087F83] hover:underline"
                >
                  Return to sign in
                </button>
              </div>
            </form>
          )}

          {mode === "reset" && (
            <form className="space-y-4" onSubmit={handleReset} noValidate>
              <Field label="Reset Token" htmlFor="token">
                <Input
                  id="token"
                  required
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                  className="min-h-[44px]"
                />
              </Field>

              <Field
                label="New Password (min 12 characters)"
                htmlFor="new-password"
              >
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="pr-12 min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={
                      showNewPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-[#087F83] focus:outline-none transition rounded-lg"
                  >
                    <Icon
                      name={showNewPassword ? "eyeOff" : "eye"}
                      className="h-4 w-4"
                    />
                  </button>
                </div>
              </Field>

              <Field label="Confirm New Password" htmlFor="confirm-password">
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="min-h-[44px]"
                />
              </Field>

              <Button
                type="submit"
                loading={submitting}
                className="w-full min-h-[44px] rounded-2xl"
              >
                Confirm & Replace Password
              </Button>

              <div className="pt-2 text-center text-xs">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="font-bold text-[#087F83] hover:underline"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Demo account quick login picker */}
          {import.meta.env.DEV && showDemo && mode === "signin" && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
                Click any persona to auto-fill credentials:
              </p>
              <div className="space-y-1.5 max-h-60 overflow-y-auto scroll-thin">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => {
                      setEmail(acc.email);
                      setPassword(acc.password);
                      setError(null);
                    }}
                    className="w-full text-left rounded-xl p-2.5 bg-white border border-slate-200/80 hover:border-[#087F83] hover:shadow-xs transition text-xs flex flex-col"
                  >
                    <div className="flex items-center justify-between font-bold text-[#182944]">
                      <span>{acc.role}</span>
                      <span className="text-[10px] text-[#087F83] font-extrabold uppercase">
                        Select
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {acc.email}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
