import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Clock, Plug, ShieldOff, Sparkles, Target } from 'lucide-react';
import { useDashboard } from '@/lib/queries';
import {
  formatDuration,
  formatPercent,
  formatRange,
  formatDate,
  LABEL_META,
  shortDate,
  STATUS_META,
} from '@/lib/format';
import { pingExtension, type ExtensionStatus } from '@/lib/extension';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatTile,
} from '@/components/ui/primitives';
import { ChartCard } from '@/components/chart-card';
import { ActiveSessionCard } from '@/features/sessions/active-session';

function ExtensionStatusCard() {
  const [status, setStatus] = useState<ExtensionStatus | 'checking'>('checking');
  useEffect(() => {
    void pingExtension().then(setStatus);
  }, []);
  if (status === 'connected' || status === 'checking') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-card p-4">
      <div className="flex items-center gap-3">
        <Plug className="size-5 text-primary" aria-hidden />
        <div>
          <p className="text-sm font-medium">
            {status === 'not_installed'
              ? 'Install the FocusGuard extension'
              : 'Connect your extension'}
          </p>
          <p className="text-xs text-muted-foreground">
            Blocking and activity tracking need the Chrome extension.
          </p>
        </div>
      </div>
      <Button size="sm" asChild>
        <Link to="/onboarding">{status === 'not_installed' ? 'How to install' : 'Pair now'}</Link>
      </Button>
    </div>
  );
}

export function OverviewPage() {
  const { data, isLoading, error, refetch } = useDashboard();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Overview"
        description="Plan, focus, and see how your sessions are going."
        actions={
          <Button asChild>
            <Link to="/sessions/new" aria-keyshortcuts="n">
              New session
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        <ExtensionStatusCard />
        {error ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

        {isLoading ? (
          <Skeleton className="h-36" />
        ) : data?.activeSession ? (
          <section aria-label="Current session">
            <ActiveSessionCard
              session={data.activeSession}
              serverNow={data.serverNow}
              blockedAttempts={data.liveCounters?.blockedAttempts}
              compact
            />
          </section>
        ) : (
          <EmptyState
            icon={<Target />}
            title="No focus session running"
            description="Start a session to block distracting sites and track what you work on."
            action={
              <Button asChild>
                <Link to="/sessions/new">Start your first session</Link>
              </Button>
            }
          />
        )}

        <section aria-label="Today" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {isLoading || !data ? (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <StatTile
                label="Focus time today"
                icon={<Clock />}
                value={formatDuration(data.today.focusSec)}
                hint={`${formatDuration(data.today.productiveSec)} productive`}
              />
              <StatTile
                label="Sessions completed"
                icon={<CheckCircle2 />}
                value={data.today.sessionsCompleted}
              />
              <StatTile
                label="Blocked attempts"
                icon={<ShieldOff />}
                value={data.today.blockedAttempts}
              />
              <StatTile
                label="Tasks"
                icon={<Target />}
                value={`${data.today.tasksCompleted}/${data.today.tasksPlanned}`}
                hint={
                  data.today.tasksPlanned
                    ? formatPercent(data.today.tasksCompleted / data.today.tasksPlanned) +
                      ' complete'
                    : 'No session tasks yet'
                }
              />
            </>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <ChartCard
            className="lg:col-span-2"
            title="Focus time, last 7 days"
            table={{
              columns: ['Date', 'Focus'],
              rows: (data?.last7Days ?? []).map((d) => [
                shortDate(d.date),
                formatDuration(d.focusSec),
              ]),
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(data?.last7Days ?? []).map((d) => ({
                  date: shortDate(d.date),
                  minutes: Math.round(d.focusSec / 60),
                }))}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  width={32}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)' }}
                  contentStyle={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                  formatter={(v) => [`${v} min`, 'Focus']}
                />
                <Bar dataKey="minutes" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden />
              <CardTitle>AI insights</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Insights unlock after your first sessions. FocusGuard will summarize what helped and
              what distracted you, using only your real data.
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {data && data.recentActivity.length > 0 ? (
                <ul className="divide-y text-sm">
                  {data.recentActivity.map((a, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-2">
                      <span className="truncate">
                        <span className="mr-2 text-xs text-muted-foreground tabular-nums">
                          {new Date(a.at).toLocaleTimeString(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                        {a.host}
                      </span>
                      {a.label ? (
                        <Badge className={LABEL_META[a.label].className}>
                          {LABEL_META[a.label].text}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Activity appears here during focus sessions.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {data && data.recentSessions.length > 0 ? (
                <ul className="divide-y text-sm">
                  {data.recentSessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/sessions/${s.id}`}
                        className="flex items-center justify-between gap-2 py-2 hover:text-primary"
                      >
                        <span>
                          {formatDate(s.startsAt)} · {formatRange(s.startsAt, s.endsAt)}
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge className={STATUS_META[s.status]?.className}>
                            {STATUS_META[s.status]?.text}
                          </Badge>
                          <span className="w-12 text-right tabular-nums text-muted-foreground">
                            {formatPercent(s.focusQuality)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Finished sessions and their reports show up here.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
