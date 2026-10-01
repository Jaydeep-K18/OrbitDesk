import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Mirrors scripts/gen-dev-key.mjs: the extension ID is derived from the pinned public key.
function extensionIdFromKey(base64Spki: string): string {
  const hex = createHash('sha256').update(Buffer.from(base64Spki, 'base64')).digest('hex');
  return [...hex.slice(0, 32)]
    .map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16)))
    .join('');
}

describe('dev manifest key', () => {
  it('pins a stable extension id', () => {
    const key = readFileSync(new URL('../keys/dev-key.pub', import.meta.url), 'utf8').trim();
    expect(key.length).toBeGreaterThan(300);
    expect(extensionIdFromKey(key)).toBe('dmfegmfpjfegcdhojmpbbghakajhgpec');
  });
});
