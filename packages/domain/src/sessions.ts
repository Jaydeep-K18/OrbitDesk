/** Pure focus-session rules (ROADMAP §7.2). The API persists; these functions decide. */

export type SessionStatusValue = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'ENDED_EARLY' | 'CANCELLED';
export type BlockKindValue = 'work' | 'break';

export interface SessionTimes {
  status: SessionStatusValue;
  startsAt: Date;
  endsAt: Date;
  endedAt?: Date | null;
}

export interface BlockLike {
  id?: string;
  idx?: number;
  kind: BlockKindValue;
  startsAt: Date;
  endsAt: Date;
}

const TERMINAL: SessionStatusValue[] = ['COMPLETED', 'ENDED_EARLY', 'CANCELLED'];

export function isTerminal(status: SessionStatusValue): boolean {
  return TERMINAL.includes(status);
}

/**
 * Status derived from time on every read, so a late lifecycle job never shows wrong state.
 * Jobs only persist the transition and trigger side effects.
 */
export function effectiveStatus(s: SessionTimes, now: Date): SessionStatusValue {
  if (isTerminal(s.status)) return s.status;
  const t = now.getTime();
  if (t >= s.endsAt.getTime()) return 'COMPLETED';
  if (t >= s.startsAt.getTime()) return 'ACTIVE';
  return 'SCHEDULED';
}

export type SessionAction = 'start' | 'end' | 'extend' | 'cancel';

/** Which user actions are legal for the effective status. */
export function canPerform(action: SessionAction, status: SessionStatusValue): boolean {
  switch (action) {
    case 'start':
    case 'cancel':
      return status === 'SCHEDULED';
    case 'end':
    case 'extend':
      return status === 'ACTIVE';
  }
}

/** The block containing `now`, if any. */
export function currentBlock<T extends BlockLike>(blocks: T[], now: Date): T | null {
  const t = now.getTime();
  return blocks.find((b) => t >= b.startsAt.getTime() && t < b.endsAt.getTime()) ?? null;
}

/** Whether blocking rules should be applied right now. */
export function isBlockingActive(
  session: SessionTimes & { blockDuringBreaks: boolean },
  blocks: BlockLike[],
  now: Date,
): boolean {
  if (effectiveStatus(session, now) !== 'ACTIVE') return false;
  const block = currentBlock(blocks, now);
  if (!block) return false;
  return block.kind === 'work' || session.blockDuringBreaks;
}

export interface ClippedPart<T extends BlockLike> {
  block: T;
  start: Date;
  end: Date;
}

/**
 * Clips an activity interval to work blocks (and an optional outer window, e.g. the actual
 * session window), splitting it at block boundaries. Time in breaks or outside is dropped.
 */
export function clipToWorkBlocks<T extends BlockLike>(
  start: Date,
  end: Date,
  blocks: T[],
  window?: { start: Date; end: Date },
): ClippedPart<T>[] {
  const parts: ClippedPart<T>[] = [];
  const s = start.getTime();
  const e = end.getTime();
  const ws = window ? window.start.getTime() : -Infinity;
  const we = window ? window.end.getTime() : Infinity;
  for (const block of [...blocks].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    if (block.kind !== 'work') continue;
    const ps = Math.max(s, block.startsAt.getTime(), ws);
    const pe = Math.min(e, block.endsAt.getTime(), we);
    if (pe > ps) parts.push({ block, start: new Date(ps), end: new Date(pe) });
  }
  return parts;
}

/** Shift every block so the first one starts at `newStart` (used by "start early"). */
export function shiftBlocks<T extends BlockLike>(blocks: T[], newStart: Date): T[] {
  if (blocks.length === 0) return blocks;
  const first = Math.min(...blocks.map((b) => b.startsAt.getTime()));
  const delta = newStart.getTime() - first;
  return blocks.map((b) => ({
    ...b,
    startsAt: new Date(b.startsAt.getTime() + delta),
    endsAt: new Date(b.endsAt.getTime() + delta),
  }));
}

/** Extend a session by `minutes`: the last block grows, as does the session end. */
export function extendBlocks<T extends BlockLike>(blocks: T[], minutes: number): T[] {
  if (blocks.length === 0) return blocks;
  const sorted = [...blocks].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const lastIdx = sorted.length - 1;
  return sorted.map((b, i) =>
    i === lastIdx ? { ...b, endsAt: new Date(b.endsAt.getTime() + minutes * 60_000) } : b,
  );
}

/** Dominant task category among the current block's tasks (ties broken by priority). */
const CATEGORY_PRIORITY = [
  'coding_practice',
  'project_dev',
  'study',
  'research',
  'writing',
  'other',
];

export function dominantCategory(categories: string[]): string {
  if (categories.length === 0) return 'other';
  const counts = new Map<string, number>();
  for (const c of categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return CATEGORY_PRIORITY.indexOf(a[0]) - CATEGORY_PRIORITY.indexOf(b[0]);
  })[0]![0];
}
