import { describe, expect, it } from 'vitest';
import {
  catalogSize,
  classifySegment,
  hostsInCategories,
  lookupDomainCategory,
  type ClassificationContext,
} from '../src/classification.js';
import { isSensitiveCategory, scrubTitle } from '../src/privacy.js';
import { normalizeDomain } from '../src/domains.js';

const seg = (host: string, durationSec = 120) => ({
  host,
  registrableDomain: normalizeDomain(host)?.registrableDomain ?? host,
  durationSec,
});

/** The spec's worked example: "Solve LeetCode — Binary Search", planned leetcode/github/claude. */
const leetcodeSession: ClassificationContext = {
  blockedHosts: ['instagram.com', 'reddit.com', 'netflix.com'],
  relevantHosts: ['leetcode.com', 'github.com', 'claude.ai'],
  overrides: [],
  taskCategories: ['coding_practice'],
};

describe('catalog', () => {
  it('has the seeded size and resolves parent domains', () => {
    expect(catalogSize()).toBeGreaterThan(400);
    expect(lookupDomainCategory('m.youtube.com')).toBe('video_mixed');
    expect(lookupDomainCategory('www.youtube.com')).toBe('video_mixed');
    expect(lookupDomainCategory('mail.google.com')).toBe('email');
    expect(lookupDomainCategory('docs.google.com')).toBe('productivity');
    expect(lookupDomainCategory('google.com')).toBe('search');
    expect(lookupDomainCategory('unknown-site-xyz.com')).toBeNull();
  });

  it('lists hosts in sensitive categories for the extension', () => {
    const hosts = hostsInCategories(['finance', 'email']);
    expect(hosts).toContain('mail.google.com');
    expect(hosts).toContain('hdfcbank.com');
    expect(hosts).not.toContain('github.com');
  });
});

describe('classifySegment — spec worked example (Phase 1 rules)', () => {
  it.each([
    ['leetcode.com', 'PLANNED', 'session_list'],
    ['geeksforgeeks.org', 'UNPLANNED_RELEVANT', 'rule'],
    ['youtube.com', 'UNCERTAIN', 'rule'],
    ['www.reddit.com', 'DISTRACTION', 'session_list'],
    ['timesofindia.indiatimes.com', 'DISTRACTION', 'rule'],
    ['stackoverflow.com', 'UNPLANNED_RELEVANT', 'rule'],
    ['chatgpt.com', 'UNPLANNED_RELEVANT', 'rule'],
    ['some-random-blog.net', 'UNCERTAIN', 'rule'],
  ])('%s → %s (%s)', (host, label, source) => {
    const c = classifySegment(seg(host), leetcodeSession);
    expect(c.label).toBe(label);
    expect(c.source).toBe(source);
    expect(c.classifierVersion).toBe('rules-v1');
    expect(c.explanation.length).toBeGreaterThan(10);
  });

  it('flags YouTube as needing context (the Phase 2 LLM decides)', () => {
    const c = classifySegment(seg('youtube.com'), leetcodeSession);
    expect(c.needsContext).toBe(true);
    expect(c.reasonCode).toBe('needs_context');
  });

  it('matches planned subdomains (gist.github.com counts as github.com)', () => {
    expect(classifySegment(seg('gist.github.com'), leetcodeSession).label).toBe('PLANNED');
  });

  it('unknown domains are UNCERTAIN, never DISTRACTION', () => {
    const c = classifySegment(seg('tiny-unknown-site.dev'), leetcodeSession);
    expect(c).toMatchObject({
      label: 'UNCERTAIN',
      reasonCode: 'unknown_domain',
      domainCategory: null,
    });
  });
});

describe('classifySegment — overrides and task context', () => {
  it('global always-relevant counts as PLANNED (0.95)', () => {
    const c = classifySegment(seg('notion.so'), {
      ...leetcodeSession,
      overrides: [{ host: 'notion.so', list: 'relevant', scope: '*' }],
    });
    expect(c).toMatchObject({ label: 'PLANNED', confidence: 0.95, source: 'user_override' });
  });

  it('task-scoped relevant override applies only to that task category', () => {
    const overrides = [
      { host: 'youtube.com', list: 'relevant' as const, scope: 'coding_practice' },
    ];
    expect(classifySegment(seg('youtube.com'), { ...leetcodeSession, overrides }).label).toBe(
      'UNPLANNED_RELEVANT',
    );
    expect(
      classifySegment(seg('youtube.com'), {
        ...leetcodeSession,
        overrides,
        taskCategories: ['writing'],
      }).label,
    ).toBe('UNCERTAIN');
  });

  it('always-distraction beats always-relevant; scoped beats global', () => {
    const c = classifySegment(seg('youtube.com'), {
      ...leetcodeSession,
      overrides: [
        { host: 'youtube.com', list: 'relevant', scope: '*' },
        { host: 'youtube.com', list: 'always_distraction', scope: '*' },
      ],
    });
    expect(c.label).toBe('DISTRACTION');
    const scoped = classifySegment(seg('youtube.com'), {
      ...leetcodeSession,
      overrides: [
        { host: 'youtube.com', list: 'always_distraction', scope: '*' },
        { host: 'youtube.com', list: 'relevant', scope: 'coding_practice' },
      ],
    });
    expect(scoped.label).toBe('UNPLANNED_RELEVANT');
  });

  it('session lists beat overrides', () => {
    const c = classifySegment(seg('github.com'), {
      ...leetcodeSession,
      overrides: [{ host: 'github.com', list: 'always_distraction', scope: '*' }],
    });
    expect(c.label).toBe('PLANNED');
  });

  it('uses the task category matrix (education is relevant for study, ambiguous for project work)', () => {
    const base = { blockedHosts: [], relevantHosts: [], overrides: [] };
    expect(classifySegment(seg('coursera.org'), { ...base, taskCategories: ['study'] }).label).toBe(
      'UNPLANNED_RELEVANT',
    );
    expect(
      classifySegment(seg('coursera.org'), { ...base, taskCategories: ['project_dev'] })
        .needsContext,
    ).toBe(true);
    expect(classifySegment(seg('netflix.com'), { ...base, taskCategories: [] }).label).toBe(
      'DISTRACTION',
    );
  });

  it('accepts an injected catalog lookup', () => {
    const c = classifySegment(seg('x.example'), {
      ...leetcodeSession,
      lookupCategory: () => 'gaming',
    });
    expect(c.label).toBe('DISTRACTION');
  });
});

describe('privacy helpers', () => {
  it('scrubs emails, long numbers and truncates', () => {
    expect(scrubTitle('Inbox (3) - jaydeep@example.com - Gmail')).toBe(
      'Inbox (3) - [email] - Gmail',
    );
    expect(scrubTitle('Order #4031 2299 1188 shipped')).toBe('Order #[number] shipped');
    expect(scrubTitle('LeetCode 704 Binary Search')).toBe('LeetCode 704 Binary Search');
    expect(scrubTitle('  spaced \n  out  ')).toBe('spaced out');
    expect(scrubTitle('x'.repeat(300))!.length).toBe(200);
    expect(scrubTitle('')).toBeNull();
    expect(scrubTitle(undefined)).toBeNull();
    expect(scrubTitle('   ')).toBeNull();
  });

  it('identifies sensitive categories', () => {
    expect(isSensitiveCategory('finance')).toBe(true);
    expect(isSensitiveCategory('dev_tools')).toBe(false);
    expect(isSensitiveCategory(null)).toBe(false);
  });
});
