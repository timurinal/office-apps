/**
 * Running the editor's own commands from outside it: the native menu bar's Export, Print,
 * Undo, Redo and Find are the same commands the Ctrl+K box runs, with the same checks.
 *
 * The module lists are loaded on demand: the desktop modules are in those lists, so a static
 * import from here would be a cycle.
 */

import type { Session } from './session';

interface Runnable {
  id: string;
  visible?: (c: never) => boolean;
  disabled?: (c: never) => boolean;
  run: (c: never) => void;
}

interface ModuleLike {
  commands: readonly Runnable[];
  fileItems?: readonly Runnable[];
}

async function modulesFor(kind: Session['kind']): Promise<readonly ModuleLike[]> {
  if (kind === 'docs') return (await import('../docs/modules')).DOCS_MODULES as unknown as readonly ModuleLike[];
  if (kind === 'sheets') return (await import('../sheets/modules')).SHEETS_MODULES as unknown as readonly ModuleLike[];
  return (await import('../slides/modules')).SLIDES_MODULES as unknown as readonly ModuleLike[];
}

/** Run the command `id` against the session's editor. False when it is not there, hidden or disabled. */
export async function runCommand(session: Session, id: string): Promise<boolean> {
  const ctx = session.ctx as never;
  if (!ctx) return false;
  for (const m of await modulesFor(session.kind)) {
    for (const c of [...m.commands, ...(m.fileItems ?? [])]) {
      if (c.id !== id) continue;
      if (c.visible && !c.visible(ctx)) return false;
      if (c.disabled?.(ctx)) return false;
      c.run(ctx);
      return true;
    }
  }
  return false;
}

/** Undo or redo from the menu bar: a text field's own when one has the focus, the document's otherwise. Sheets and Slides call theirs `edit.*`. */
export async function undoRedo(session: Session, which: 'undo' | 'redo'): Promise<boolean> {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return document.execCommand(which);
  }
  const id = session.kind === 'docs' ? `format.${which}` : `edit.${which}`;
  return runCommand(session, id);
}

export function findCommand(session: Session): Promise<boolean> {
  return runCommand(session, session.kind === 'docs' ? 'edit.find' : 'find.find');
}
