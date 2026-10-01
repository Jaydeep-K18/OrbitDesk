// Userland punycode (Node's built-in module is deprecated). The package ships no
// type declarations, so we type the single function we use here.
// @ts-expect-error -- no types published for punycode/punycode.js
import * as punycode from 'punycode/punycode.js';

export const toUnicode: (input: string) => string = punycode.toUnicode;
