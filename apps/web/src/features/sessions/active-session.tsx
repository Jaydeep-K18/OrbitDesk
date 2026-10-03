import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ShieldOff, Timer } from 'lucide-react';
import type { FocusSession } from '@focusguard/contracts';
import { useCountdown } from '@/hooks/use-countdown';
import { useActiveSession, useSessionMutations } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { formatRange } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  EmptyState,
  ProgressRing,
  Skeleton,
} from '@/components/ui/primitives';

function useSessionActions(session: FocusSession) {
  const m = useSessionMutations();
  const onError = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
  return {
    extend: (minutes: number) =>
      m.extend.mutate(
        { id: session.id, version: session.version, minutes },
        { onSuccess: () => toast.success(`Extended by ${minutes} minutes`), onError },
      ),
    end: (reason?: string) =>
      m.end.mutate(
        { id: session.id, version: session.version, reason },
        { onSuccess: () => toast('Session ended early'), onError },
      ),
    toggleTask: (sessionTaskId: string, completed: boolean) =>
      m.toggleTask.mutate({ sessionId: session.id, sessionTaskId, completed }, { onError }),
    busy: m.extend.isPending || m.end.isPending,
  };
}

/** End-early confirmation: friction is intentional (ROADMAP §7.2). */
function EndEarlyDialog({
  onConfirm,
  disabled,
}: {
  onConfirm: (reason?: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        End early
      </Button>
      <DialogContent
        title="End this session early?"
        description="Blocking stops immediately. Your report keeps what you did so far."
      >
        <label className="text-sm font-medium" htmlFor="end-reason">
          Reason (optional)
        </label>
        <Textarea
          id="end-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Finished my tasks"
          className="mt-1.5"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep focusing
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(reason.trim() || undefined);
              setOpen(false);
            }}
          >
            End session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ActiveSessionCard({
  session,
  serverNow,
  blockedAttempts,
  compact = false,
}: {
  session: FocusSession;
  serverNow: string;
  blockedAttempts?: number | null;
  compact?: boolean;
}) {
  const scheduled = session.status === 'SCHEDULED';
  const target = scheduled ? session.startsAt : session.endsAt;
  const { ms, label } = useCountdown(target, serverNow);
  const total = Date.parse(session.endsAt) - Date.parse(session.startsAt);
  const progress = scheduled ? 0 : 1 - ms / total;
  const actions = useSessionActions(session);
  const m = useSessionMutations();

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-5">
        <ProgressRing
          value={progress}
          size={compact ? 76 : 112}
          stroke={compact ? 6 : 8}
          label="Session progress"
        >
          <Timer className="size-5 text-primary" aria-hidden />
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            {scheduled ? 'Starts in' : 'Remaining'} ·{' '}
            {formatRange(session.startsAt, session.endsAt)}
          </p>
          <p
            className={
              compact
                ? 'text-3xl font-semibold tabular-nums'
                : 'text-5xl font-semibold tabular-nums'
            }
            aria-live="off"
          >
            {label}
          </p>
          {blockedAttempts !== undefined && blockedAttempts !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">
              <ShieldOff className="mr-1 inline size-4" aria-hidden />
              Blocked attempts so far:{' '}
              <span className="font-medium text-foreground">{blockedAttempts}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {scheduled ? (
            <>
              <Button onClick={() => m.start.mutate({ id: session.id, version: session.version })}>
                Start now
              </Button>
              <Button
                variant="outline"
                onClick={() => m.cancel.mutate({ id: session.id, version: session.version })}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={actions.busy}
                onClick={() => actions.extend(15)}
              >
                Extend +15
              </Button>
              <EndEarlyDialog onConfirm={actions.end} disabled={actions.busy} />
            </>
          )}
        </div>
      </div>

      {session.tasks.length > 0 ? (
        <ul className="mt-4 grid gap-1 sm:grid-cols-2" aria-label="Session tasks">
          {session.tasks.map((t) => (
            <li key={t.id}>
              <label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={t.completedAt !== null}
                  onChange={(e) => actions.toggleTask(t.id, e.target.checked)}
                />
                <span className={t.completedAt ? 'text-muted-foreground line-through' : ''}>
                  {t.title}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {!compact && session.blockedDomains.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Blocked: {session.blockedDomains.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

/** Full-page active session view (wireframe §4). */
export function ActiveSessionPage() {
  const active = useActiveSession();
  if (active.isLoading) return <Skeleton className="mx-auto h-48 max-w-3xl" />;
  const session = active.data?.session;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Focus session</h1>
      {session ? (
        <ActiveSessionCard session={session} serverNow={active.data!.serverNow} />
      ) : (
        <EmptyState
          icon={<Timer />}
          title="No session running"
          description="Start a focus session to block distractions and track your progress."
          action={
            <Button asChild>
              <Link to="/sessions/new">Start a session</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
