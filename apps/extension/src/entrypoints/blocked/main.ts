/**
 * Blocked page (ROADMAP 1.4). DNR redirects blocked navigations here; loading this page is
 * what records the blocked attempt. There is deliberately no unblock button.
 */
import { displayHost } from '@focusguard/domain/display';
import { getLocal } from '../../lib/storage';
import { DASHBOARD_URL } from '../../lib/config';
import { serverNowMs } from '../../core/state';

const params = new URLSearchParams(location.search);
const domain = params.get('d') ?? '';
const sessionId = params.get('s') ?? '';

const $ = (id: string) => document.getElementById(id)!;
$('domain').textContent = domain ? displayHost(domain) : 'This site';
(document.getElementById('dashboard') as HTMLAnchorElement).href = `${DASHBOARD_URL}/session`;

$('back').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = DASHBOARD_URL;
});

async function render() {
  const stored = await getLocal('fg:state');
  const session = stored.state?.session;
  if (!session) return;
  const now = serverNowMs(stored.offsetMs);
  const endsAt = Date.parse(session.endsAt);
  const minsLeft = Math.max(0, Math.ceil((endsAt - now) / 60_000));
  const until = new Date(endsAt - stored.offsetMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  $('until').textContent = `Blocked until ${until} · ${minsLeft} min left in your session`;
  const open = session.tasks.filter((t) => !t.completedAt);
  if (open.length) {
    $('tasks-section').hidden = false;
    const ul = $('tasks');
    ul.replaceChildren(
      ...open.map((t) => {
        const li = document.createElement('li');
        li.textContent = t.title; // textContent: never inject HTML
        return li;
      }),
    );
  }
}

void render();
if (domain && sessionId) {
  void browser.runtime
    .sendMessage({ type: 'BLOCKED_ATTEMPT', domain, sessionId })
    .catch(() => undefined);
}
