import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays } from '@focusguard/domain';
import { useAuth } from '@/lib/auth';
import { useDomainsAnalytics, useHeatmap, useOverview, useSessionsStats } from '@/lib/queries';
import { formatDuration, formatPercent, localDateString, shortDate } from '@/lib/format';
import { ChartCard } from '@/components/chart-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ErrorState,
  PageHeader,
  Skeleton,
  StatTile,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const tooltipStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
};
const minutes = (s: number) => Math.round(s / 60);

function DomainBars({
  title,
  rows,
  color,
}: {
  title: string;
  rows: { domain: string; seconds: number; visits: number }[];
  color: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <ChartCard
      title={title}
      table={{
        columns: ['Domain', 'Time', 'Visits'],
        rows: rows.map((r) => [r.domain, formatDuration(r.seconds), r.visits]),
      }}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data for this range.</p>
      ) : (
        <ul className="space-y-2.5 text-sm">
          {rows.map((r) => (
            <li key={r.domain}>
              <div className="flex justify-between">
                <span className="truncate">{r.domain}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatDuration(r.seconds)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(r.seconds / max) * 100}%`, background: color }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function AnalyticsPage() {
  const { user } = useAuth();
  const tz = user?.timezone ?? 'UTC';
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const to = localDateString(new Date(), tz);
  const from = addDays(to, -(days - 1));
  const range = { from, to };

  const overview = useOverview({ ...range, granularity });
  const domains = useDomainsAnalytics(range);
  const heatmap = useHeatmap(range);
  const stats = useSessionsStats(range);

  const points = useMemo(
    () =>
      (overview.data?.points ?? []).map((p) => ({
        bucket: shortDate(p.bucket),
        focus: minutes(p.focusSec),
        Planned: minutes(p.plannedSec),
        Relevant: minutes(p.relevantSec),
        Distraction: minutes(p.distractionSec),
        Uncertain: minutes(p.uncertainSec),
        blocked: p.blockedAttempts,
      })),
    [overview.data],
  );

  const heatMax = Math.max(1, ...(heatmap.data?.cells.flat().map((c) => c.focusSec) ?? [1]));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Analytics"
        description="Understand when and how you focus best."
        actions={
          <>
            <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <TabsList aria-label="Date range">
                {RANGES.map((r) => (
                  <TabsTrigger key={r.days} value={String(r.days)}>
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={granularity} onValueChange={(v) => setGranularity(v as 'day' | 'week')}>
              <TabsList aria-label="Granularity">
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
              </TabsList>
            </Tabs>
          </>
        }
      />

      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : null}

      <div className="space-y-6">
        <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {overview.isLoading || stats.isLoading ? (
            [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <StatTile label="Focus time" value={formatDuration(overview.data?.totals.focusSec)} />
              <StatTile
                label="Completion rate"
                value={formatPercent(stats.data?.completionRate)}
                hint={`${stats.data?.sessionsCompleted ?? 0} of ${stats.data?.sessionsStarted ?? 0} sessions`}
              />
              <StatTile
                label="Avg session"
                value={
                  stats.data?.avgDurationMin ? `${Math.round(stats.data.avgDurationMin)} min` : '—'
                }
                hint={`Tasks done: ${formatPercent(stats.data?.taskCompletionRate)}`}
              />
              <StatTile
                label="Blocked attempts"
                value={overview.data?.totals.blockedAttempts ?? 0}
              />
              <StatTile
                label="Unplanned browsing"
                value={formatDuration(overview.data?.totals.unplannedBrowsingSec)}
                hint={`${overview.data?.totals.switchesPerHour ?? 0} switches/hour`}
              />
            </>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title={`Focus time per ${granularity}`}
            table={{
              columns: ['Period', 'Focus (min)', 'Blocked'],
              rows: points.map((p) => [p.bucket, p.focus, p.blocked]),
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                  minTickGap={12}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={32}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: 'var(--muted)' }}
                  formatter={(v) => [`${v} min`, 'Focus']}
                />
                <Bar dataKey="focus" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Where browsing time went"
            description="Minutes by activity label"
            table={{
              columns: ['Period', 'Planned', 'Relevant', 'Distraction', 'Uncertain'],
              rows: points.map((p) => [
                p.bucket,
                p.Planned,
                p.Relevant,
                p.Distraction,
                p.Uncertain,
              ]),
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--muted-foreground)"
                  minTickGap={12}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  width={32}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Planned" stackId="a" fill="var(--label-planned)" />
                <Bar dataKey="Relevant" stackId="a" fill="var(--label-relevant)" />
                <Bar dataKey="Distraction" stackId="a" fill="var(--label-distraction)" />
                <Bar
                  dataKey="Uncertain"
                  stackId="a"
                  fill="var(--label-uncertain)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <DomainBars
            title="Most visited domains"
            rows={domains.data?.mostVisited ?? []}
            color="var(--primary)"
          />
          <DomainBars
            title="Most distracting domains"
            rows={domains.data?.mostDistracting ?? []}
            color="var(--label-distraction)"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Most productive times</CardTitle>
            <p className="text-xs text-muted-foreground">
              Focus time by weekday and hour ({tz}). Darker means more focus; hover a cell for focus
              quality.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {heatmap.isLoading ? (
              <Skeleton className="h-48" />
            ) : (
              <table className="border-separate border-spacing-0.5 text-[10px]">
                <caption className="sr-only">Focus time by weekday and hour</caption>
                <thead>
                  <tr>
                    <th scope="col" />
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} scope="col" className="w-5 font-normal text-muted-foreground">
                        {h % 3 === 0 ? h : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(heatmap.data?.cells ?? []).map((row, d) => (
                    <tr key={d}>
                      <th scope="row" className="pr-2 text-right font-normal text-muted-foreground">
                        {WEEKDAYS[d]}
                      </th>
                      {row.map((c, h) => (
                        <td
                          key={h}
                          title={`${WEEKDAYS[d]} ${h}:00 · ${formatDuration(c.focusSec)}${c.quality !== null ? ` · quality ${formatPercent(c.quality)}` : ''}`}
                          aria-label={`${WEEKDAYS[d]} ${h}:00, ${formatDuration(c.focusSec)} focus`}
                          className="size-5 rounded-sm"
                          style={{
                            background: c.focusSec
                              ? `color-mix(in oklch, var(--primary) ${Math.round(15 + (c.focusSec / heatMax) * 85)}%, transparent)`
                              : 'var(--muted)',
                          }}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
