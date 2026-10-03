import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { displayHost, normalizeDomain } from '@focusguard/domain';
import { cn } from '@/lib/utils';

/**
 * Chip input for domains. Validates and normalizes as the user types (Enter/comma to add),
 * so what the user sees is exactly what will be blocked or treated as relevant.
 */
export function DomainChips({
  label,
  value,
  onChange,
  conflictWith = [],
  tone = 'neutral',
  placeholder = 'e.g. instagram.com',
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  conflictWith?: string[];
  tone?: 'blocked' | 'relevant' | 'neutral';
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (raw: string) => {
    const text = raw.trim().replace(/,$/, '');
    if (!text) return;
    const n = normalizeDomain(text);
    if (!n) {
      setError(`"${text}" isn't a valid website domain`);
      return;
    }
    if (conflictWith.includes(n.host)) {
      setError(`${n.host} is already in the other list`);
      return;
    }
    if (!value.includes(n.host)) onChange([...value, n.host]);
    setDraft('');
    setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const chipTone =
    tone === 'blocked'
      ? 'bg-distraction/10 text-distraction'
      : tone === 'relevant'
        ? 'bg-planned/10 text-planned'
        : 'bg-muted text-foreground';

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div
        className={cn(
          'flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 focus-within:outline-2 focus-within:outline-ring',
          error && 'border-destructive',
        )}
      >
        {value.map((host) => (
          <span
            key={host}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              chipTone,
            )}
          >
            {displayHost(host)}
            <button
              type="button"
              className="rounded-full hover:bg-black/10"
              aria-label={`Remove ${host}`}
              onClick={() => onChange(value.filter((h) => h !== host))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
