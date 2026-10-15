/**
 * The `@` picker: what it offers, and the small store the suggestion plugin and the
 * overlay share.
 *
 * Typing `@` offers three kinds of chip, in this order: **people** (those with access to
 * this document, people.ts), **dates** (today and the days around it), and **documents**
 * (the reader's own, by title, once two letters are typed). Each becomes an inline node:
 * a mention, a date, or a link that shows the other document's live title.
 *
 * The plugin (chips.ts) runs inside ProseMirror and the picker is React, so they meet
 * here, in a store with `subscribe` and `get` for `useSyncExternalStore`. The plugin
 * writes it; the picker reads it and calls `command` to choose.
 */

import type { DocKind } from '@shared/api';
import { formatDay, isoDay } from './chipText';
import type { Mentionable } from './people';
import { filterMentionables } from './people';

export type PickItem =
  | { kind: 'person'; id: string; label: string; detail: string }
  | { kind: 'date'; date: string; label: string; detail: string }
  | { kind: 'doc'; docId: string; docKind: DocKind; label: string; detail: string };

export const pickKey = (i: PickItem): string => (i.kind === 'person' ? `p:${i.id}` : i.kind === 'date' ? `d:${i.date}` : `l:${i.docId}`);

export const SECTION: Record<PickItem['kind'], string> = { person: 'People', date: 'Dates', doc: 'Documents' };

export function personItems(list: readonly Mentionable[], query: string): PickItem[] {
  return filterMentionables(list, query).map((p) => ({ kind: 'person', id: p.id, label: p.name, detail: p.handle ? `@${p.handle}` : '' }));
}

const DAYS: ReadonlyArray<{ label: string; offset: number }> = [
  { label: 'Today', offset: 0 },
  { label: 'Tomorrow', offset: 1 },
  { label: 'Yesterday', offset: -1 },
  { label: 'Next week', offset: 7 }
];

export function dateItems(query: string, now: Date = new Date()): PickItem[] {
  const q = query.trim().toLowerCase();
  return DAYS.filter((d) => !q || d.label.toLowerCase().startsWith(q)).map((d) => {
    const date = isoDay(d.offset, now);
    return { kind: 'date', date, label: d.label, detail: formatDay(date) };
  });
}

/** Everything the picker shows for `query`, people first. */
export function combine(people: readonly PickItem[], dates: readonly PickItem[], docs: readonly PickItem[]): PickItem[] {
  return [...people, ...dates, ...docs];
}

// ── the store ───────────────────────────────────────────────────────────────

export interface PickerState {
  open: boolean;
  items: PickItem[];
  /** The highlighted row. */
  index: number;
  /** Still asking for more. */
  loading: boolean;
  query: string;
  /** Where the `@` is, for placing the list. */
  rect: (() => DOMRect | null) | null;
  choose: (item: PickItem) => void;
}

export const CLOSED: PickerState = { open: false, items: [], index: 0, loading: false, query: '', rect: null, choose: () => undefined };

export interface PickerStore {
  get: () => PickerState;
  set: (next: Partial<PickerState>) => void;
  subscribe: (cb: () => void) => () => void;
  /** Move the highlight by `by`, wrapping. */
  move: (by: number) => void;
}

export function createPickerStore(): PickerStore {
  let state = CLOSED;
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((cb) => cb());
  return {
    get: () => state,
    set: (next) => {
      state = { ...state, ...next };
      emit();
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    move: (by) => {
      const n = state.items.length;
      if (n === 0) return;
      state = { ...state, index: (state.index + by + n) % n };
      emit();
    }
  };
}
