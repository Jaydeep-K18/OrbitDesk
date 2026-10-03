import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { DomainRule } from '@focusguard/contracts';
import { displayHost } from '@focusguard/domain';
import { useDomainRuleMutations, useDomainRules } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';

const PRESETS = [
  { id: 'social', label: 'Social media' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'news', label: 'News' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'gaming', label: 'Gaming' },
];

const LISTS: { list: DomainRule['list']; title: string; description: string; tone: string }[] = [
  {
    list: 'blocked',
    title: 'Always block',
    description: 'Pre-filled as blocked in every new session.',
    tone: 'bg-distraction/10 text-distraction',
  },
  {
    list: 'relevant',
    title: 'Always relevant',
    description: 'Counted as planned work in every session.',
    tone: 'bg-planned/10 text-planned',
  },
  {
    list: 'never_track',
    title: 'Never track',
    description: 'FocusGuard never records visits to these sites.',
    tone: 'bg-muted text-foreground',
  },
];

function ListCard({
  rules,
  list,
  title,
  description,
  tone,
}: {
  rules: DomainRule[];
  list: DomainRule['list'];
  title: string;
  description: string;
  tone: string;
}) {
  const { add, remove } = useDomainRuleMutations();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    add.mutate(
      { domain: draft, list },
      {
        onSuccess: () => setDraft(''),
        onError: (err) =>
          setError(
            err instanceof ApiError ? (err.fieldErrors().domain ?? err.message) : 'Could not add',
          ),
      },
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label={`Add to ${title}`}
            placeholder="example.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <Button type="submit" variant="secondary" disabled={!draft.trim()}>
            Add
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {rules.length === 0 ? <p className="text-sm text-muted-foreground">Empty</p> : null}
          {rules.map((r) => (
            <span
              key={r.id}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
            >
              {displayHost(r.host)}
              {r.scope !== '*' ? (
                <span className="opacity-70">({r.scope.replace('_', ' ')})</span>
              ) : null}
              <button
                className="rounded-full hover:bg-black/10"
                aria-label={`Remove ${r.host}`}
                onClick={() => remove.mutate(r.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function DomainsPage() {
  const { data, isLoading, error, refetch } = useDomainRules();
  const { preset } = useDomainRuleMutations();
  const rules = data?.items ?? [];
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Domains"
        description="Global lists that pre-fill new sessions and guide classification."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Quick add to “Always block”:</span>
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant="outline"
            onClick={() =>
              preset.mutate(p.id, {
                onSuccess: (r) =>
                  toast.success(`${p.label}: added ${r.added} site${r.added === 1 ? '' : 's'}`),
              })
            }
          >
            {p.label}
          </Button>
        ))}
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {LISTS.map((l) => (
            <ListCard key={l.list} {...l} rules={rules.filter((r) => r.list === l.list)} />
          ))}
          <Card>
            <CardHeader>
              <CardTitle>Always a distraction</CardTitle>
              <p className="text-xs text-muted-foreground">
                Created when you relabel activity and choose “remember”.
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {rules
                .filter((r) => r.list === 'always_distraction')
                .map((r) => (
                  <span
                    key={r.id}
                    className="rounded-full bg-distraction/10 px-2 py-0.5 text-xs font-medium text-distraction"
                  >
                    {displayHost(r.host)} {r.scope !== '*' ? `(${r.scope.replace('_', ' ')})` : ''}
                  </span>
                ))}
              {rules.every((r) => r.list !== 'always_distraction') ? (
                <p className="text-sm text-muted-foreground">Empty</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
