/** Options page: pairing status, manual code entry (fallback), sync and unpair. */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Status {
  ok: boolean;
  paired: boolean;
  queued: number;
  dropped: number;
}

async function refresh() {
  const status = (await browser.runtime.sendMessage({ type: 'STATUS' })) as Status;
  const badge = $('status');
  badge.textContent = status.paired ? 'Connected' : 'Not connected';
  badge.className = `status ${status.paired ? 'ok' : 'no'}`;
  $('pair-section').hidden = status.paired;
  $('paired-section').hidden = !status.paired;
  $('queue').textContent =
    `${status.queued} event(s) waiting to upload${status.dropped ? ` · ${status.dropped} dropped while offline` : ''}.`;
}

$<HTMLFormElement>('pair-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('error').textContent = '';
  const code = $<HTMLInputElement>('code').value.replace(/[\s-]/g, '').toUpperCase();
  const res = (await browser.runtime.sendMessage({ type: 'PAIR_CODE', code })) as {
    ok: boolean;
    error?: string;
  };
  if (!res.ok) $('error').textContent = res.error ?? 'Pairing failed';
  await refresh();
});

$('sync').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'SYNC_NOW' });
  await refresh();
});

$('unpair').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'UNPAIR' });
  await refresh();
});

void refresh();
