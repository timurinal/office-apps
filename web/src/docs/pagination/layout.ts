/**
 * Where the pages break: numbers in, a list of breaks out. No DOM and no ProseMirror,
 * so every rule here is tested in Node (layout.test.ts).
 *
 * Lifted from spike S2 (`spikes/s2-docs-pagination/src/pagination/layout.ts`) and
 * extended with footnotes: a page that holds a reference also holds its note, so the
 * body on that page ends higher by the note's height and a separator.
 *
 * Everything is in "natural" coordinates: y from the top of the editor root as if no
 * spacer had been inserted. `S` is the height of the spacers placed so far, so a unit's
 * rendered top is `top + S`. Page p occupies [p * period, p * period + pageH), with
 * period = pageH + gap.
 */

export interface Setup {
  pageW: number;
  pageH: number;
  /** The desk between two sheets on screen. Print sets it to 0 (see pagination.css). */
  gap: number;
  /** From the page top to the first line of the body, on the first page and on the rest. */
  topFirst: number;
  topRest: number;
  /** From the last line of the body to the page bottom. */
  bottomFirst: number;
  bottomRest: number;
  widows: number;
  orphans: number;
  /** What a page with footnotes gives up besides the notes: the rule above them and its space. */
  noteSep?: number;
}

export interface Line {
  /** Natural coordinates of the line box. */
  top: number;
  bottom: number;
  /** ProseMirror position of the first character on the line. Unused for line 0. */
  pos: number;
  /** A row of an atom's own DOM (a table of contents) rather than a line of text: `pos` is the atom's. */
  row?: number;
}

export type UnitKind = 'block' | 'text' | 'row' | 'break';

export interface TableInfo {
  id: number;
  /** Position of the table node, and a signature of its header rows, so a repeated header re-renders when it is edited. */
  pos: number;
  headerSig: string;
  /** Ordinal of this unit within the table. Rows joined by a row span are one unit. */
  row: number;
  /** Leading units that are header rows, and how many DOM rows they are (what a repeated header clones). */
  headerRows: number;
  headerRowCount: number;
  cols: number;
  /** Index in the unit array of this table's row 0. */
  firstRowIdx: number;
}

export interface Unit {
  kind: UnitKind;
  /** ProseMirror position where a block spacer for this unit goes. */
  pos: number;
  top: number;
  bottom: number;
  /** A heading: stay on the same page as the unit that follows. */
  keepWithNext?: boolean;
  /** Text units only: lines of text, or the rows of an atom that splits between them. Measured lazily because it is the expensive read. */
  lines?: () => Line[];
  table?: TableInfo;
  /** Footnote references inside the unit, in document order: where each is, and its index in `noteHeights`. */
  notes?: readonly { pos: number; i: number }[];
}

/** `part`: a spacer the atom at `pos` draws itself, before its row `row` (nodes.ts, TocView). */
export type BreakKind = 'block' | 'row' | 'inline' | 'part';

export interface Break {
  kind: BreakKind;
  /** Where the widget goes. */
  pos: number;
  /** Height of the spacer itself, header clones not included. */
  height: number;
  /** Whether the spacer crosses the desk between two sheets. A pad down to the content top of the same page does not. */
  crosses: boolean;
  /** Table breaks: column count, and whether the header rows are repeated after the spacer. */
  cols?: number;
  repeatHeader?: boolean;
  headerHeight?: number;
  tablePos?: number;
  headerRows?: number;
  headerSig?: string;
  /** 0-based index of the page that starts after this break. */
  page: number;
  /** Part breaks: the row of the atom that starts the next page. */
  row?: number;
}

export interface FlowResult {
  breaks: Break[];
  pageCount: number;
  /** Units that could not be placed without crossing a page edge. */
  overflow: { index: number; kind: UnitKind; pages: number }[];
  /** The page each footnote is printed on, by its index in `noteHeights`; -1 if its reference was not seen. */
  notePage: number[];
}

const EPS = 0.5;

export function flow(units: readonly Unit[], s: Setup, noteHeights: readonly number[] = []): FlowResult {
  const period = s.pageH + s.gap;
  const sep = s.noteSep ?? 0;
  const top = (p: number) => p * period + (p === 0 ? s.topFirst : s.topRest);
  const baseBottom = (p: number) => p * period + s.pageH - (p === 0 ? s.bottomFirst : s.bottomRest);
  const pageAt = (y: number) => Math.max(0, Math.floor(y / period));

  // Footnotes: the height already promised to notes on each page, and who promised it.
  const reserved = new Map<number, number>();
  const res = (p: number) => reserved.get(p) ?? 0;
  const bottomWith = (p: number, notes: number) => baseBottom(p) - (notes > 0 ? notes + sep : 0);
  const notePage: number[] = noteHeights.map(() => -1);
  const placed: { note: number; unit: number; page: number }[] = [];
  const noteH = (i: number) => noteHeights[i] ?? 0;
  const placeNote = (note: number, unit: number, page: number) => {
    notePage[note] = page;
    reserved.set(page, res(page) + noteH(note));
    placed.push({ note, unit, page });
  };
  /** Units from `fromUnit` on have moved to page `to`: their notes go with them. */
  const moveNotes = (fromUnit: number, to: number) => {
    for (let k = placed.length - 1; k >= 0; k--) {
      const r = placed[k]!;
      if (r.unit < fromUnit) break;
      if (r.page === to) continue;
      reserved.set(r.page, res(r.page) - noteH(r.note));
      reserved.set(to, res(to) + noteH(r.note));
      r.page = to;
      notePage[r.note] = to;
    }
  };

  const breaks: Break[] = [];
  const overflow: FlowResult['overflow'] = [];
  let S = 0;
  /** Index of the first unit that starts on the current page. A break cannot go before it. */
  let pageStartIdx = 0;
  let forceNext = false;
  /** Pages whose top is taken by a repeated table header: a row there is "at the top" below the header. */
  const headerOffset = new Map<number, number>();

  const unit = (i: number): Unit => units[i]!;

  const tableHeaderHeight = (u: Unit) => {
    const t = u.table!;
    if (t.headerRows === 0) return 0;
    return unit(t.firstRowIdx + t.headerRows - 1).bottom - unit(t.firstRowIdx).top;
  };

  /**
   * Put unit j (or one of its lines) at the top of the next page; `samePage` pads to the content top of
   * the page it is already on instead. Everything from j to the current unit moves with it.
   */
  function breakBefore(j: number, line?: Line, samePage = false) {
    const u = unit(j);
    const y = (line ? line.top : u.top) + S;
    const p = pageAt(y);
    const toPage = samePage ? p : p + 1;
    const h = top(toPage) - y;
    if (h <= 0) return;
    const crosses = !samePage;
    if (line) {
      if (line.row === undefined) breaks.push({ kind: 'inline', pos: line.pos, height: h, crosses, page: toPage });
      else breaks.push({ kind: 'part', pos: line.pos, height: h, crosses, page: toPage, row: line.row });
      S += h;
      // The rest of this unit is on the new page; units before the next one are not candidates.
      pageStartIdx = j + 1;
      return;
    }
    if (u.kind === 'row') {
      const t = u.table!;
      const repeat = !samePage && t.headerRows > 0 && t.row >= t.headerRows;
      const hh = repeat ? tableHeaderHeight(u) : 0;
      breaks.push({
        kind: 'row',
        pos: u.pos,
        height: h,
        crosses,
        cols: t.cols,
        repeatHeader: repeat,
        headerHeight: hh,
        tablePos: t.pos,
        headerRows: t.headerRowCount,
        headerSig: t.headerSig,
        page: toPage
      });
      S += h + hh;
      if (hh > 0) headerOffset.set(toPage, hh);
    } else {
      breaks.push({ kind: 'block', pos: u.pos, height: h, crosses, page: toPage });
      S += h;
    }
    moveNotes(j, toPage);
    pageStartIdx = j;
  }

  /** The unit a break "before i" should really go before: keeps headings and table headers attached. */
  function target(i: number): number {
    let j = i;
    const u = unit(i);
    if (u.kind === 'row' && u.table!.row <= u.table!.headerRows && u.table!.headerRows > 0) j = u.table!.firstRowIdx;
    while (j - 1 >= pageStartIdx && unit(j - 1).keepWithNext) j--;
    // A heading cannot be kept with something that would not fit on a page together with it.
    if (j < i && (u.kind === 'block' || u.kind === 'row') && u.bottom - unit(j).top > baseBottom(1) - top(1)) j = i;
    return Math.max(j, pageStartIdx);
  }

  const atTop = (j: number) => {
    const y = unit(j).top + S;
    const p = pageAt(y);
    return y <= top(p) + (headerOffset.get(p) ?? 0) + EPS;
  };

  for (let i = 0; i < units.length; i++) {
    const u = unit(i);

    if (u.kind === 'break') {
      // A manual break has no height of its own and always fits; it sends the next unit to a new page.
      forceNext = true;
      continue;
    }
    if (forceNext) {
      forceNext = false;
      if (!atTop(i)) breakBefore(i);
    }

    const notes = u.notes ?? [];
    /** notes[0, nextNote) are placed. */
    let nextNote = 0;
    const notesH = (from: number, to: number) => {
      let h = 0;
      for (let k = from; k < to; k++) h += noteH(notes[k]!.i);
      return h;
    };
    const placeNotes = (from: number, to: number, page: number) => {
      for (let k = from; k < to; k++) placeNote(notes[k]!.i, i, page);
    };

    let lineCache: Line[] | undefined;
    const getLines = () => (lineCache ??= u.lines!());
    /** How many of the unit's notes sit on lines [0, k]. */
    const notesThrough = (k: number) => {
      const lines = getLines();
      const next = lines[k + 1];
      if (!next) return notes.length;
      let n = 0;
      while (n < notes.length && notes[n]!.pos < next.pos) n++;
      return n;
    };

    let fromLine = 0;
    let guard = 0;
    for (;;) {
      if (++guard > 10000) throw new Error('flow: no progress');
      const yt = (fromLine > 0 ? getLines()[fromLine]!.top : u.top) + S;
      const p = pageAt(yt);

      if (fromLine === 0) {
        // Starts inside the bottom margin or the gap: it belongs on the next page.
        if (yt >= bottomWith(p, res(p)) - EPS) {
          breakBefore(target(i));
          continue;
        }
        // Starts inside the top margin (only after something overflowed): pad down to the content top.
        if (yt < top(p) - EPS) {
          breakBefore(i, undefined, true);
          continue;
        }
      }
      if (u.bottom + S <= bottomWith(p, res(p) + notesH(nextNote, notes.length)) + EPS) {
        placeNotes(nextNote, notes.length, p);
        break; // fits
      }

      if (u.kind === 'text') {
        const lines = getLines();
        const n = lines.length;
        let k = fromLine;
        let acc = res(p);
        let nk = nextNote;
        while (k < n) {
          const end = Math.max(nk, notesThrough(k));
          const add = notesH(nk, end);
          if (lines[k]!.bottom + S > bottomWith(p, acc + add) + EPS) break;
          acc += add;
          nk = end;
          k++;
        }
        // Lines [fromLine, k) fit on this page.
        let split = k;
        if (n - split < s.widows) split = n - s.widows;
        const minBefore = fromLine === 0 ? s.orphans : 1;
        if (split - fromLine < minBefore) {
          if (fromLine > 0) {
            // Already at a page top with nothing fitting: force progress.
            split = Math.max(k, fromLine + 1);
            if (split >= n) {
              placeNotes(nextNote, notes.length, p);
              break;
            }
          } else {
            const j = target(i);
            if (atTop(j)) {
              overflow.push({ index: i, kind: u.kind, pages: 1 });
              placeNotes(nextNote, notes.length, p);
              break;
            }
            breakBefore(j);
            continue;
          }
        }
        const upto = Math.max(nextNote, notesThrough(split - 1));
        placeNotes(nextNote, upto, p);
        nextNote = upto;
        breakBefore(i, lines[split]!);
        fromLine = split;
        continue;
      }

      // Atomic unit (block, row) that does not fit.
      const j = target(i);
      if (atTop(j)) {
        // Taller than a page and nothing earlier to move: it overflows into the margin and gap.
        overflow.push({ index: i, kind: u.kind, pages: pageAt(u.bottom + S - EPS) - pageAt(u.top + S) + 1 });
        placeNotes(nextNote, notes.length, p);
        break;
      }
      breakBefore(j);
    }
  }

  const last = units.length ? units[units.length - 1] : undefined;
  const pageCount = last ? Math.max(1, pageAt(last.bottom + S - EPS) + 1, ...notePage.map((p) => p + 1)) : 1;
  return { breaks, pageCount, overflow, notePage };
}

export function sameBreaks(a: readonly Break[], b: readonly Break[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameBreak(a[i]!, b[i]!)) return false;
  return true;
}

export function sameBreak(x: Break, y: Break): boolean {
  return (
    x.kind === y.kind &&
    x.pos === y.pos &&
    x.crosses === y.crosses &&
    x.row === y.row &&
    Math.abs(x.height - y.height) <= 0.01 &&
    x.repeatHeader === y.repeatHeader &&
    x.headerSig === y.headerSig &&
    x.tablePos === y.tablePos &&
    Math.abs((x.headerHeight ?? 0) - (y.headerHeight ?? 0)) <= 0.01
  );
}

/** The page a document position is on, from the breaks alone (they are in document order). */
export function pageOfPos(breaks: readonly Break[], pos: number): number {
  let lo = 0;
  let hi = breaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (breaks[mid]!.pos <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : breaks[lo - 1]!.page;
}
