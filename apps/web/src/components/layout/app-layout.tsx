import { NavLink, Outlet } from 'react-router';
import {
  BarChart3,
  CalendarClock,
  Globe,
  LayoutDashboard,
  ListTodo,
  Monitor,
  Moon,
  Settings,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { Button } from '@/components/ui/button';

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

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card/60 px-4 backdrop-blur md:px-8">
          <span className="font-semibold md:hidden">FocusGuard</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <main id="main" className="flex-1 p-4 md:p-8">
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
    </div>
  );
}
