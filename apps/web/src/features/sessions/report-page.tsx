import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import type { ActivityLabel, ActivitySegment, SessionReport } from '@focusguard/contracts';
import { useRelabel, useReport, useSessionMutations } from '@/lib/queries';
import {
  formatDate,
  formatDuration,
  formatPercent,
  formatRange,
  LABEL_META,
  STATUS_META,
} from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Badge, ErrorState, Skeleton } from '@/components/ui/primitives';

const RELABEL_OPTIONS: ActivityLabel[] = [
  'PLANNED',
  'UNPLANNED_RELEVANT',
  'DISTRACTION',
  'UNCERTAIN',
];

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  );
}

/** Horizontal band colored by label across the session, with blocked-attempt markers. */
function Timeline({ report }: { report: SessionReport }) {
  const start = Date.parse(report.session.startedAt ?? report.session.startsAt);
  const end = Date.parse(report.session.endedAt ?? report.session.endsAt);
  const span = Math.max(1, end - start);
  const pct = (t: number) => `${(Math.min(Math.max(t - start, 0), span) / span) * 100}%`;
  return (
    <div>
      <div
        className="relative h-8 overflow-hidden rounded-md bg-outside"
        role="img"
        aria-label="Session timeline by activity label"
      >
        {report.segments.map((s) => {
          const left = Date.parse(s.startedAt);
          const width = Date.parse(s.endedAt) - left;
          return (
            <div
              key={s.id}
              title={`${s.host} · ${formatDuration(s.durationSec)} · ${LABEL_META[s.label ?? 'UNCERTAIN'].text}`}
              className="absolute top-0 h-full"
              style={{
                left: pct(left),
                width: `${(width / span) * 100}%`,
                background: LABEL_META[s.label ?? 'UNCERTAIN'].color,
              }}
            />
          );
        })}
        {report.blockedAttempts.map((a) => (
          <div
            key={a.id}
            title={`Blocked ${a.host}`}
            className="absolute top-0 h-full w-0.5 bg-blocked"
            style={{ left: pct(Date.parse(a.at)) }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(['PLANNED', 'UNPLANNED_RELEVANT', 'DISTRACTION', 'UNCERTAIN'] as const).map((l) => (
          <span key={l} className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: LABEL_META[l].color }} />{' '}
            {LABEL_META[l].text}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-outside" /> Outside browser
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 bg-blocked" /> Blocked attempt
        </span>
      </div>
    </div>
  );
}

function SegmentRow({ seg, sessionId }: { seg: ActivitySegment; sessionId: string }) {
  const relabel = useRelabel(sessionId);
  const [applyToFuture, setApplyToFuture] = useState(false);
  const label = seg.label ?? 'UNCERTAIN';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{seg.host}</p>
        <p className="truncate text-xs text-muted-foreground">
          {new Date(seg.startedAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          · {formatDuration(seg.durationSec)}
          {seg.labelSource &&
          seg.labelSource !== 'session_list' &&
          seg.labelSource !== 'user_feedback'
            ? ' · estimated'
            : ''}
          {seg.explanation ? ` · ${seg.explanation}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={applyToFuture}
            onChange={(e) => setApplyToFuture(e.target.checked)}
          />
          remember
        </label>
        <Select
          aria-label={`Label for ${seg.host}`}
          className="h-8 w-40 text-xs"
          value={label}
          onChange={(e) =>
            relabel.mutate(
              { segmentId: seg.id, label: e.target.value, applyToFuture },
              {
                onSuccess: () => toast.success('Label updated'),
                onError: () => toast.error('Could not update label'),
              },
            )
          }
        >
          {RELABEL_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {LABEL_META[l].text}
            </option>
          ))}
        </Select>
      </div>
    </li>
  );
}

export function ReportPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error, refetch } = useReport(id);
  const m = useSessionMutations();
  if (isLoading) return <Skeleton className="mx-auto h-96 max-w-5xl" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const { session, metrics } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Session report</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(session.startsAt)} ·{' '}
            {formatRange(session.startedAt ?? session.startsAt, session.endedAt ?? session.endsAt)}
            {session.endReason ? ` · “${session.endReason}”` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!data.final ? (
            <Badge className="bg-accent text-accent-foreground">Live · updating</Badge>
          ) : null}
          <Badge className={STATUS_META[session.status]?.className}>
            {STATUS_META[session.status]?.text}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Planned focus" value={formatDuration(metrics.plannedFocusSec)} />
            <Metric
              label="Planned productive"
              value={formatDuration(metrics.plannedSec)}
              tone="text-planned"
            />
            <Metric
              label="Unplanned but relevant"
              value={formatDuration(metrics.relevantSec)}
              tone="text-relevant"
            />
            <Metric
              label="Distraction"
              value={formatDuration(metrics.distractionSec)}
              tone="text-distraction"
            />
            <Metric label="Uncertain" value={formatDuration(metrics.uncertainSec)} />
            <Metric label="Outside browser" value={formatDuration(metrics.outsideBrowserSec)} />
            <Metric label="Blocked attempts" value={metrics.blockedAttempts} />
            <Metric label="Website switches" value={metrics.websiteSwitches} />
            <Metric label="Task completion" value={formatPercent(metrics.taskCompletion)} />
            <Metric label="Focus quality" value={formatPercent(metrics.focusQuality)} />
          </dl>
          {metrics.extensionOfflineSec > 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              The extension was offline for {formatDuration(metrics.extensionOfflineSec)} during
              this session.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline report={data} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Planned</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {session.tasks.length ? (
              <ul className="space-y-1" aria-label="Tasks">
                {session.tasks.map((t) => (
                  <li key={t.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={t.completedAt !== null}
                        onChange={(e) =>
                          m.toggleTask.mutate({
                            sessionId: session.id,
                            sessionTaskId: t.id,
                            completed: e.target.checked,
                          })
                        }
                      />
                      <span className={t.completedAt ? 'line-through text-muted-foreground' : ''}>
                        {t.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No tasks were attached.</p>
            )}
            <p>
              <span className="text-muted-foreground">Relevant: </span>
              {session.relevantDomains.join(', ') || '—'}
            </p>
            <p>
              <span className="text-muted-foreground">Blocked: </span>
              {session.blockedDomains.join(', ') || '—'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actual activity</CardTitle>
          </CardHeader>
          <CardContent>
            {data.domains.length ? (
              <ul className="space-y-2 text-sm">
                {data.domains.map((d) => (
                  <li key={d.domain} className="flex items-center justify-between gap-2">
                    <span className="truncate">{d.domain}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatDuration(d.seconds)}</span>
                      <Badge className={LABEL_META[d.label].className}>
                        {LABEL_META[d.label].text}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No browser activity was recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Was this classified right?</CardTitle>
          <p className="text-xs text-muted-foreground">
            Labels marked “estimated” are FocusGuard's best guess. Fix any mistake; tick “remember”
            to apply it next time.
          </p>
        </CardHeader>
        <CardContent>
          {data.segments.length ? (
            <ul className="divide-y">
              {data.segments.map((s) => (
                <SegmentRow key={s.id} seg={s} sessionId={session.id} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to review.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <CardTitle>AI insight</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Coming soon: a short, grounded explanation of this session that uses only the numbers
          above.
        </CardContent>
      </Card>
    </div>
  );
}
