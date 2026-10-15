/**
 * The keyboard, where the grid does not already answer.
 *
 * The grid takes what is its own: arrows and the keys that move, Enter, Tab, F2, Delete, Ctrl+A,
 * Ctrl+Space and Shift+Space (a whole column and a whole row), and a typed character. It leaves
 * everything else with Ctrl to the page, and the clipboard (Ctrl+C, X and V) to the browser,
 * which fires the grid's own copy, cut and paste. This is the page's half: a module lists the
 * keys it takes (`SheetsModule.keys`), and one listener on the document matches them.
 *
 * Core takes:
 *
 *   Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z   undo and redo
 *   Ctrl+/                          the command box, from the grid (Ctrl+K reaches it too)
 *   Ctrl+-                          delete the selected rows or columns
 *   Ctrl++ (Ctrl+Shift+=)           insert rows or columns, in the same places
 *
 * **Ctrl+- and Ctrl++ are the browser's zoom**, and docs/core/keys.ts leaves its own Ctrl+= alone
 * for that reason. Here they are Excel's insert and delete, and are taken only where that is
 * unambiguous: with whole rows or columns selected, which Excel too acts on without asking. With
 * cells selected (Excel asks what to shift) the key is left to the browser, so zoom still zooms.
 * Plain Ctrl+= is never taken. The page has a zoom of its own in the footer.
 *
 * A key is not taken while the caret is in a field (the cell's editor, the formula bar, the name
 * box, the command box), where Ctrl+Z is the field's own undo, nor in a dialog or a menu.
 */

import { useEffect, useRef } from 'react';
import type { SheetsContext, SheetsKey } from './modules/types';

interface Parsed {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** One character, lower case, or `+`. */
  key: string;
}

export function parseKey(spec: string): Parsed {
  // The plus key is spelled `Mod++`.
  const plus = spec.endsWith('++');
  const parts = (plus ? spec.slice(0, -2) : spec).split('+');
  const key = plus ? '+' : parts.pop()!;
  const has = (name: string) => parts.includes(name);
  return { mod: has('Mod'), shift: has('Shift'), alt: has('Alt'), key: key.toLowerCase() };
}

/** Whether a keyboard event is the key a module asked for. */
export function matches(spec: string | Parsed, e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  const p = typeof spec === 'string' ? parseKey(spec) : spec;
  if (p.mod !== (e.ctrlKey || e.metaKey) || p.alt !== e.altKey) return false;
  if (p.key === '+') return e.key === '+' || (e.key === '=' && e.shiftKey) || e.code === 'NumpadAdd';
  // Everything else must match its shift exactly: Ctrl+Z is undo and Ctrl+Shift+Z is redo.
  if (p.shift !== e.shiftKey) return false;
  if (p.key === '-') return e.key === '-' || e.code === 'NumpadSubtract';
  return e.key.toLowerCase() === p.key;
}

/** Fields and floating surfaces own their own keys. */
const OWN_KEYS = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], .oa-popover';

/** The first key in `keys` that the event is, and that `when` allows. */
export function keyFor(keys: readonly SheetsKey[], e: KeyboardEvent, ctx: SheetsContext): SheetsKey | undefined {
  return keys.find((k) => matches(k.keys, e) && (k.when?.(ctx) ?? true));
}

/**
 * One listener on the document, for as long as the editor is mounted. It reads the latest context
 * when a key arrives, so a command never runs against a sheet that has been left.
 */
export function useSheetsKeys(keys: readonly SheetsKey[], ctx: SheetsContext | null): void {
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The grid has answered it already (Ctrl+Space, a typed key), or an input method is composing.
      if (e.defaultPrevented || e.isComposing) return;
      if (e.target instanceof Element && e.target.closest(OWN_KEYS)) return;
      const c = latest.current;
      if (!c) return;
      const key = keyFor(keys, e, c);
      if (!key) return;
      if (key.run(c) !== false) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [keys]);
}
