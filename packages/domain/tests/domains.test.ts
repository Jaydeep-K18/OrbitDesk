import { describe, expect, it } from 'vitest';
import { displayHost, findListConflicts, hostMatches, normalizeDomain } from '../src/domains.js';

describe('normalizeDomain', () => {
  it.each([
    // [input, host, registrableDomain, kind]
    ['instagram.com', 'instagram.com', 'instagram.com', 'domain'],
    ['WWW.Instagram.com', 'instagram.com', 'instagram.com', 'domain'],
    ['m.instagram.com', 'm.instagram.com', 'instagram.com', 'domain'],
    ['instagram.com:443', 'instagram.com', 'instagram.com', 'domain'],
    ['instagram.com.', 'instagram.com', 'instagram.com', 'domain'],
    ['  reddit.com  ', 'reddit.com', 'reddit.com', 'domain'],
    ['https://www.youtube.com/watch?v=abc#t=10', 'youtube.com', 'youtube.com', 'domain'],
    [
      'http://user:pass@news.ycombinator.com/item',
      'news.ycombinator.com',
      'ycombinator.com',
      'domain',
    ],
    ['bücher.de', 'xn--bcher-kva.de', 'xn--bcher-kva.de', 'domain'],
    ['foo.co.uk', 'foo.co.uk', 'foo.co.uk', 'domain'],
    ['a.b.foo.co.uk', 'a.b.foo.co.uk', 'foo.co.uk', 'domain'],
    ['docs.google.com', 'docs.google.com', 'google.com', 'domain'],
    ['192.168.1.1', '192.168.1.1', '192.168.1.1', 'ip'],
    ['http://[::1]:3000/', '[::1]', '[::1]', 'ip'],
    ['localhost', 'localhost', 'localhost', 'localhost'],
    ['localhost:5173', 'localhost', 'localhost', 'localhost'],
  ] as const)('%s → %s', (input, host, registrableDomain, kind) => {
    expect(normalizeDomain(input)).toEqual({ host, registrableDomain, kind });
  });

  it.each([
    '',
    '   ',
    'not a domain',
    'com',
    'co.uk',
    'foo.notarealtld',
    '-bad-.com',
    'exa_mple.com',
    'http://',
    '.',
    `${'a'.repeat(64)}.com`,
  ])('rejects %j', (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });
});

describe('hostMatches', () => {
  it('matches exact hosts and subdomains only', () => {
    expect(hostMatches('instagram.com', 'instagram.com')).toBe(true);
    expect(hostMatches('m.instagram.com', 'instagram.com')).toBe(true);
    expect(hostMatches('a.b.instagram.com', 'instagram.com')).toBe(true);
    expect(hostMatches('notinstagram.com', 'instagram.com')).toBe(false);
    expect(hostMatches('instagram.com', 'm.instagram.com')).toBe(false);
  });
});

describe('displayHost', () => {
  it('converts punycode labels to unicode', () => {
    expect(displayHost('xn--bcher-kva.de')).toBe('bücher.de');
    expect(displayHost('github.com')).toBe('github.com');
  });
});

describe('findListConflicts', () => {
  it('returns hosts present in both lists, deduplicated', () => {
    expect(findListConflicts(['a.com', 'b.com', 'a.com'], ['a.com', 'c.com'])).toEqual(['a.com']);
    expect(findListConflicts(['a.com'], ['b.com'])).toEqual([]);
  });
});
