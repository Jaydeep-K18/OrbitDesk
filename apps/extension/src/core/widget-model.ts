/** Pure view-model for the floating widget (ROADMAP 1.4 widget spec). */
import { formatCountdown } from '@focusguard/domain/clock';
import type { StoredState } from './state';
import { inBreak, liveStatus, serverNowMs } from './state';

export type WidgetMode = 'hidden' | 'collapsed' | 'expanded' | 'complete';

export interface WidgetView {
  mode: WidgetMode;
  remainingLabel: string;
  progress: number;
  inBreak: boolean;
  ariaLabel: string;
}

export const COMPLETE_SHOW_MS = 5000;

export function widgetView(
  stored: StoredState,
  prefs: { expanded: boolean },
  opts: { localNowMs: number; fullscreen: boolean; completedAt: number | null },
): WidgetView {
  const hidden: WidgetView = {
    mode: 'hidden',
    remainingLabel: '',
    progress: 0,
    inBreak: false,
    ariaLabel: '',
  };
  const st = stored.state;
  if (opts.fullscreen) return hidden;
  if (opts.completedAt !== null && opts.localNowMs - opts.completedAt < COMPLETE_SHOW_MS) {
    return { ...hidden, mode: 'complete', progress: 1, ariaLabel: 'FocusGuard: session complete' };
  }
  if (!st?.session || !st.settings.widgetEnabled) return hidden;
  const now = serverNowMs(stored.offsetMs, opts.localNowMs);
  if (liveStatus(st.session, now) !== 'ACTIVE') return hidden;

  const start = Date.parse(st.session.startedAt ?? st.session.startsAt);
  const end = Date.parse(st.session.endsAt);
  const remaining = Math.max(0, end - now);
  const minutes = Math.ceil(remaining / 60_000);
  return {
    mode: prefs.expanded ? 'expanded' : 'collapsed',
    remainingLabel: formatCountdown(remaining),
    progress: Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start))),
    inBreak: inBreak(st.session, now),
    ariaLabel: `FocusGuard: ${minutes} minute${minutes === 1 ? '' : 's'} remaining`,
  };
}

/** Clamp the vertical position (fraction of viewport height) so the widget stays visible. */
export function clampY(y: number): number {
  return Math.min(0.92, Math.max(0.04, Number.isFinite(y) ? y : 0.4));
}
