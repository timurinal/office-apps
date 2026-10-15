/**
 * Merged areas, indexed so that "which merge holds this cell" does not read the whole list.
 * Paint asks it for every cell a text might overflow into, navigation for every step, and a
 * calendar-shaped sheet has thousands of merges.
 */

import type { Rect } from './types';

const BLOCK = 32;
/** A merge taller than this many rows is not bucketed; there are rarely any. */
const TALL = 256;

export class MergeIndex {
  private readonly buckets = new Map<number, Rect[]>();
  private readonly tall: Rect[] = [];

  constructor(readonly all: readonly Rect[]) {
    for (const m of all) {
      if (m.r2 - m.r1 > TALL) {
        this.tall.push(m);
        continue;
      }
      for (let b = Math.floor(m.r1 / BLOCK); b <= Math.floor(m.r2 / BLOCK); b++) {
        const list = this.buckets.get(b);
        if (list) list.push(m);
        else this.buckets.set(b, [m]);
      }
    }
  }

  /** The merged area containing a cell, or null. */
  at(row: number, col: number): Rect | null {
    if (this.all.length === 0) return null;
    for (const m of this.buckets.get(Math.floor(row / BLOCK)) ?? []) {
      if (row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2) return m;
    }
    for (const m of this.tall) {
      if (row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2) return m;
    }
    return null;
  }

  /** The merged areas that touch a rectangle. */
  within(r: Rect): Rect[] {
    if (this.all.length === 0) return [];
    const out = new Set<Rect>();
    const lo = Math.floor(r.r1 / BLOCK);
    const hi = Math.floor(r.r2 / BLOCK);
    if (hi - lo > this.buckets.size) {
      for (const m of this.all) if (m.r1 <= r.r2 && m.r2 >= r.r1 && m.c1 <= r.c2 && m.c2 >= r.c1) out.add(m);
    } else {
      for (let b = lo; b <= hi; b++) {
        for (const m of this.buckets.get(b) ?? []) if (m.r1 <= r.r2 && m.r2 >= r.r1 && m.c1 <= r.c2 && m.c2 >= r.c1) out.add(m);
      }
      for (const m of this.tall) if (m.r1 <= r.r2 && m.r2 >= r.r1 && m.c1 <= r.c2 && m.c2 >= r.c1) out.add(m);
    }
    return [...out];
  }
}
