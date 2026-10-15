/**
 * Who is looking at what, through the room's awareness: each person's slide, the elements they
 * have chosen, and the text they are typing in. The editor outlines other people's chosen
 * elements in their colour, marks their slide in the rail, and draws their caret in the box they
 * are in (textExtensions.ts).
 *
 * The field is `slides`: `{ slide, els, text }`, where `text` is `slide/element` or `slide/notes`.
 * Every value in it is what another client claimed, so it is read through `readSlidesState` and
 * only ever used to paint.
 */

import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { readUser } from '../../core/presence';
import type { Selection } from './selection';

export const FIELD = 'slides';
const MAX_IDS = 64;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface SlidesState {
  slide: string | null;
  els: string[];
  text: string | null;
}

const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

export function readSlidesState(state: unknown): SlidesState | null {
  if (typeof state !== 'object' || state === null) return null;
  const raw = (state as Record<string, unknown>)[FIELD];
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const els = Array.isArray(r.els) ? r.els.filter(isId).slice(0, MAX_IDS) : [];
  const text = typeof r.text === 'string' && /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/.test(r.text) ? r.text : null;
  return { slide: isId(r.slide) ? r.slide : null, els, text };
}

/** The text a person is typing in, for the caret filter. */
export function textKeyOf(state: unknown): string | null {
  return readSlidesState(state)?.text ?? null;
}

export const textKey = (slide: string, el: string): string => `${slide}/${el}`;
export const NOTES = 'notes';

/** What this person shows the others. `notes` is true while the caret is in the notes. */
export function stateFor(sel: Selection, notes: boolean): SlidesState {
  const text = sel.slide ? (notes ? textKey(sel.slide, NOTES) : sel.editing ? textKey(sel.slide, sel.editing) : null) : null;
  return { slide: sel.slide, els: [...sel.els], text };
}

export function publish(awareness: Awareness | null, state: SlidesState): void {
  if (!awareness) return;
  const now = readSlidesState(awareness.getLocalState());
  if (now && now.slide === state.slide && now.text === state.text && now.els.join() === state.els.join()) return;
  awareness.setLocalStateField(FIELD, state);
}

export interface PeerView {
  clientId: number;
  name: string;
  color: string;
  slide: string | null;
  els: string[];
}

export function peerViews(states: ReadonlyMap<number, unknown>, self: number): PeerView[] {
  const out: PeerView[] = [];
  for (const [clientId, state] of states) {
    if (clientId === self) continue;
    const user = readUser(state);
    const view = readSlidesState(state);
    if (!user || !view) continue;
    out.push({ clientId, name: user.name, color: user.color, slide: view.slide, els: view.els });
  }
  return out.sort((a, b) => a.clientId - b.clientId);
}

const samePeers = (a: readonly PeerView[], b: readonly PeerView[]): boolean =>
  a.length === b.length &&
  a.every((p, i) => {
    const q = b[i]!;
    return p.clientId === q.clientId && p.color === q.color && p.name === q.name && p.slide === q.slide && p.els.join() === q.els.join();
  });

/** Other people's slides and choices, kept current; a caret moving does not change it. */
export function usePeerViews(awareness: Awareness | null): PeerView[] {
  const [views, setViews] = useState<PeerView[]>([]);
  useEffect(() => {
    if (!awareness) {
      setViews([]);
      return;
    }
    const update = () =>
      setViews((prev) => {
        const next = peerViews(awareness.getStates(), awareness.clientID);
        return samePeers(prev, next) ? prev : next;
      });
    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
    };
  }, [awareness]);
  return views;
}
