import { Link } from 'react-router';
import { CalendarClock } from 'lucide-react';
import { useSessions } from '@/lib/queries';
import { formatDate, formatRange, STATUS_META } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';

export function SessionsPage() {
  const { data, isLoading, error, refetch } = useSessions();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Sessions"
        description="Your scheduled, running and past focus sessions."
        actions={
          <Button asChild>
            <Link to="/sessions/new">New session</Link>
          </Button>
        }
      />
      {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <ul className="divide-y rounded-xl border bg-card">
          {data.items.map((s) => (
            <li key={s.id}>
              <Link
                to={s.status === 'ACTIVE' ? '/session' : `/sessions/${s.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <div>
                  <p className="font-medium">{formatDate(s.startsAt)}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatRange(s.startsAt, s.endsAt)} · {s.plannedDurationMin} min
                    {s.tasks.length
                      ? ` · ${s.tasks.length} task${s.tasks.length > 1 ? 's' : ''}`
                      : ''}
                  </p>
                </div>
                <Badge className={STATUS_META[s.status]?.className}>
                  {STATUS_META[s.status]?.text}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<CalendarClock />}
          title="No sessions yet"
          description="Schedule a session or start one now."
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
