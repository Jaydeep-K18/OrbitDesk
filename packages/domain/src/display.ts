import { toUnicode } from './punycode.js';

/** Converts a punycode host to Unicode for display (`xn--bcher-kva.de` → `bücher.de`). */
export function displayHost(host: string): string {
  return host
    .split('.')
    .map((label) => (label.startsWith('xn--') ? toUnicode(label) : label))
    .join('.');
}
