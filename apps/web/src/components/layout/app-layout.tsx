import { Link, NavLink, Outlet } from 'react-router';
import {
  BarChart3,
  CalendarClock,
  Globe,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { useAuth } from '@/lib/auth';
import { useActiveSession } from '@/lib/queries';
import { useCountdown } from '@/hooks/use-countdown';
import { Button } from '@/components/ui/button';
import { CommandPalette } from '@/components/command-palette';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/sessions', label: 'Sessions', icon: CalendarClock },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/domains', label: 'Domains', icon: Globe },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const Icon = THEME_ICON[preference];
  const next = THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length]!;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${preference}. Switch to ${next}`}
      title={`Theme: ${preference}`}
      onClick={() => setPreference(next)}
    >
      <Icon />
    </Button>
  );
}

/** Live "focusing" pill in the header while a session runs. */
function SessionPill() {
  const { data } = useActiveSession();
  const session = data?.session;
  const { label } = useCountdown(
    session?.status === 'ACTIVE' ? session.endsAt : null,
    data?.serverNow,
  );
  if (!session || session.status !== 'ACTIVE') return null;
  return (
    <Link
      to="/session"
      className="flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground"
    >
      <span className="size-2 animate-pulse rounded-full bg-planned" aria-hidden />
      Focusing <span className="tabular-nums">{label}</span>
    </Link>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 px-5">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="font-semibold tracking-tight">FocusGuard</span>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  isActive && 'bg-accent text-accent-foreground hover:bg-accent',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          Press <kbd className="rounded border px-1">Ctrl</kbd>+
          <kbd className="rounded border px-1">K</kbd> for commands
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b bg-card/60 px-4 backdrop-blur md:px-8">
          <span className="font-semibold md:hidden">FocusGuard</span>
          <div className="ml-auto flex items-center gap-2">
            <SessionPill />
            <ThemeToggle />
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.displayName}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Log out"
              title="Log out"
              onClick={() => void logout()}
            >
              <LogOut />
            </Button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
        <nav
          aria-label="Mobile"
          className="sticky bottom-0 grid grid-cols-6 border-t bg-card md:hidden"
        >
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  'flex h-12 items-center justify-center text-muted-foreground',
                  isActive && 'text-primary',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
            </NavLink>
          ))}
        </nav>
      </div>
      <CommandPalette />
    </div>
  );
}
