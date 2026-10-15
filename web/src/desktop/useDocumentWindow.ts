/**
 * What a document window does for its host, whichever editor is in it: keeps the window's title
 * and edited dot current, answers the menu bar, saves before the window goes to the back, and
 * saves (or asks) before it closes.
 */

import { useEffect } from 'react';
import type { Toast } from '../core/ui';
import { findCommand, runCommand, undoRedo } from './commands';
import type { Host, HostCommand } from './host';
import { saveNow } from './parts';
import type { Session } from './session';

export function useDocumentWindow(session: Session | null, host: Host, notify: (t: Toast) => void, web: boolean): void {
  useEffect(() => {
    if (!session) return;
    host.setState(session.windowState());

    const onCommand = (name: HostCommand, args: Record<string, unknown>) => {
      switch (name) {
        case 'save':
          void saveNow(session, notify);
          break;
        case 'saveAs':
          void saveNow(session, notify, true);
          break;
        case 'flush':
          void session.flush();
          break;
        case 'close':
          void close(session, host, notify, args.mode === 'saveAs');
          break;
        case 'export':
          void runCommand(session, String(args.command ?? ''));
          break;
        case 'print':
          void runCommand(session, 'file.print');
          break;
        case 'undo':
        case 'redo':
          void undoRedo(session, name);
          break;
        case 'find':
          void findCommand(session);
          break;
        default:
          break;
      }
    };
    const off = host.onCommand(onCommand);

    // The first press of anything is the person's: what follows is an edit.
    const arm = () => session.arm();
    const events = ['keydown', 'beforeinput', 'paste', 'drop', 'pointerdown'] as const;
    for (const e of events) window.addEventListener(e, arm, { capture: true, passive: true });

    // In a browser, ⌘S is the browser's unless the page takes it. The shell's menu takes it there.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void saveNow(session, notify, e.shiftKey);
    };
    if (web) window.addEventListener('keydown', onKey);

    // A browser tab has no shell to ask; it asks itself.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (session.dirty) e.preventDefault();
    };
    if (web) window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      off();
      for (const e of events) window.removeEventListener(e, arm, { capture: true });
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [session, host, notify, web]);
}

/**
 * The shell is closing the window and the document is dirty. A file: write what is pending and
 * close. A new document, after the person chose Save: ask where, then close.
 */
async function close(session: Session, host: Host, notify: (t: Toast) => void, saveAs: boolean): Promise<void> {
  const ok = saveAs ? await saveNow(session, notify, !session.path) : await saveNow(session, notify);
  if (ok) host.close(true);
  else host.log('warn', `close: not saved (${session.state})`);
}
