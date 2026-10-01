import { describe, expect, it } from 'vitest';
import {
  canPerform,
  clipToWorkBlocks,
  currentBlock,
  dominantCategory,
  effectiveStatus,
  extendBlocks,
  isBlockingActive,
  isTerminal,
  shiftBlocks,
  type BlockLike,
  type SessionStatusValue,
} from '../src/sessions.js';

const t = (iso: string) => new Date(iso);
const session = (status: SessionStatusValue = 'SCHEDULED') => ({
  status,
  startsAt: t('2026-10-02T15:00:00Z'),
  endsAt: t('2026-10-02T17:00:00Z'),
  blockDuringBreaks: false,
});
const blocks: BlockLike[] = [
  {
    id: 'b0',
    kind: 'work',
    startsAt: t('2026-10-02T15:00:00Z'),
    endsAt: t('2026-10-02T15:45:00Z'),
  },
  {
    id: 'b1',
    kind: 'break',
    startsAt: t('2026-10-02T15:45:00Z'),
    endsAt: t('2026-10-02T15:55:00Z'),
  },
  {
    id: 'b2',
    kind: 'work',
    startsAt: t('2026-10-02T15:55:00Z'),
    endsAt: t('2026-10-02T17:00:00Z'),
  },
];

describe('effectiveStatus (derived from time on every read)', () => {
  it.each([
    ['2026-10-02T14:59:59Z', 'SCHEDULED'],
    ['2026-10-02T15:00:00Z', 'ACTIVE'],
    ['2026-10-02T16:59:59Z', 'ACTIVE'],
    ['2026-10-02T17:00:00Z', 'COMPLETED'],
  ])('at %s → %s', (now, expected) => {
    expect(effectiveStatus(session(), t(now))).toBe(expected);
  });

  it('a late lifecycle job never matters: persisted ACTIVE past its end reads as COMPLETED', () => {
    expect(effectiveStatus(session('ACTIVE'), t('2026-10-02T18:00:00Z'))).toBe('COMPLETED');
  });

  it.each(['COMPLETED', 'ENDED_EARLY', 'CANCELLED'] as const)('terminal %s stays terminal', (s) => {
    expect(effectiveStatus(session(s), t('2026-10-02T15:30:00Z'))).toBe(s);
    expect(isTerminal(s)).toBe(true);
  });
});

describe('canPerform (legal transitions)', () => {
  it.each([
    ['start', 'SCHEDULED', true],
    ['cancel', 'SCHEDULED', true],
    ['end', 'SCHEDULED', false],
    ['extend', 'SCHEDULED', false],
    ['end', 'ACTIVE', true],
    ['extend', 'ACTIVE', true],
    ['start', 'ACTIVE', false],
    ['cancel', 'ACTIVE', false],
    ['end', 'COMPLETED', false],
    ['extend', 'ENDED_EARLY', false],
    ['start', 'CANCELLED', false],
  ] as const)('%s on %s → %s', (action, status, ok) => {
    expect(canPerform(action, status)).toBe(ok);
  });
});

describe('blocks', () => {
  it('finds the current block', () => {
    expect(currentBlock(blocks, t('2026-10-02T15:50:00Z'))?.id).toBe('b1');
    expect(currentBlock(blocks, t('2026-10-02T14:00:00Z'))).toBeNull();
  });

  it('blocks during work, lifts during breaks unless blockDuringBreaks', () => {
    expect(isBlockingActive(session(), blocks, t('2026-10-02T15:10:00Z'))).toBe(true);
    expect(isBlockingActive(session(), blocks, t('2026-10-02T15:50:00Z'))).toBe(false);
    expect(
      isBlockingActive(
        { ...session(), blockDuringBreaks: true },
        blocks,
        t('2026-10-02T15:50:00Z'),
      ),
    ).toBe(true);
    expect(isBlockingActive(session('ENDED_EARLY'), blocks, t('2026-10-02T15:10:00Z'))).toBe(false);
    expect(isBlockingActive(session(), blocks, t('2026-10-02T17:30:00Z'))).toBe(false);
  });

  it('clips intervals to work blocks, splitting at boundaries and dropping break time', () => {
    const parts = clipToWorkBlocks(t('2026-10-02T15:40:00Z'), t('2026-10-02T16:00:00Z'), blocks);
    expect(parts.map((p) => [p.block.id, p.start.toISOString(), p.end.toISOString()])).toEqual([
      ['b0', '2026-10-02T15:40:00.000Z', '2026-10-02T15:45:00.000Z'],
      ['b2', '2026-10-02T15:55:00.000Z', '2026-10-02T16:00:00.000Z'],
    ]);
  });

  it('clips to an outer window (e.g. ended early)', () => {
    const parts = clipToWorkBlocks(t('2026-10-02T15:00:00Z'), t('2026-10-02T15:30:00Z'), blocks, {
      start: t('2026-10-02T15:00:00Z'),
      end: t('2026-10-02T15:20:00Z'),
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]!.end.toISOString()).toBe('2026-10-02T15:20:00.000Z');
  });

  it('returns nothing outside all work blocks', () => {
    expect(clipToWorkBlocks(t('2026-10-02T15:46:00Z'), t('2026-10-02T15:50:00Z'), blocks)).toEqual(
      [],
    );
  });

  it('shifts blocks to a new start (start early) preserving durations', () => {
    const shifted = shiftBlocks(blocks, t('2026-10-02T14:30:00Z'));
    expect(shifted[0]!.startsAt.toISOString()).toBe('2026-10-02T14:30:00.000Z');
    expect(shifted[2]!.endsAt.toISOString()).toBe('2026-10-02T16:30:00.000Z');
    expect(shiftBlocks([], t('2026-10-02T14:30:00Z'))).toEqual([]);
  });

  it('extends only the last block', () => {
    const ext = extendBlocks(blocks, 15);
    expect(ext[2]!.endsAt.toISOString()).toBe('2026-10-02T17:15:00.000Z');
    expect(ext[0]!.endsAt.toISOString()).toBe('2026-10-02T15:45:00.000Z');
    expect(extendBlocks([], 15)).toEqual([]);
  });
});

describe('dominantCategory', () => {
  it('picks the most frequent category, breaking ties by priority', () => {
    expect(dominantCategory([])).toBe('other');
    expect(dominantCategory(['study', 'study', 'coding_practice'])).toBe('study');
    expect(dominantCategory(['study', 'coding_practice'])).toBe('coding_practice');
    expect(dominantCategory(['writing', 'research'])).toBe('research');
  });
});
