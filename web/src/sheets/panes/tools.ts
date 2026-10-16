/**
 * Which tool is open: a tiny store, because a ribbon button, a command in the Ctrl+K box and a key
 * all open the same dialog and none of them is a React parent of it. `ToolsHost` (the one overlay
 * the tools share) reads it and mounts the dialog, lazily, so a dialog's code is fetched when it
 * is first wanted and the spreadsheet opens without it.
 *
 * One tool at a time. Opening another replaces the first, and leaving the page closes it.
 */

import { useSyncExternalStore } from 'react';
import type { CfCondition } from '../model';

export type ToolRequest =
  | { id: 'sort' }
  /** A conditional-format rule, new (with `initial` choosing its kind) or an existing one. */
  | { id: 'cf'; initial?: CfCondition; ruleId?: string }
  | { id: 'validation' }
  | { id: 'duplicates' }
  | { id: 'split' }
  | { id: 'function' }
  /** The name manager; `fromSelection` opens its form to define a name for the selected cells. */
  | { id: 'names'; fromSelection?: boolean }
  | { id: 'numfmt' }
  /** The width of the chosen columns, or the height of the chosen rows. */
  | { id: 'size'; axis: 'col' | 'row' }
  /** A filter's menu, for the column at this position. */
  | { id: 'filter'; col: number };

export type Open = ToolRequest & { seq: number };

let current: Open | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of [...listeners]) l();
};

export function openTool(req: ToolRequest): void {
  current = { ...req, seq: ++seq };
  emit();
}

/**
 * Closes the tool. With the `seq` of a tool, only if that very one is still open: a dialog that is
 * leaving must not close the one that replaced it.
 */
export function closeTool(seqOf?: number): void {
  if (!current || (seqOf !== undefined && current.seq !== seqOf)) return;
  current = null;
  emit();
}

/** The tool that is open now, for a test or a key that should not reopen it. */
export const openNow = (): Open | null => current;

export function useTool(): Open | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null
  );
}
