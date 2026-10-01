#!/usr/bin/env node
// Generates the stable development key for the unpacked extension (ROADMAP Phase 0).
// Chrome derives the extension ID from the manifest "key" (public key, SPKI DER, base64),
// so pairing and externally_connectable keep working across reinstalls.
// The private key is NOT kept: it's only needed to pack a CRX, and the Chrome Web Store
// assigns its own key for published builds.
import { generateKeyPairSync, createHash } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../keys');
const pubPath = path.join(dir, 'dev-key.pub');

export function extensionIdFromKey(base64Spki) {
  const der = Buffer.from(base64Spki, 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

if (!existsSync(pubPath) || process.argv.includes('--force')) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  writeFileSync(pubPath, spki + '\n');
}
const key = readFileSync(pubPath, 'utf8').trim();
console.log(`Extension ID: ${extensionIdFromKey(key)}`);
