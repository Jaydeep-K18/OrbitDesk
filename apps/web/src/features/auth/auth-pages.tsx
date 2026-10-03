import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { browserTimeZone } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <img src="/favicon.svg" alt="" className="size-10" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">{children}</div>
        {footer ? (
          <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

function useFormErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const handle = (err: unknown) => {
    if (err instanceof ApiError) {
      setErrors(err.fieldErrors());
      setFormError(Object.keys(err.fieldErrors()).length ? null : err.message);
    } else setFormError('Network error. Is the API running?');
  };
  const reset = () => {
    setErrors({});
    setFormError(null);
  };
  return { errors, formError, handle, reset };
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

export function LoginPage() {
  const { login } = useAuth();
  const [busy, setBusy] = useState(false);
  const { errors, formError, handle, reset } = useFormErrors();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    reset();
    setBusy(true);
    try {
      // The route guard redirects (to ?next= or /) once the session is set.
      await login(String(form.get('email')), String(form.get('password')));
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to plan and protect your focus."
      footer={
        <>
          New here?{' '}
          <Link className="font-medium text-primary hover:underline" to="/register">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Email" error={errors.email}>
          {(p) => (
            <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />
          )}
        </Field>
        <Field label="Password" error={errors.password}>
          {(p) => (
            <Input
              {...p}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
        <Link
          to="/forgot-password"
          className="block text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthCard>
  );
}

/** Rough strength estimate shown while typing (server enforces length ≥ 10). */
function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score]! };
}

export function RegisterPage() {
  const { register } = useAuth();
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState('');
  const { errors, formError, handle, reset } = useFormErrors();
  const strength = passwordStrength(pw);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    reset();
    setBusy(true);
    try {
      await register({
        email: String(form.get('email')),
        password: pw,
        displayName: String(form.get('displayName')),
        timezone: browserTimeZone(),
      });
      toast.success('Account created. Check your email to verify it.');
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title="Create your account"
      subtitle="Plan → Focus → Block → Analyze → Improve"
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-primary hover:underline" to="/login">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field label="Name" error={errors.displayName}>
          {(p) => <Input {...p} name="displayName" autoComplete="name" required autoFocus />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 10 characters.">
          {(p) => (
            <Input
              {...p}
              name="password"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
            />
          )}
        </Field>
        {pw ? (
          <div className="space-y-1" aria-live="polite">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i < strength.score ? 'bg-primary' : 'bg-muted'}`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Strength: {strength.label}</p>
          </div>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { errors, formError, handle, reset } = useFormErrors();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: new FormData(e.currentTarget).get('email') },
      });
      setSent(true);
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard
      title="Reset your password"
      footer={
        <Link to="/login" className="hover:text-foreground">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm">
          If an account exists for that email, we've sent a reset link. It expires in 30 minutes.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Field label="Email" error={errors.email}>
            {(p) => (
              <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />
            )}
          </Field>
          <Button type="submit" className="w-full" disabled={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { errors, formError, handle, reset } = useFormErrors();
  const token = params.get('token') ?? '';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    reset();
    setBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password: new FormData(e.currentTarget).get('password') },
      });
      toast.success('Password updated. Log in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={formError ?? (errors.token ? 'This reset link is invalid.' : null)} />
        <Field label="New password" error={errors.password} hint="At least 10 characters.">
          {(p) => (
            <Input
              {...p}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              autoFocus
            />
          )}
        </Field>
        <Button type="submit" className="w-full" disabled={busy || !token}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'pending' | 'ok' | 'failed'>('pending');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke would consume the single-use token twice
    ran.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token: params.get('token') ?? '' } })
      .then(() => setState('ok'))
      .catch(() => setState('failed'));
  }, [params]);
  return (
    <AuthCard
      title="Email verification"
      footer={
        <Link to="/" className="hover:text-foreground">
          Go to dashboard
        </Link>
      }
    >
      <p className="text-sm" role="status">
        {state === 'pending' && 'Verifying…'}
        {state === 'ok' && 'Your email is verified. Thanks!'}
        {state === 'failed' &&
          'This link is invalid or has expired. Request a new one from Settings.'}
      </p>
    </AuthCard>
  );
}
