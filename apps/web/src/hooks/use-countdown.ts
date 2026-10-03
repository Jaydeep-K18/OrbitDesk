import { useEffect, useState } from 'react';
import { computeClockOffset, formatCountdown, remainingMs } from '@focusguard/domain';

/**
 * Server-authoritative countdown: the client never trusts its own clock. `serverNow` from the
 * last API response gives the offset; remaining time is recomputed every second.
 */
export function useCountdown(
  endsAt: string | null | undefined,
  serverNow: string | null | undefined,
) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (serverNow) setOffset(computeClockOffset(serverNow, Date.now()));
  }, [serverNow]);

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return { ms: 0, label: '00:00', serverNowMs: now + offset };
  const ms = remainingMs(endsAt, now, offset);
  return { ms, label: formatCountdown(ms), serverNowMs: now + offset };
}
