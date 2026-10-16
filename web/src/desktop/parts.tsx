/**
 * What the desktop adds to both editors: the save state in the footer, and New, Open, Save and
 * Save as in the File menu and the Ctrl+K box. Each is shown only in a window that has a
 * session, so the editors' own tests (on a cloud source) never see them.
 *
 * The footer item is also how the session learns the editor's context: the editor renders it
 * with the current `DocsContext` or `SheetsContext`, which carries the Sheets model that a save
 * reads (`model.export()`).
 */

import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import floppyDiskRaw from '@phosphor-icons/core/assets/regular/floppy-disk.svg?raw';
import { filePlusIcon, folderOpenIcon, ph, presentationChartIcon, tableIcon } from '../core/icons';
import { isMac, mod } from '../core/keys';
import type { Command, FileItem } from '../core/shell/types';
import type { Toast } from '../core/ui';
import { isHostError } from './host';
import { currentSession, onCurrentSession, type Session } from './session';

const floppyDiskIcon = ph(floppyDiskRaw);
const noop = (): (() => void) => () => undefined;

export function useCurrentSession(): Session | null {
  return useSyncExternalStore(onCurrentSession, currentSession, currentSession);
}

function useSessionState(session: Session | null): string {
  return useSyncExternalStore(session ? (l) => session.subscribe(l) : noop, session ? session.snapshot : () => '', session ? session.snapshot : () => '');
}

const LABEL: Record<Session['state'], { label: string; warn: boolean }> = {
  saved: { label: 'Saved', warn: false },
  saving: { label: 'Saving…', warn: false },
  edited: { label: 'Edited', warn: false },
  error: { label: 'Not saved', warn: true },
  conflict: { label: 'Changed on disk', warn: true }
};

/** The footer's save state. `ready` is true once the editor has the document on screen. */
export function SaveStatus({ ctx, ready }: { ctx: unknown; ready: boolean }) {
  const session = useCurrentSession();
  useSessionState(session);

  useLayoutEffect(() => {
    if (session) session.ctx = ctx;
  });

  // Armed two frames after the document is drawn: what the editor writes while it opens is not an edit.
  useEffect(() => {
    if (!session || !ready || session.isArmed) return;
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => session.arm());
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [session, ready]);

  if (!session) return null;
  const shown = session.path ? LABEL[session.state] : session.dirty ? { label: 'Not saved', warn: false } : null;
  if (!shown) return null;
  return (
    <span className="oa-status" role="status" data-desktop-save={session.state}>
      <span className="oa-dot" data-tone={shown.warn ? 'warn' : undefined} />
      {shown.label}
    </span>
  );
}

// ── acts ────────────────────────────────────────────────────────────────────

/** Save, and say so when it did not work. */
export async function saveNow(session: Session, notify: (t: Toast) => void, as = false): Promise<boolean> {
  try {
    const ok = as ? await session.saveAs() : await session.save();
    if (!ok && session.state === 'conflict') conflictNotice(session, notify);
    else if (!ok && session.state === 'error') notify({ text: 'Could not save it.', tone: 'danger' });
    return ok;
  } catch (err) {
    notify({ text: isHostError(err) ? err.message : 'Could not save it.', tone: 'danger' });
    return false;
  }
}

export function conflictNotice(session: Session, notify: (t: Toast) => void): void {
  notify({
    text: 'This file was changed by another app.',
    tone: 'danger',
    action: {
      label: 'Keep this version',
      run: () =>
        void session.overwrite().catch(() => notify({ text: 'Could not save it.', tone: 'danger' }))
    }
  });
}

// ── rows ────────────────────────────────────────────────────────────────────

interface WithNotify {
  notify: (t: Toast) => void;
}

const here = (): boolean => currentSession() !== null;
const s = (): Session => currentSession()!;

export function fileRows<C extends WithNotify>(): FileItem<C>[] {
  return [
    { id: 'desktop.new-docs', label: 'New document', icon: filePlusIcon, section: 'Document', order: 101, visible: here, run: () => s().host.newDocument('docs') },
    { id: 'desktop.new-sheets', label: 'New spreadsheet', icon: tableIcon, section: 'Document', order: 102, visible: here, run: () => s().host.newDocument('sheets') },
    { id: 'desktop.new-slides', label: 'New presentation', icon: presentationChartIcon, section: 'Document', order: 103, visible: here, run: () => s().host.newDocument('slides') },
    { id: 'desktop.open', label: 'Open…', icon: folderOpenIcon, shortcut: mod('O'), section: 'Document', order: 201, visible: here, run: () => s().host.open() },
    { id: 'desktop.save', label: 'Save', icon: floppyDiskIcon, shortcut: mod('S'), section: 'Save', order: 300, visible: here, run: (c) => void saveNow(s(), c.notify) },
    { id: 'desktop.save-as', label: 'Save as…', icon: floppyDiskIcon, shortcut: mod('Shift+S'), section: 'Save', order: 310, visible: here, run: (c) => void saveNow(s(), c.notify, true) },
    {
      id: 'desktop.reveal',
      label: isMac() ? 'Show in Finder' : 'Show in folder',
      icon: folderOpenIcon,
      section: 'Save',
      order: 320,
      visible: () => here() && s().path !== null,
      run: () => {
        const p = s().path;
        if (p) s().host.reveal(p);
      }
    }
  ];
}

export function commandRows<C extends WithNotify>(): Command<C>[] {
  return fileRows<C>().map((r) => ({
    id: r.id,
    title: r.label,
    section: 'File',
    ...(r.icon ? { icon: r.icon } : {}),
    ...(r.shortcut ? { shortcut: r.shortcut } : {}),
    keywords: r.id === 'desktop.save' ? ['write', 'disk'] : r.id === 'desktop.open' ? ['file', 'browse'] : [],
    ...(r.visible ? { visible: r.visible } : {}),
    run: r.run
  }));
}
