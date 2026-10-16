/**
 * Reading the rendered body into the units `flow` takes, and reading only what changed.
 *
 * Spike S2 re-measured every block on every pass (2 ms at 50 pages, and growing with the
 * document). Here each top-level node keeps what was measured of it, keyed by the node
 * itself: ProseMirror shares unchanged nodes between states, so a keystroke changes the
 * identity of one paragraph and of the nodes around it, and only those are read again.
 * A node's entry holds its height, the gap above it (which depends on the node before it,
 * so that node is part of the key), and its units relative to its own top. Lines are read
 * only where a page edge falls, and cached the same way.
 *
 * An entry is also dropped when the spacers in or just before its node change, because a
 * spacer between two margins changes how they collapse; when the width changes; and when
 * fonts or images load (`epoch`). An idle pass re-reads everything as a safety net
 * (plugin.ts), so a stale entry costs at most one wrong layout for a moment.
 *
 * "Natural" coordinates are the rendered ones with the spacers taken out, in CSS pixels
 * before the page zoom.
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import type { Break, Line, TableInfo, Unit, UnitKind } from './layout';

interface RelUnit {
  kind: UnitKind;
  /** Spacer position, relative to the top-level node's position. */
  dpos: number;
  /** Relative to the top-level node's natural top. */
  top: number;
  bottom: number;
  keepWithNext?: boolean;
  /** Text units: the textblock's position relative to the top-level node. */
  textDpos?: number;
  /** An atom that splits between rows (a table of contents): each row, relative to the top-level node's natural top. */
  parts?: { top: number; bottom: number }[];
  table?: Omit<TableInfo, 'pos' | 'firstRowIdx'> & { dpos: number; firstRowRel: number };
  /** Footnote references, relative to the top-level node's position. */
  notes?: number[];
}

interface Entry {
  node: PMNode;
  prev: PMNode | null;
  width: number;
  epoch: number;
  /** The spacers inside or right before the node when it was read. */
  sig: string;
  /** Natural top of this node minus the natural bottom of the one before (or the root top). */
  lead: number;
  height: number;
  units: RelUnit[];
}

interface LineCacheEntry {
  width: number;
  lines: { top: number; bottom: number; off: number }[];
}

export interface MeasureStats {
  nodes: number;
  read: number;
  lines: number;
  lineHits: number;
}

/** What one pass measured: units for `flow`, and the footnotes they reference in order. */
export interface Measured {
  units: Unit[];
  /** Position of every footnote reference, in document order. */
  notePos: number[];
  /** Natural height of the body's content, from the root top. */
  bottom: number;
  /** Rendered pixels per CSS pixel: the page zoom. */
  scale: number;
  stats: MeasureStats;
}

/** A list, whose children must stay list items: a spacer inside one is an `<li>`. */
export const isList = (n: PMNode | null | undefined): boolean => !!n && /^(bulletList|orderedList|taskList)$/.test(n.type.name);

export class Measurer {
  private entries = new WeakMap<PMNode, Entry>();
  private lineCache = new WeakMap<PMNode, LineCacheEntry>();
  /** Bumped to drop everything: fonts, images, a new page geometry. */
  epoch = 0;

  invalidate(): void {
    this.epoch++;
    this.lineCache = new WeakMap();
  }

  /**
   * One pass. `breaks` are the spacers on screen now (mapped through the transaction), so
   * entries whose surroundings changed are read again.
   */
  measure(view: EditorView, breaks: readonly Break[], full = false): Measured {
    const stats: MeasureStats = { nodes: 0, read: 0, lines: 0, lineHits: 0 };
    const root = view.dom as HTMLElement;
    const rootRect = root.getBoundingClientRect(); // the one forced layout this pass needs
    const scale = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
    const width = root.clientWidth;
    const rootTop = rootRect.top;

    // Every spacer in the DOM: where it is and how tall it rendered, unzoomed.
    const spacerEls = root.querySelectorAll('.pg-sp');
    const spTops = new Float64Array(spacerEls.length);
    const spCum = new Float64Array(spacerEls.length + 1);
    for (let i = 0; i < spacerEls.length; i++) {
      const r = spacerEls[i]!.getBoundingClientRect();
      spTops[i] = (r.top - rootTop) / scale;
      spCum[i + 1] = spCum[i]! + r.height / scale;
    }
    const natY = (clientY: number) => {
      const y = (clientY - rootTop) / scale;
      let lo = 0;
      let hi = spTops.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spTops[mid]! < y - 0.25) lo = mid + 1;
        else hi = mid;
      }
      return y - spCum[lo]!;
    };
    const natOf = (el: Element): { top: number; bottom: number } => {
      stats.read++;
      const r = el.getBoundingClientRect();
      return { top: natY(r.top), bottom: natY(r.bottom) };
    };
    const rectOf = (pos: number): { dom: HTMLElement; top: number; bottom: number } | null => {
      const dom = view.nodeDOM(pos);
      return dom instanceof HTMLElement ? { dom, ...natOf(dom) } : null;
    };

    const doc = view.state.doc;
    const units: Unit[] = [];
    const notePos: number[] = [];
    let prev: PMNode | null = null;
    let prevBottom = 0;
    let prevPos = -1;
    let bi = 0;
    let tableBase = 0;

    doc.forEach((node, pos) => {
      stats.nodes++;
      const end = pos + node.nodeSize;
      // The spacers that belong to this node: a block spacer at its position, anything inside it.
      let sig = '';
      while (bi < breaks.length && breaks[bi]!.pos < pos) bi++;
      for (let k = bi; k < breaks.length && breaks[k]!.pos < end; k++) {
        const b = breaks[k]!;
        sig += `${b.kind}${b.pos - pos}:${b.row ?? ''}:${b.height.toFixed(1)}:${b.repeatHeader ? 1 : 0};`;
      }

      let e = full ? undefined : this.entries.get(node);
      if (!e || e.prev !== prev || e.width !== width || e.epoch !== this.epoch || e.sig !== sig) {
        const m = rectOf(pos);
        if (!m) {
          prev = node;
          prevPos = pos;
          return;
        }
        // The gap above is read against the node before as it is drawn now, not as cached.
        let lead = m.top;
        if (prev && prevPos >= 0) {
          const pr = view.nodeDOM(prevPos);
          if (pr instanceof HTMLElement) {
            stats.read++;
            lead = m.top - natY(pr.getBoundingClientRect().bottom);
          } else lead = m.top - prevBottom;
        }
        e = { node, prev, width, epoch: this.epoch, sig, lead, height: m.bottom - m.top, units: [] };
        this.readUnits(node, pos, m, rectOf, natOf, e.units);
        this.entries.set(node, e);
      }

      const top = prevBottom + e.lead;
      const firstIdx = units.length;
      let tables = 0;
      for (const r of e.units) {
        const u: Unit = { kind: r.kind, pos: pos + r.dpos, top: top + r.top, bottom: top + r.bottom };
        if (r.keepWithNext) u.keepWithNext = true;
        if (r.table) {
          const { dpos, firstRowRel, ...t } = r.table;
          u.table = { ...t, id: tableBase + t.id, pos: pos + dpos, firstRowIdx: firstIdx + firstRowRel };
          tables = Math.max(tables, t.id + 1);
        }
        if (r.notes?.length) {
          u.notes = r.notes.map((d) => {
            notePos.push(pos + d);
            return { pos: pos + d, i: notePos.length - 1 };
          });
        }
        if (r.parts && r.textDpos !== undefined) {
          const atomPos = pos + r.textDpos;
          const parts = r.parts;
          u.lines = () => parts.map((p, row) => ({ top: top + p.top, bottom: top + p.bottom, pos: atomPos, row }));
        } else if (r.kind === 'text' && r.textDpos !== undefined) {
          const textPos = pos + r.textDpos;
          const uTop = u.top;
          const uBottom = u.bottom;
          u.lines = () => this.lines(view, textPos, uTop, uBottom, natY, scale, stats);
        }
        units.push(u);
      }
      tableBase += tables;
      prevBottom = top + e.height;
      prev = node;
      prevPos = pos;
    });

    return { units, notePos, bottom: prevBottom, scale, stats };
  }

  /** The units of one top-level node, relative to its top and position. */
  private readUnits(
    topNode: PMNode,
    topPos: number,
    topRect: { dom: HTMLElement; top: number; bottom: number },
    rectOf: (pos: number) => { dom: HTMLElement; top: number; bottom: number } | null,
    natOf: (el: Element) => { top: number; bottom: number },
    out: RelUnit[]
  ): void {
    const topY = topRect.top;
    let tableId = 0;
    const notesIn = (node: PMNode, pos: number): number[] | undefined => {
      let found: number[] | undefined;
      node.descendants((child, off) => {
        if (child.type.name === 'footnote') (found ??= []).push(pos + 1 + off - topPos);
        return !child.isAtom;
      });
      return found;
    };

    const visit = (node: PMNode, pos: number, breakPos: number, top?: { dom: HTMLElement; top: number; bottom: number }) => {
      const name = node.type.name;
      if (name === 'pageBreak') {
        out.push({ kind: 'break', dpos: pos - topPos, top: 0, bottom: 0 });
        return;
      }
      if (node.isTextblock) {
        const m = top ?? rectOf(pos);
        if (!m) return;
        const u: RelUnit = { kind: 'text', dpos: breakPos - topPos, top: m.top - topY, bottom: m.bottom - topY, textDpos: pos - topPos };
        if (name === 'heading') u.keepWithNext = true;
        const notes = notesIn(node, pos);
        if (notes) u.notes = notes;
        out.push(u);
        return;
      }
      if (name === 'table') {
        readTable(node, pos);
        return;
      }
      const first = node.firstChild;
      if (!node.isAtom && first && first.isBlock) {
        // A container: lists, list items, quotes. Its first child breaks before the container.
        node.forEach((child, off, index) => {
          const p = pos + 1 + off;
          visit(child, p, index === 0 ? breakPos : p);
        });
        return;
      }
      const m = top ?? rectOf(pos);
      if (!m) return;
      const u: RelUnit = { kind: 'block', dpos: breakPos - topPos, top: m.top - topY, bottom: m.bottom - topY };
      // An atom whose view marks rows it can be split between is flowed as lines, one per row.
      const rows = node.isAtom ? m.dom.querySelectorAll('[data-pg-part]') : null;
      if (rows && rows.length > 1) {
        u.kind = 'text';
        u.textDpos = pos - topPos;
        u.parts = Array.from(rows, (el) => {
          const r = natOf(el);
          return { top: r.top - topY, bottom: r.bottom - topY };
        });
      }
      const notes = notesIn(node, pos);
      if (notes) u.notes = notes;
      out.push(u);
    };

    const readTable = (node: PMNode, pos: number) => {
      const id = tableId++;
      const rowCount = node.childCount;
      // Rows joined by a row span cannot be separated, so they form one unit.
      const groups: { from: number; to: number }[] = [];
      for (let r = 0; r < rowCount; ) {
        let end = r;
        for (let i = r; i <= end; i++) {
          node.child(i).forEach((cell) => {
            const rs = Number(cell.attrs.rowspan) || 1;
            if (rs > 1) end = Math.max(end, i + rs - 1);
          });
        }
        end = Math.min(end, rowCount - 1);
        groups.push({ from: r, to: end });
        r = end + 1;
      }
      const isHeaderRow = (row: PMNode) => {
        let all = row.childCount > 0;
        row.forEach((cell) => {
          if (cell.type.name !== 'tableHeader') all = false;
        });
        return all;
      };
      let headerRows = 0;
      let headerRowCount = 0;
      for (let g = 0; g < groups.length; g++) {
        const grp = groups[g]!;
        let all = true;
        for (let r = grp.from; r <= grp.to; r++) if (!isHeaderRow(node.child(r))) all = false;
        if (!all) break;
        headerRows++;
        headerRowCount = grp.to + 1;
      }
      let cols = 0;
      node.firstChild?.forEach((cell) => (cols += Number(cell.attrs.colspan) || 1));
      let headerSig = '';
      for (let r = 0; r < headerRowCount; r++) headerSig += node.child(r).toString();
      const rowPos: number[] = [];
      node.forEach((_row, off) => rowPos.push(pos + 1 + off));
      const firstRowRel = out.length;
      groups.forEach((g, ordinal) => {
        const a = rectOf(rowPos[g.from]!);
        const b = g.to === g.from ? a : rectOf(rowPos[g.to]!);
        if (!a || !b) return;
        let notes: number[] | undefined;
        for (let r = g.from; r <= g.to; r++) {
          const n = notesIn(node.child(r), rowPos[r]!);
          if (n) (notes ??= []).push(...n);
        }
        const u: RelUnit = {
          kind: 'row',
          dpos: rowPos[g.from]! - topPos,
          top: a.top - topY,
          bottom: b.bottom - topY,
          table: { id, dpos: pos - topPos, headerSig, row: ordinal, headerRows, headerRowCount, cols, firstRowRel }
        };
        if (notes) u.notes = notes;
        out.push(u);
      });
    };

    visit(topNode, topPos, topPos, topRect);
  }

  /** Line boxes of one textblock in natural coordinates, with the position of each line's first character. */
  private lines(
    view: EditorView,
    pos: number,
    unitTop: number,
    unitBottom: number,
    natY: (clientY: number) => number,
    scale: number,
    stats: MeasureStats
  ): Line[] {
    const node = view.state.doc.nodeAt(pos);
    const el = view.nodeDOM(pos);
    if (!node || !(el instanceof HTMLElement)) return [{ top: unitTop, bottom: unitBottom, pos: pos + 1 }];
    const width = el.clientWidth;
    const hit = this.lineCache.get(node);
    if (hit && hit.width === width) {
      stats.lineHits++;
      return hit.lines.map((l) => ({ top: unitTop + l.top, bottom: unitTop + l.bottom, pos: pos + l.off }));
    }

    // Relative to the element as drawn, so a cached unit top that is off by a pixel does not move the lines.
    const er = el.getBoundingClientRect();
    const elTop = natY(er.top);
    const elBottom = natY(er.bottom);
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const raw: { top: number; bottom: number; pos: number }[] = [];
    let n: Text | null;
    while ((n = walker.nextNode() as Text | null)) {
      const text = n;
      const len = text.length;
      if (!len) continue;
      // Text inside a node view that is not ours to read (a footnote's number) has no position.
      if (text.parentElement?.closest('.pg-fn-ref')) continue;
      range.selectNodeContents(text);
      const rects = range.getClientRects();
      for (let ri = 0; ri < rects.length; ri++) {
        const r = rects[ri]!;
        if (r.height === 0) continue;
        const t = natY(r.top);
        const b = natY(r.bottom);
        const c = (t + b) / 2;
        const last = raw[raw.length - 1];
        if (last && c >= last.top && c <= last.bottom) {
          last.top = Math.min(last.top, t);
          last.bottom = Math.max(last.bottom, b);
          continue;
        }
        let off = 0;
        if (ri > 0) {
          // The text node wraps onto this line: binary-search the first character that sits on it.
          let lo = 1;
          let hi = len - 1;
          const charTop = (o: number) => {
            for (let k = o; k < len; k++) {
              range.setStart(text, k);
              range.setEnd(text, k + 1);
              const cr = range.getClientRects();
              if (cr.length && cr[0]!.height > 0) return cr[0]!.top;
            }
            return Infinity;
          };
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (charTop(mid) >= r.top - 0.5 * scale) hi = mid;
            else lo = mid + 1;
          }
          off = lo;
        }
        let at: number;
        try {
          at = view.posAtDOM(text, off);
        } catch {
          continue;
        }
        raw.push({ top: t, bottom: b, pos: at });
      }
    }
    stats.lines += raw.length;
    // Content-area rects are shorter than line boxes: put each boundary halfway between neighbours.
    const rel = raw.map((l, i) => ({
      top: (i === 0 ? elTop : (raw[i - 1]!.bottom + l.top) / 2) - elTop,
      bottom: (i === raw.length - 1 ? elBottom : (l.bottom + raw[i + 1]!.top) / 2) - elTop,
      off: l.pos - pos
    }));
    if (rel.length === 0) rel.push({ top: 0, bottom: elBottom - elTop, off: 1 });
    this.lineCache.set(node, { width, lines: rel });
    return rel.map((l) => ({ top: unitTop + l.top, bottom: unitTop + l.bottom, pos: pos + l.off }));
  }
}
