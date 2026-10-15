/**
 * The page view's ProseMirror plugin, from spike S2. It never writes to the body.
 *
 * After each transaction, in a microtask so it lands before the next paint, a pass:
 *
 *   1. writes the page's measures as CSS variables, and puts any note without a page
 *      where it can be measured
 *   2. reads the body, incrementally (measure.ts), and the notes' heights
 *   3. runs `flow` (layout.ts), a pure function: units in, breaks out
 *   4. if a break moved, dispatches the new decorations as plugin meta, with no steps
 *   5. draws the sheets, headers, footers and notes (chrome.ts)
 *
 * The page setup is read from the document's `page` map, and the only writes this file
 * makes are to that map, when a person who may edit asks for a change (and the paper's
 * default, once, from extension.ts). A reader's choice of view stays in this tab.
 */

import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import type { Mapping } from '@tiptap/pm/transform';
import { DecorationSet, type EditorView } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import { PageChrome } from './chrome';
import { buildDecorations, heightCss } from './decorations';
import { HF_FRAGMENTS, createHFEditor, type HFKind, type HFVariant } from './headerFooter';
import { flow, pageOfPos, sameBreaks, type Break } from './layout';
import { Measurer } from './measure';
import { footnoteViews, tocViews, type FootnoteView, type TocPart } from './nodes';
import { GAP, PAGE_MAP, defaultSize, geometry, pageRule, readSetup, writeSetup, type PageGeometry, type PageSetup, type SetupPatch } from './setup';
import type { PageControl, PageStore } from './store';

export interface PageConfig {
  /** What the document's `page` map says. */
  setup: PageSetup;
  /** Whether pages are drawn here, now. */
  paged: boolean;
}

export interface PState {
  config: PageConfig;
  deco: DecorationSet;
  breaks: Break[];
  pageCount: number;
  /** Bumped by anything that needs a new pass without a change to the body. */
  rev: number;
}

export const paginationKey = new PluginKey<PState>('pagination');

interface Meta {
  config?: PageConfig;
  layout?: { deco: DecorationSet; breaks: Break[]; pageCount: number };
  relayout?: boolean;
}

/** The spacers a table of contents at `pos` draws before its rows (layout.ts, `part` breaks). */
export function partsAt(state: EditorState, pos: number): TocPart[] {
  const st = paginationKey.getState(state);
  if (!st?.config.paged) return [];
  const out: TocPart[] = [];
  for (const b of st.breaks) if (b.kind === 'part' && b.pos === pos && b.row !== undefined) out.push({ row: b.row, height: heightCss(b, GAP) });
  return out;
}

/** The page a position is on, from a state's breaks. Null in web layout. */
export function pageAt(state: EditorState, pos: number): number | null {
  const st = paginationKey.getState(state);
  return st?.config.paged ? pageOfPos(st.breaks, pos) : null;
}

const mapBreaks = (breaks: readonly Break[], mapping: Mapping): Break[] =>
  breaks.map((b) => {
    // The association the widgets use (side < 0), so the positions stay comparable with the next pass.
    const m: Break = { ...b, pos: mapping.map(b.pos, -1) };
    if (b.tablePos !== undefined) m.tablePos = mapping.map(b.tablePos, -1);
    return m;
  });

const sameSetup = (a: PageSetup, b: PageSetup) => JSON.stringify(a) === JSON.stringify(b);

/** How long typing must stop before every node is read again, as a check on the cache. */
const VERIFY_AFTER = 800;
/** Passes in a row that may move a break before the layout is taken as it is. */
const MAX_SETTLE = 3;

const views = new WeakMap<EditorView, PageLayoutView>();

export function createPaginationPlugin(store: PageStore): Plugin<PState> {
  return new Plugin<PState>({
    key: paginationKey,
    state: {
      init: () => ({
        config: { setup: store.setup, paged: store.info.paged },
        deco: DecorationSet.empty,
        breaks: [],
        pageCount: 1,
        rev: 0
      }),
      apply(tr, st) {
        const m = tr.getMeta(paginationKey) as Meta | undefined;
        let next = st;
        if (tr.docChanged && next.breaks.length) {
          next = { ...next, deco: next.deco.map(tr.mapping, tr.doc), breaks: mapBreaks(next.breaks, tr.mapping) };
        }
        if (m?.config) {
          next = { ...next, config: m.config, rev: next.rev + 1 };
          if (!m.config.paged) next = { ...next, deco: DecorationSet.empty, breaks: [], pageCount: 1 };
        }
        if (m?.relayout) next = { ...next, rev: next.rev + 1 };
        if (m?.layout) next = { ...next, ...m.layout };
        return next;
      }
    },
    props: {
      decorations: (state) => paginationKey.getState(state)?.deco,
      attributes: (state): Record<string, string> => ({ class: paginationKey.getState(state)?.config.paged ? 'pg-paged' : 'pg-pageless' }),
      handleDoubleClick: (view, _pos, event) => views.get(view)?.doubleClick(event) ?? false
    },
    view: (view) => new PageLayoutView(view, store)
  });
}

interface Session {
  editor: Editor;
  page: number;
  kind: HFKind;
  variant: HFVariant;
  off: () => void;
}

class PageLayoutView implements PageControl {
  private readonly measurer = new Measurer();
  private readonly chrome: PageChrome;
  private readonly ydoc: Y.Doc | null;
  private readonly map: Y.Map<unknown> | null;
  private readonly cleanups: (() => void)[] = [];
  private scheduled = false;
  private fullNext = false;
  private reason = 'init';
  private destroyed = false;
  private lastRev = -1;
  private settles = 0;
  private hfRev = 0;
  private verifyTimer: ReturnType<typeof setTimeout> | undefined;
  private geo: PageGeometry | null = null;
  /** Width, zoom and device pixel ratio when the caches were filled: see frameKey. */
  private frame = '';
  private configRead = false;
  private session: Session | null = null;
  private pendingHF: { kind: HFKind; page?: number } | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly store: PageStore
  ) {
    views.set(view, this);
    this.ydoc = ySyncPluginKey.getState(view.state)?.doc ?? null;
    // Reading a root type creates it locally and writes no update.
    this.map = this.ydoc ? this.ydoc.getMap<unknown>(PAGE_MAP) : null;
    this.chrome = new PageChrome(view, this.ydoc);
    store.control = this;

    if (this.map) {
      const map = this.map;
      const onSetup = () => queueMicrotask(() => this.syncConfig());
      map.observe(onSetup);
      this.cleanups.push(() => map.unobserve(onSetup));
    }
    if (this.ydoc) {
      for (const name of HF_FRAGMENTS) {
        const fragment = this.ydoc.getXmlFragment(name);
        const onChange = () => {
          this.hfRev++;
          this.schedule('header');
        };
        fragment.observeDeep(onChange);
        this.cleanups.push(() => fragment.unobserveDeep(onChange));
      }
    }

    // Only a change of width or of zoom (which the device-pixel box sees) can change how
    // lines wrap; height changes are the layout's own spacers. The pass compares the frame
    // with the one it last measured in and drops the caches itself, so the observer's first
    // call, which reports the size the first pass already used, costs nothing.
    const ro = new ResizeObserver(() => {
      if (this.frame !== '' && this.frame === this.frameKey()) return;
      this.schedule('resize');
    });
    try {
      ro.observe(view.dom, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(view.dom);
    }
    this.cleanups.push(() => ro.disconnect());

    const onImage = () => {
      this.invalidate();
      this.schedule('image');
    };
    view.dom.addEventListener('load', onImage, true);
    this.cleanups.push(() => view.dom.removeEventListener('load', onImage, true));

    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts) {
      // `ready` and `loadingdone` report the same load; a pass is owed only when a face arrived.
      const loadedFaces = () => {
        let n = 0;
        fonts.forEach((f) => {
          if (f.status === 'loaded') n++;
        });
        return n;
      };
      let loaded = loadedFaces();
      const onFonts = () => {
        if (this.destroyed) return;
        const now = loadedFaces();
        if (now === loaded) return;
        loaded = now;
        this.invalidate();
        this.schedule('fonts');
      };
      void fonts.ready.then(onFonts);
      fonts.addEventListener('loadingdone', onFonts);
      this.cleanups.push(() => fonts.removeEventListener('loadingdone', onFonts));
    }

    // Print lays out from what is on screen, so it must be exact when printing starts.
    const onPrint = () => {
      if (this.destroyed || this.view.composing) return;
      this.run('print', true);
    };
    window.addEventListener('beforeprint', onPrint);
    this.cleanups.push(() => window.removeEventListener('beforeprint', onPrint));

    const mql = window.matchMedia?.('(max-width: 760px)');
    if (mql) {
      store.narrow = mql.matches;
      const onNarrow = () => {
        store.narrow = mql.matches;
        this.syncConfig();
      };
      mql.addEventListener('change', onNarrow);
      this.cleanups.push(() => mql.removeEventListener('change', onNarrow));
    }

    this.schedule('init');
  }

  update(view: EditorView, prev: EditorState): void {
    const st = paginationKey.getState(view.state)!;
    if (st.rev !== this.lastRev) {
      this.lastRev = st.rev;
      this.schedule('config');
    } else if (view.state.doc !== prev.doc) {
      this.schedule('doc');
    } else if (!view.state.selection.eq(prev.selection)) {
      this.publish(st.pageCount, st.config.paged);
    }
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.verifyTimer);
    this.endSession(false);
    for (const off of this.cleanups) off();
    this.chrome.destroy();
    if (this.store.control === this) this.store.control = null;
    views.delete(this.view);
  }

  // ── configuration ─────────────────────────────────────────────────────────

  /** Read the page map and this tab's own choices into the plugin state. */
  private syncConfig(): void {
    if (this.destroyed) return;
    const setup = readSetup(this.map, defaultSize());
    const paged = !this.store.narrow && (this.store.localPaged ?? setup.paged);
    const st = paginationKey.getState(this.view.state)!;
    if (!sameSetup(this.store.setup, setup) || this.store.info.paged !== paged) {
      this.store.setup = setup;
      this.store.info = { ...this.store.info, paged };
      this.store.emit();
    }
    if (sameSetup(st.config.setup, setup) && st.config.paged === paged) return;
    // A header being edited may have just stopped existing (a different first page, web layout).
    const s = this.session;
    if (s) {
      this.endSession(false);
      if (paged) this.pendingHF = { kind: s.kind, page: s.page };
    }
    const tr = this.view.state.tr
      .setMeta(paginationKey, { config: { setup, paged } } satisfies Meta)
      .setMeta('addToHistory', false)
      // The ribbon re-reads its controls on a stored-marks change: this makes it show the new setup.
      .setStoredMarks(this.view.state.storedMarks);
    this.view.dispatch(tr);
  }

  canWrite = (): boolean => !!this.ydoc && this.view.editable;

  setSetup = (patch: SetupPatch): boolean => {
    if (!this.canWrite() || !this.ydoc) return false;
    writeSetup(this.ydoc, patch);
    return true;
  };

  setPaged = (paged: boolean): void => {
    if (this.canWrite() && this.ydoc) {
      this.store.localPaged = null;
      if (!writeSetup(this.ydoc, { paged })) this.syncConfig();
    } else {
      this.store.localPaged = paged;
      this.syncConfig();
    }
  };

  relayout = (): void => {
    this.invalidate();
    this.schedule('relayout', true);
  };

  private invalidate(): void {
    this.measurer.invalidate();
    this.chrome.invalidate();
  }

  // ── scheduling ────────────────────────────────────────────────────────────

  private schedule(reason: string, full = false): void {
    this.reason = reason;
    if (full) this.fullNext = true;
    if (this.scheduled || this.destroyed) return;
    this.scheduled = true;
    // A microtask runs before the next paint, so a keystroke and its layout land in one frame.
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.destroyed) return;
      if (!this.view.dom.isConnected) {
        requestAnimationFrame(() => this.schedule('mount'));
        return;
      }
      // Redrawing a paragraph mid-composition would cancel the IME. Wait for it to end.
      if (this.view.composing) {
        setTimeout(() => this.schedule('composition'), 120);
        return;
      }
      const full = this.fullNext;
      this.fullNext = false;
      this.run(this.reason, full);
    });
  }

  private armVerify(): void {
    clearTimeout(this.verifyTimer);
    this.verifyTimer = setTimeout(() => this.schedule('verify', true), VERIFY_AFTER);
  }

  /** What a measured height depends on besides the content. */
  private frameKey(): string {
    return `${this.view.dom.clientWidth}:${this.readScale()}:${window.devicePixelRatio}`;
  }

  private readScale(): number {
    const root = this.view.dom;
    const w = root.offsetWidth;
    return w > 0 ? root.getBoundingClientRect().width / w : 1;
  }

  // ── the pass ──────────────────────────────────────────────────────────────

  private run(reason: string, full: boolean): void {
    const t0 = performance.now();
    // The first pass reads the page map, whatever reason it ended up with: the transaction
    // y-sync dispatches on mount schedules a 'config' pass over the constructor's 'init'.
    if (!this.configRead) {
      this.configRead = true;
      this.syncConfig();
    }
    const view = this.view;
    const st = paginationKey.getState(view.state)!;
    const { setup: ps, paged } = st.config;
    const notes = footnoteViews(view);
    const title = this.store.title;
    const base = geometry(ps);
    const contentW = base.setup.pageW - base.left - base.right;

    if (!paged) {
      this.endSession(false);
      this.geo = base;
      if (this.chrome.applyGeometry(base, false, pageRule(ps, false))) this.measurer.invalidate();
      if (st.breaks.length || st.pageCount !== 1) this.dispatchLayout(DecorationSet.empty, [], 1);
      this.chrome.render({ paged: false, geo: base, ps, pageCount: 1, notes, notePage: () => 0, title }, this.hfRev);
      this.finish(1, false);
      return;
    }

    // Writes first, then every read, so the pass forces one layout and not one per read.
    const hf = this.chrome.measureHF(this.hfRev, ps, contentW, () => this.readScale(), title);
    const geo = geometry(ps, hf);
    this.geo = geo;
    if (this.chrome.applyGeometry(geo, true, pageRule(ps, true))) this.measurer.invalidate();
    this.chrome.prepareNotes(notes, contentW);
    if (view.dom.offsetWidth === 0) {
      // Mounted but not laid out yet: a tab in the background, a pane still opening.
      requestAnimationFrame(() => this.schedule('mount'));
      return;
    }

    const frame = this.frameKey();
    if (frame !== this.frame) {
      const first = this.frame === '';
      this.frame = frame;
      // Heights read at another width or zoom, the header's included: start again without them.
      if (!first) {
        this.invalidate();
        this.run(reason, full);
        return;
      }
    }

    const t1 = performance.now();
    const m = this.measurer.measure(view, st.breaks, full);
    const byPos = new Map<number, FootnoteView>();
    for (const n of notes) {
      const p = n.pos();
      if (p !== null) byPos.set(p, n);
    }
    const measured = m.notePos.map((p) => byPos.get(p));
    const noteH = measured.map((n) => (n ? this.chrome.noteHeight(n, contentW, m.scale) : 0));
    const t2 = performance.now();
    const res = flow(m.units, geo.setup, noteH);
    const t3 = performance.now();

    const changed = !sameBreaks(st.breaks, res.breaks) || st.pageCount !== res.pageCount;
    if (changed) this.dispatchLayout(buildDecorations(view.state.doc, res.breaks, GAP), res.breaks, res.pageCount);

    const pageOf = new Map<FootnoteView, number>();
    measured.forEach((n, i) => {
      if (n) pageOf.set(n, res.notePage[i] ?? 0);
    });
    this.chrome.render(
      {
        paged: true,
        geo,
        ps,
        pageCount: res.pageCount,
        notes,
        notePage: (i) => {
          const n = notes[i]!;
          return pageOf.get(n) ?? pageOfPos(res.breaks, n.pos() ?? 0);
        },
        title
      },
      this.hfRev
    );
    if (this.session && this.session.page >= res.pageCount) this.endSession(false);
    const t4 = performance.now();

    this.store.passes++;
    this.store.geo = geo;
    if (reason === 'verify' && changed) this.store.verifyFixes++;
    this.store.last = {
      reason,
      full,
      ms: t4 - t0,
      prepMs: t1 - t0,
      measureMs: t2 - t1,
      flowMs: t3 - t2,
      applyMs: t4 - t3,
      nodes: m.stats.nodes,
      read: m.stats.read,
      lines: m.stats.lines,
      lineHits: m.stats.lineHits,
      units: m.units.length,
      breaks: res.breaks.length,
      pages: res.pageCount,
      dispatched: changed
    };

    // A spacer between two margins stops them collapsing, which moves what follows it. Read
    // again until nothing moves, a few times at most.
    if (changed && this.settles < MAX_SETTLE) {
      this.settles++;
      this.schedule('settle');
    } else this.settles = 0;
    if (reason !== 'verify' && reason !== 'print') this.armVerify();
    this.finish(res.pageCount, true);
  }

  private dispatchLayout(deco: DecorationSet, breaks: Break[], pageCount: number): void {
    const tr = this.view.state.tr
      .setMeta(paginationKey, { layout: { deco, breaks, pageCount } } satisfies Meta)
      .setMeta('addToHistory', false)
      .setMeta('pagination', true);
    this.view.dispatch(tr);
  }

  private finish(pageCount: number, paged: boolean): void {
    for (const t of tocViews(this.view)) t.refresh();
    this.publish(pageCount, paged);
    const want = this.pendingHF;
    if (want && paged) {
      this.pendingHF = null;
      this.editHeaderFooter(want.kind, want.page);
    }
  }

  private publish(pageCount: number, paged: boolean): void {
    const st = paginationKey.getState(this.view.state)!;
    const caretPage = paged ? pageOfPos(st.breaks, this.view.state.selection.head) : null;
    const i = this.store.info;
    if (i.pageCount === pageCount && i.caretPage === caretPage && i.paged === paged) return;
    this.store.info = { pageCount, caretPage, paged };
    this.store.emit();
  }

  // ── headers and footers ───────────────────────────────────────────────────

  doubleClick(e: MouseEvent): boolean {
    const st = paginationKey.getState(this.view.state)!;
    if (!st.config.paged || !this.geo || !this.canWrite()) return false;
    const band = this.chrome.hitBand(e.clientX, e.clientY, this.geo, this.readScale());
    if (!band) return false;
    return this.editHeaderFooter(band.kind, band.page);
  }

  editHeaderFooter = (kind: HFKind, page?: number): boolean => {
    if (!this.canWrite() || !this.ydoc) return false;
    const st = paginationKey.getState(this.view.state)!;
    if (!st.config.paged) {
      // As in Word: asking for the header in web layout switches to print layout first.
      if (this.store.narrow) return false;
      this.pendingHF = page === undefined ? { kind } : { kind, page };
      this.setPaged(true);
      return true;
    }
    const at = Math.max(0, Math.min(page ?? this.store.info.caretPage ?? 0, st.pageCount - 1));
    const variant: HFVariant = at === 0 && st.config.setup.differentFirst ? 'first' : 'default';
    this.endSession(false);
    const box = this.chrome.startLive(at, kind);
    const editor = createHFEditor({
      doc: this.ydoc,
      kind,
      variant,
      mount: box,
      values: () => ({ page: at + 1, pages: this.store.info.pageCount, title: this.store.title, date: this.chrome.date })
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.endSession(true);
      }
    };
    // A press anywhere but the header and its toolbar leaves it, as a click on the body does in Word.
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && box.contains(t)) return;
      if (t instanceof Element && t.closest('[data-pg-hf-toolbar], [role="dialog"], [role="menu"]')) return;
      this.endSession(false);
    };
    box.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    this.session = {
      editor,
      page: at,
      kind,
      variant,
      off: () => {
        box.removeEventListener('keydown', onKey);
        document.removeEventListener('pointerdown', onDown, true);
      }
    };
    this.store.hf = { kind, variant, page: at, editor };
    this.store.emit();
    // The banner and the toolbar float over the top of the page, so "in view" is below them.
    const r = box.getBoundingClientRect();
    const top = parseFloat(getComputedStyle(box).getPropertyValue('--shell-top')) || 0;
    if (r.top < top + 64 || r.bottom > window.innerHeight - 64) box.scrollIntoView({ block: 'center' });
    return true;
  };

  closeHeaderFooter = (): void => this.endSession(true);

  private endSession(refocus: boolean): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    s.off();
    s.editor.destroy();
    this.chrome.endLive();
    this.chrome.redrawHF();
    this.store.hf = null;
    this.store.emit();
    if (!this.destroyed) {
      this.schedule('header');
      if (refocus) this.view.focus();
    }
  }
}
