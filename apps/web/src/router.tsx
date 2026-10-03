import { Navigate, Outlet, createBrowserRouter, useLocation, type RouteObject } from 'react-router';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/app-layout';
import { NotFoundPage } from '@/pages/placeholder-page';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/features/auth/auth-pages';
import { OverviewPage } from '@/features/overview/overview-page';
import { TasksPage } from '@/features/tasks/tasks-page';
import { SessionsPage } from '@/features/sessions/sessions-page';
import { NewSessionPage } from '@/features/sessions/session-builder';
import { ActiveSessionPage } from '@/features/sessions/active-session';
import { ReportPage } from '@/features/sessions/report-page';
import { AnalyticsPage } from '@/features/analytics/analytics-page';
import { DomainsPage } from '@/features/domains/domains-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';
import { PrivacyPage } from '@/features/privacy/privacy-page';

function FullPageSpinner() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

/** Protected area: waits for session restore, then redirects anonymous users to login. */
function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') {
    const next = location.pathname + location.search;
    return (
      <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    );
  }
  return <Outlet />;
}

/** Auth pages. Once signed in, go to `?next=`, or onboarding right after registering. */
function PublicOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const next = new URLSearchParams(location.search).get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
    return (
      <Navigate
        to={safeNext ?? (location.pathname === '/register' ? '/onboarding' : '/')}
        replace
      />
    );
  }
  return <Outlet />;
}

export const routes: RouteObject[] = [
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
    ],
  },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'sessions', element: <SessionsPage /> },
          { path: 'sessions/new', element: <NewSessionPage /> },
          { path: 'sessions/:id', element: <ReportPage /> },
          { path: 'session', element: <ActiveSessionPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
          { path: 'domains', element: <DomainsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'onboarding', element: <OnboardingPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
