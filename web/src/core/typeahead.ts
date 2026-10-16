/**
 * Type-ahead for a list: typing "ba" moves to the first item that starts with "ba", and a letter
 * typed again and again steps through the items that start with it.
 *
 * Shared by the dropdown and the context menu. Pure but for the clock, which a test hands in.
 */

/** How long a pause forgets what was typed. */
export const TYPEAHEAD_MS = 700;

export interface Typeahead {
  /** Take a typed character; answers the index to move to, or -1 when nothing starts with it. */
  type: (char: string, labels: readonly string[], from: number, usable?: (i: number) => boolean) => number;
  reset: () => void;
}

const norm = (s: string): string => s.trim().toLocaleLowerCase();

export function createTypeahead(now: () => number = () => Date.now()): Typeahead {
  let buffer = '';
  let at = 0;
  return {
    type(char, labels, from, usable = () => true) {
      const t = now();
      if (t - at > TYPEAHEAD_MS) buffer = '';
      at = t;
      buffer += char.toLocaleLowerCase();
      const n = labels.length;
      if (n === 0) return -1;
      // The same character again and again walks the items that start with it.
      const repeated = buffer.length > 1 && [...buffer].every((c) => c === buffer[0]);
      const needle = repeated ? buffer[0]! : buffer;
      // A growing word may stay where it is; a fresh letter starts after the current item.
      const start = buffer.length > 1 && !repeated ? from : from + 1;
      for (let k = 0; k < n; k++) {
        const i = (((start + k) % n) + n) % n;
        if (usable(i) && norm(labels[i]!).startsWith(needle)) return i;
      }
      return -1;
    },
    reset() {
      buffer = '';
      at = 0;
    }
  };
}

/** Whether a key press is a character to type ahead with (not a shortcut, not a control key). */
export const isTypeaheadKey = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean =>
  e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
