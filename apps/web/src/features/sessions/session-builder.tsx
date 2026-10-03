import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useDomainRules, useSessionMutations, useTasks } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/primitives';
import { DomainChips } from '@/components/domain-chips';

const PRESETS = [25, 45, 60, 90];

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Create or schedule a focus session (ROADMAP 1.2 / wireframe §3). */
export function SessionBuilder({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const { create } = useSessionMutations();
  const tasks = useTasks();
  const rules = useDomainRules();

  const [startMode, setStartMode] = useState<'now' | 'at'>('now');
  const [startAt, setStartAt] = useState(() => localInputValue(new Date(Date.now() + 15 * 60_000)));
  const [duration, setDuration] = useState(45);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [relevant, setRelevant] = useState<string[]>([]);
  const [blockDuringBreaks, setBlockDuringBreaks] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  // Pre-fill lists from the user's global "always block" / "always relevant" rules.
  useEffect(() => {
    if (prefilled || !rules.data) return;
    const global = rules.data.items.filter((r) => r.scope === '*');
    setBlocked(global.filter((r) => r.list === 'blocked').map((r) => r.host));
    setRelevant(global.filter((r) => r.list === 'relevant').map((r) => r.host));
    setPrefilled(true);
  }, [rules.data, prefilled]);

  const openTasks = useMemo(
    () => (tasks.data?.items ?? []).filter((t) => t.status !== 'done'),
    [tasks.data],
  );
  const endsAt = useMemo(() => {
    const start = startMode === 'now' ? new Date() : new Date(startAt);
    return new Date(start.getTime() + duration * 60_000);
  }, [startMode, startAt, duration]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      const session = await create.mutateAsync({
        startMode,
        ...(startMode === 'at' ? { startsAt: new Date(startAt).toISOString() } : {}),
        durationMin: duration,
        taskIds,
        blockedDomains: blocked,
        relevantDomains: relevant,
        blockDuringBreaks,
      });
      toast.success(startMode === 'now' ? 'Focus session started' : 'Session scheduled');
      onDone?.();
      navigate(startMode === 'now' ? '/session' : `/sessions/${session.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError('Could not reach the server.');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {formError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">When</legend>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="startMode"
              checked={startMode === 'now'}
              onChange={() => setStartMode('now')}
            />
            Start now
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="startMode"
              checked={startMode === 'at'}
              onChange={() => setStartMode('at')}
            />
            Start at
          </label>
          {startMode === 'at' ? (
            <Input
              type="datetime-local"
              aria-label="Start time"
              className="w-auto"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              aria-invalid={errors.startsAt ? true : undefined}
            />
          ) : null}
        </div>
        {errors.startsAt ? <p className="text-xs text-destructive">{errors.startsAt}</p> : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Duration</legend>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setDuration(m)}
              aria-pressed={duration === m}
              className={cn(
                'h-8 rounded-md border px-3 text-sm',
                duration === m
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              )}
            >
              {m} min
            </button>
          ))}
          <Input
            type="number"
            min={5}
            max={480}
            aria-label="Custom duration in minutes"
            className="w-24"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
          <span className="text-sm text-muted-foreground">
            ends at {endsAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        {errors.durationMin ? (
          <p className="text-xs text-destructive">{errors.durationMin}</p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tasks</legend>
        {openTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open tasks. You can still start a session.
          </p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-auto rounded-md border p-2">
            {openTasks.map((t) => (
              <li key={t.id}>
                <label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={taskIds.includes(t.id)}
                    onChange={(e) =>
                      setTaskIds((ids) =>
                        e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id),
                      )
                    }
                  />
                  {t.title}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <DomainChips
        label="Relevant sites"
        tone="relevant"
        value={relevant}
        onChange={setRelevant}
        conflictWith={blocked}
        placeholder="e.g. leetcode.com"
      />
      <DomainChips
        label="Blocked sites"
        tone="blocked"
        value={blocked}
        onChange={setBlocked}
        conflictWith={relevant}
      />

      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={blockDuringBreaks}
          onCheckedChange={setBlockDuringBreaks}
          aria-label="Keep blocking during breaks"
        />
        Keep blocking during breaks
      </label>

      <div className="flex justify-end gap-2">
        {onDone ? (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={create.isPending}>
          {startMode === 'now' ? 'Start session' : 'Schedule session'}
        </Button>
      </div>
    </form>
  );
}

export function NewSessionPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New focus session</h1>
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <SessionBuilder />
      </div>
    </div>
  );
}
