import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Command } from 'cmdk';
import { Dialog, DialogContent } from '@/components/ui/primitives';
import { useTheme } from '@/lib/theme';

const ITEMS = [
  { label: 'New focus session', to: '/sessions/new', shortcut: 'N' },
  { label: 'Current session', to: '/session' },
  { label: 'Overview', to: '/' },
  { label: 'Tasks', to: '/tasks' },
  { label: 'Sessions', to: '/sessions' },
  { label: 'Analytics', to: '/analytics' },
  { label: 'Domains', to: '/domains' },
  { label: 'Settings', to: '/settings' },
];

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

/** ⌘K / Ctrl+K command palette and the global "N" shortcut for a new session. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { setPreference } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (
        e.key.toLowerCase() === 'n' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isTyping(e.target) &&
        !open
      ) {
        e.preventDefault();
        navigate('/sessions/new');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Command palette" className="p-0 [&>h2]:sr-only">
        <Command label="Command palette" className="px-2 pb-2">
          <Command.Input
            autoFocus
            placeholder="Type a command or page…"
            className="h-11 w-full border-b bg-transparent px-3 text-sm outline-none"
          />
          <Command.List className="max-h-72 overflow-auto py-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results.
            </Command.Empty>
            <Command.Group
              heading="Go to"
              className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1"
            >
              {ITEMS.map((i) => (
                <Command.Item
                  key={i.to}
                  onSelect={() => go(i.to)}
                  className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm text-foreground data-[selected=true]:bg-muted"
                >
                  {i.label}
                  {i.shortcut ? (
                    <kbd className="rounded border px-1.5 text-xs text-muted-foreground">
                      {i.shortcut}
                    </kbd>
                  ) : null}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group
              heading="Theme"
              className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1"
            >
              {(['light', 'dark', 'system'] as const).map((t) => (
                <Command.Item
                  key={t}
                  onSelect={() => {
                    setPreference(t);
                    setOpen(false);
                  }}
                  className="cursor-pointer rounded-md px-3 py-2 text-sm text-foreground data-[selected=true]:bg-muted"
                >
                  Theme: {t}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
