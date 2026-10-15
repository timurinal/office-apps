/**
 * The page's ends of the model: making one for as long as the page is on a workbook, reading a
 * slice of it without re-rendering for the rest, and the version a person is looking at.
 *
 * The model tells every listener about every change, and most of them are not the page's
 * business: an edit, a remote step and somebody else's cursor all bump it. The editor's own
 * state (the tab list, the room's vitals, the save label) changes a few times in a session, so it
 * reads slices (`useModelSlice`) that hold their last answer until it differs, and the editor
 * re-renders for those and for nothing else. The grid, the formula bar and the sum in the footer
 * subscribe to the data themselves.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { VersionSummary } from '@shared/api';
import { decodeCellList, decodeSheetSnapshot } from '@shared/cells';
import { errorText } from '../api';
import { versions as versionsApi } from '../client';
import { SheetModel, localSheetSource, type SheetInfo, type SheetModelOptions, type SheetSource } from './model';

export interface ModelHooks {
  /** A viewer's, a commenter's, or a reader in Viewing mode: the model refuses every step. */
  readOnly: boolean;
  user: { name: string; color: string };
  onRoleChanged: () => void;
  checkAccess: NonNullable<SheetModelOptions['checkAccess']>;
}

/**
 * One model on one source, for as long as the source is. It is made in the effect and not during
 * render, so React's double mount in development (and a route change in production) tears one
 * down cleanly instead of leaving a socket behind. Null until then.
 */
export function useSheetModel(source: SheetSource, hooks: ModelHooks): SheetModel | null {
  const [model, setModel] = useState<SheetModel | null>(null);
  const latest = useRef(hooks);
  latest.current = hooks;

  useEffect(() => {
    const m = new SheetModel(source, {
      readOnly: latest.current.readOnly,
      user: latest.current.user,
      onRoleChanged: () => latest.current.onRoleChanged(),
      checkAccess: () => latest.current.checkAccess()
    });
    setModel(m);
    return () => {
      m.destroy();
      setModel((cur) => (cur === m ? null : cur));
    };
  }, [source]);

  useEffect(() => {
    model?.setReadOnly(hooks.readOnly);
  }, [model, hooks.readOnly]);

  return model;
}

/**
 * A slice of a model, held until it changes. `select` runs on every change the model announces and
 * on every render, so it must be cheap; `equal` says whether two answers are the same one.
 */
export function useModelSlice<T>(model: SheetModel | null, select: (m: SheetModel) => T, equal: (a: T, b: T) => boolean = Object.is): T | null {
  const held = useRef<{ model: SheetModel | null; value: T | null }>({ model: null, value: null });
  const pick = useRef(select);
  pick.current = select;
  const same = useRef(equal);
  same.current = equal;

  const subscribe = useCallback((cb: () => void) => (model ? model.subscribe(cb) : () => undefined), [model]);
  const read = useCallback((): T | null => {
    if (!model) return null;
    const next = pick.current(model);
    const was = held.current;
    if (was.model === model && was.value !== null && same.current(was.value, next)) return was.value;
    held.current = { model, value: next };
    return next;
  }, [model]);
  return useSyncExternalStore(subscribe, read, read);
}

export const sameSheets = (a: readonly SheetInfo[], b: readonly SheetInfo[]): boolean =>
  a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.name === b[i]!.name && s.color === b[i]!.color && s.hidden === b[i]!.hidden);

export function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]));
}

/** How long steps may wait for the room before the header says so. An answer inside it is not news. */
export const SAVING_AFTER_MS = 700;

/**
 * "Saving", once steps have waited for the room longer than they should, and "Saved" the moment
 * they have not. A step normally comes back acknowledged in a few milliseconds, and a label that
 * flickered through Saving on every Enter would be a flicker and a render for nothing.
 */
export function useSaving(model: SheetModel | null, after = SAVING_AFTER_MS): boolean {
  const waiting = useModelSlice(model, (m) => m.status().pending > 0) ?? false;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setLate(false);
      return;
    }
    const id = setTimeout(() => setLate(true), after);
    return () => clearTimeout(id);
  }, [waiting, after]);
  return waiting && late;
}

// ── a version, to look at ───────────────────────────────────────────────────

export type VersionView = { status: 'loading' } | { status: 'ready'; model: SheetModel } | { status: 'error'; message: string };

/**
 * An earlier version as a workbook of its own, read only, on a local source: the page shows it in
 * place of the live one, with its own tabs and formula bar, and the live one carries on in the
 * background. A version from before cells left Yjs is a bare structure and shows empty.
 */
export function useVersionModel(documentId: string, version: VersionSummary | null): VersionView | null {
  const [view, setView] = useState<VersionView | null>(null);
  const id = version?.id ?? null;

  useEffect(() => {
    if (!id) {
      setView(null);
      return;
    }
    let live = true;
    let model: SheetModel | null = null;
    setView({ status: 'loading' });
    versionsApi
      .snapshot(documentId, id)
      .then((bytes) => {
        if (!live) return;
        const snap = decodeSheetSnapshot(bytes);
        const cells = snap ? decodeCellList(snap.cells) : [];
        if (!cells) throw new Error('That version could not be read.');
        model = new SheetModel(localSheetSource({ state: snap ? snap.structure : bytes, cells }), { readOnly: true });
        setView({ status: 'ready', model });
      })
      .catch((err: unknown) => live && setView({ status: 'error', message: errorText(err, 'Could not open that version.') }));
    return () => {
      live = false;
      model?.destroy();
    };
  }, [documentId, id]);

  return view;
}
