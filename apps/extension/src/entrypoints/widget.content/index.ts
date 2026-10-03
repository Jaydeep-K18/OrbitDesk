/**
 * Floating focus widget (ROADMAP 1.4). A small square on the page edge that expands into a
 * card showing ONLY the remaining session time. Rendered in a Shadow DOM so pages can't
 * restyle it and it can't leak styles into pages. Plain DOM (no framework) keeps the
 * content script tiny, because it is injected into every page.
 */
import { COMPLETE_SHOW_MS, clampY, widgetView, type WidgetView } from '../../core/widget-model';
import { emptyState, liveStatus, serverNowMs, type StoredState } from '../../core/state';
import type { WidgetPrefs } from '../../lib/storage';

const CSS = `
:host { all: initial; }
.root { position: fixed; right: 0; z-index: 2147483647; font: 600 14px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; }
button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
  background: #4f46e5; color: #fff; border-radius: 10px 0 0 10px; box-shadow: 0 4px 14px rgb(0 0 0 / .25); user-select: none; touch-action: none; }
button:focus-visible { outline: 2px solid #a5b4fc; outline-offset: 2px; }
button.collapsed { width: 34px; height: 34px; }
button.expanded { height: 38px; padding: 0 12px 0 10px; font-variant-numeric: tabular-nums; font-size: 16px; }
button.break { background: #0284c7; }
button.complete { width: auto; height: 34px; padding: 0 12px; background: #16a34a; font-size: 13px; }
svg { display: block; flex: none; }
@media (prefers-reduced-motion: no-preference) { button { transition: width .15s ease, padding .15s ease; } }
`;

function ring(progress: number): string {
  const r = 9;
  const c = 2 * Math.PI * r;
  return `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <circle cx="11" cy="11" r="${r}" fill="none" stroke="rgb(255 255 255 / .3)" stroke-width="3"/>
    <circle cx="11" cy="11" r="${r}" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - progress)).toFixed(2)}" transform="rotate(-90 11 11)"/>
  </svg>`;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    let stored: StoredState = emptyState;
    let prefs: WidgetPrefs = { expanded: false, y: 0.4 };
    let completedAt: number | null = null;
    let lastSessionActive = false;
    let timer: number | null = null;

    const host = document.createElement('focusguard-widget');
    // Inline !important beats page stylesheets (even `* { display: none !important }`).
    host.style.cssText =
      'all: initial !important; display: block !important; position: fixed !important; top: 0 !important; right: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; visibility: visible !important; opacity: 1 !important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const root = document.createElement('div');
    root.className = 'root';
    const button = document.createElement('button');
    button.type = 'button';
    root.append(button);
    shadow.append(style, root);
    (document.documentElement ?? document.body).append(host);
    ctx.onInvalidated(() => host.remove());

    const render = () => {
      if (completedAt !== null && Date.now() - completedAt >= COMPLETE_SHOW_MS) completedAt = null;
      const view: WidgetView = widgetView(stored, prefs, {
        localNowMs: Date.now(),
        fullscreen: !!document.fullscreenElement,
        completedAt,
      });
      root.style.top = `${clampY(prefs.y) * 100}vh`;
      root.style.display = view.mode === 'hidden' ? 'none' : 'block';
      button.className = `${view.mode}${view.inBreak ? ' break' : ''}`;
      button.setAttribute('aria-label', view.ariaLabel || 'FocusGuard');
      button.setAttribute('aria-expanded', String(view.mode === 'expanded'));
      if (view.mode === 'complete') button.textContent = 'Session complete ✓';
      else if (view.mode === 'expanded') button.innerHTML = `${ring(view.progress)}<span></span>`;
      else button.innerHTML = ring(view.progress);
      // The time is set via textContent (no HTML from data ever reaches innerHTML).
      if (view.mode === 'expanded') button.querySelector('span')!.textContent = view.remainingLabel;
      schedule(view);
    };

    /** 1 s ticks only while expanded and visible; 30 s otherwise (ROADMAP perf budget). */
    const schedule = (view: WidgetView) => {
      if (timer !== null) clearTimeout(timer);
      if (view.mode === 'hidden' && completedAt === null) return;
      const delay =
        view.mode === 'expanded' && !document.hidden
          ? 1000
          : view.mode === 'complete'
            ? 1000
            : 30_000;
      timer = window.setTimeout(render, delay);
    };

    const load = async () => {
      const res = await browser.storage.local.get(['fg:state', 'fg:widget']);
      stored = (res['fg:state'] as StoredState | undefined) ?? emptyState;
      prefs = (res['fg:widget'] as WidgetPrefs | undefined) ?? prefs;
      lastSessionActive =
        !!stored.state?.session &&
        liveStatus(stored.state.session, serverNowMs(stored.offsetMs)) === 'ACTIVE';
      render();
    };

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes['fg:widget']?.newValue) prefs = changes['fg:widget'].newValue as WidgetPrefs;
      if (changes['fg:state']) {
        stored = (changes['fg:state'].newValue as StoredState | undefined) ?? emptyState;
        const active =
          !!stored.state?.session &&
          liveStatus(stored.state.session, serverNowMs(stored.offsetMs)) === 'ACTIVE';
        if (lastSessionActive && !active) completedAt = Date.now();
        lastSessionActive = active;
      }
      render();
    });

    const setPrefs = (next: WidgetPrefs) => {
      prefs = next;
      void browser.storage.local.set({ 'fg:widget': next });
      render();
    };

    // Click toggles; vertical drag (beyond a 4px threshold) moves the widget.
    let drag: { startY: number; startFrac: number; moved: boolean } | null = null;
    button.addEventListener('pointerdown', (e) => {
      drag = { startY: e.clientY, startFrac: clampY(prefs.y), moved: false };
      button.setPointerCapture(e.pointerId);
    });
    button.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        prefs = { ...prefs, y: clampY(drag.startFrac + dy / window.innerHeight) };
        root.style.top = `${prefs.y * 100}vh`;
      }
    });
    button.addEventListener('pointerup', () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (moved) setPrefs(prefs);
      else if (completedAt === null) setPrefs({ ...prefs, expanded: !prefs.expanded });
    });
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setPrefs({ ...prefs, expanded: !prefs.expanded });
      }
    });

    document.addEventListener('fullscreenchange', render);
    document.addEventListener('visibilitychange', render);
    browser.runtime.onMessage.addListener((msg) => {
      if ((msg as { type?: string })?.type === 'TOGGLE_WIDGET')
        setPrefs({ ...prefs, expanded: !prefs.expanded });
    });

    await load();
  },
});
