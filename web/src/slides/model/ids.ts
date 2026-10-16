/**
 * Ids for slides and elements: 8 random base-62 characters, the same alphabet and length as a
 * Sheets row id (sheets/model/structure.ts), so two people adding a slide at once never pick the
 * same one. Pure: `crypto.getRandomValues` is in every runtime this runs in.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 62];
  return s;
}
