/**
 * The deck's model for a page, and the reads a component subscribes to.
 *
 * The model is made from the connection's `Y.Doc` and lives as long as the connection does. A
 * component reads only the slice it draws (`useDeckSlice`, `useSlide`), and re-renders only when a
 * change touches that slice: the rail and the canvas each follow the model themselves, so the page
 * that holds them does not re-render on a keystroke.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import type { VersionSummary } from '@shared/api';
import { errorText } from '../api';
import { versions as versionsApi } from '../client';
import type { SourceConnection } from '../docs/source';
import type { SlideJSON } from './model/deck';
import { SlideModel, type DeckChange } from './model/model';

/** The model on the connection's document. Null until there is a connection. */
export function useSlideModel(conn: SourceConnection | null, readOnly: boolean): SlideModel | null {
  const [model, setModel] = useState<SlideModel | null>(null);
  const ro = useRef(readOnly);
  ro.current = readOnly;
  useEffect(() => {
    if (!conn) {
      setModel(null);
      return;
    }
    const m = new SlideModel(conn.doc, { readOnly: ro.current });
    setModel(m);
    return () => {
      m.destroy();
      setModel((now) => (now === m ? null : now));
    };
  }, [conn]);
  useEffect(() => {
    model?.setReadOnly(readOnly);
  }, [model, readOnly]);
  return model;
}

/**
 * A value read from the model, re-read when a change passes `filter` (every change by default).
 * `read` must return the same value for the same deck: the model's reads are cached, so a slide or
 * the order keeps its identity until it changes. A read that builds something new each time gives
 * `equal` to say when two are the same. A read that depends on something besides the deck (which
 * slide) names it as `key`, or a new key with an unchanged deck keeps answering for the old one.
 */
export function useDeckSlice<T>(
  model: SlideModel | null,
  read: (m: SlideModel) => T,
  filter?: (c: DeckChange) => boolean,
  equal?: (a: T, b: T) => boolean,
  key?: unknown
): T | null {
  const latest = useRef({ read, filter, equal });
  latest.current = { read, filter, equal };
  const cache = useRef<{ model: SlideModel | null; version: number; key: unknown; value: T | null }>({ model: null, version: -1, key, value: null });
  const sub = useCallback(
    (cb: () => void): (() => void) => (model ? model.subscribe((c) => (latest.current.filter?.(c) ?? true) && cb()) : () => undefined),
    [model]
  );

  const snapshot = (): T | null => {
    const c = cache.current;
    if (!model) return null;
    if (c.model === model && c.version === model.version && Object.is(c.key, key)) return c.value;
    const next = latest.current.read(model);
    const same = c.model === model && c.value !== null && (latest.current.equal ? latest.current.equal(c.value, next) : Object.is(c.value, next));
    cache.current = { model, version: model.version, key, value: same ? c.value : next };
    return cache.current.value;
  };

  return useSyncExternalStore(sub, snapshot);
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** The slide ids in deck order, re-read when slides are added, removed or moved. */
export function useOrder(model: SlideModel | null): readonly string[] {
  return useDeckSlice(model, (m) => m.order(), (c) => c.order, sameList) ?? EMPTY;
}
const EMPTY: readonly string[] = [];

/** One slide, re-read when it changes (or the design does). */
export function useSlide(model: SlideModel | null, id: string | null): SlideJSON | null {
  return useDeckSlice(
    model,
    (m) => (id ? m.slide(id) : null),
    (c) => c.design || c.order || (id !== null && c.slides.has(id)),
    undefined,
    id
  );
}

export type VersionView = { status: 'loading' } | { status: 'ready'; model: SlideModel } | { status: 'error'; message: string };

/** A version's deck, read-only, while it is being looked at. */
export function useVersionModel(documentId: string, version: VersionSummary | null): VersionView | null {
  const [view, setView] = useState<VersionView | null>(null);
  const id = version?.id ?? null;
  useEffect(() => {
    if (!id) {
      setView(null);
      return;
    }
    let live = true;
    let model: SlideModel | null = null;
    setView({ status: 'loading' });
    versionsApi
      .snapshot(documentId, id)
      .then((bytes) => {
        if (!live) return;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, bytes);
        model = new SlideModel(doc, { readOnly: true });
        setView({ status: 'ready', model });
      })
      .catch((err: unknown) => live && setView({ status: 'error', message: errorText(err, 'Could not open that version.') }));
    return () => {
      live = false;
      model?.destroy();
      model?.doc.destroy();
    };
  }, [documentId, id]);
  return view;
}
