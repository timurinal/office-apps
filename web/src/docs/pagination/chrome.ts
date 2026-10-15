/**
 * The page chrome: the sheets of paper, their headers and footers, and the footnotes at
 * their feet. Plain DOM beside the editor root, positioned from page geometry alone, so
 * none of it is in the document and none of it is ProseMirror's.
 *
 *   .pg-pages        under the body: one `.pg-page` per sheet, with static copies of its
 *                    header and footer. Each sheet is `content-visibility: auto`, so the
 *                    ones off screen cost no paint.
 *   .pg-notes-layer  over the body: each page's footnotes, in the space the layout left
 *                    for them at its foot. Over, not under, so a note can be clicked into.
 *   .pg-hf-live      over everything, only while a header or footer is being edited: the
 *                    one live editor, where that page's copy was.
 *   .pg-endnotes     after the body, in web layout: the notes as one numbered list.
 *   .pg-ghost        hidden and zero-height: where headers and new notes are measured
 *                    before they have a page.
 *
 * Every position is `calc(i * var(--pg-period))`, and the period includes `var(--pg-gap)`,
 * so print, which sets the gap to 0 (pagination.css), needs no second layout.
 */

import type * as Y from 'yjs';
import type { EditorView } from '@tiptap/pm/view';
import { DUR, enter, leave } from '../../motion';
import type { FootnoteView } from './nodes';
import { HF_FRAGMENTS, filled, fragmentName, renderFragment, todayText, type FieldValues, type HFKind, type HFVariant } from './headerFooter';
import type { ChromeHeights, PageGeometry, PageSetup } from './setup';

interface PageEl {
  el: HTMLElement;
  header: HTMLElement;
  footer: HTMLElement;
  hKey: string;
  fKey: string;
}

export interface ChromeFrame {
  paged: boolean;
  geo: PageGeometry;
  ps: PageSetup;
  pageCount: number;
  /** Every footnote, in document order. */
  notes: readonly FootnoteView[];
  /** The page a note is printed on, by its index in `notes`. */
  notePage: (i: number) => number;
  title: string;
}

const px = (v: number) => `${Math.round(v * 64) / 64}px`;

const GEOMETRY_VARS = ['--pg-w', '--pg-h', '--pg-top', '--pg-right', '--pg-bottom', '--pg-left', '--pg-hd', '--pg-fd', '--pg-content-w', '--pg-content-h', '--pg-n'];

export class PageChrome {
  readonly host: HTMLElement;
  /** The page's article where there is one: it carries the variables and `data-pg`. */
  readonly frame: HTMLElement;
  private readonly pagesEl: HTMLElement;
  private readonly notesEl: HTMLElement;
  private readonly endnotes: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly styleEl: HTMLStyleElement;
  private pages: PageEl[] = [];
  private noteBoxes: (HTMLElement | undefined)[] = [];
  private templates = new Map<string, DocumentFragment | null>();
  private templatesRev = -1;
  private seenNotes = new WeakSet<FootnoteView>();
  private drawnOnce = false;
  private mode: 'paged' | 'pageless' | null = null;
  private hfHeights: { key: string; value: ChromeHeights } | null = null;
  private noteCache = new WeakMap<FootnoteView, { node: unknown; width: number; h: number }>();
  private live: { box: HTMLElement; page: number; kind: HFKind } | null = null;
  readonly date = todayText();

  constructor(
    private readonly view: EditorView,
    private readonly doc: Y.Doc | null
  ) {
    const host = view.dom.parentElement ?? view.dom;
    this.host = host;
    host.classList.add('pg-host');
    this.frame = (view.dom.closest('[data-doc-page]') as HTMLElement | null) ?? host;

    const mk = (cls: string, tag = 'div', hidden = true) => {
      const el = document.createElement(tag);
      el.className = cls;
      if (hidden) el.setAttribute('aria-hidden', 'true');
      return el;
    };
    this.pagesEl = mk('pg-pages');
    // Notes are read, so they are not hidden from assistive technology.
    this.notesEl = mk('pg-notes-layer', 'div', false);
    this.endnotes = mk('pg-endnotes', 'section', false);
    this.endnotes.setAttribute('aria-label', 'Notes');
    this.endnotes.hidden = true;
    this.ghost = mk('pg-ghost');
    host.insertBefore(this.pagesEl, view.dom);
    // `append` is typed as the Workers runtime's HTMLRewriter method here, so one at a time.
    for (const el of [this.notesEl, this.endnotes, this.ghost]) host.appendChild(el);

    this.styleEl = document.createElement('style');
    this.styleEl.setAttribute('data-pg-print', '');
    document.head.appendChild(this.styleEl);
  }

  destroy(): void {
    this.endLive();
    this.pagesEl.remove();
    this.notesEl.remove();
    this.endnotes.remove();
    this.ghost.remove();
    this.styleEl.remove();
    this.host.classList.remove('pg-host', 'pg-hf-editing');
    delete this.frame.dataset.pg;
    for (const k of GEOMETRY_VARS) this.frame.style.removeProperty(k);
  }

  /** Forget every measured height: fonts or the width changed. */
  invalidate(): void {
    this.hfHeights = null;
    this.noteCache = new WeakMap();
  }

  // ── geometry ──────────────────────────────────────────────────────────────

  /** Write the page's measures as variables. Returns whether any changed. */
  applyGeometry(geo: PageGeometry, paged: boolean, pageRule: string): boolean {
    const s = geo.setup;
    const vars: [string, string][] = [
      ['--pg-w', px(s.pageW)],
      ['--pg-h', px(s.pageH)],
      ['--pg-top', px(s.topFirst)],
      ['--pg-right', px(geo.right)],
      ['--pg-bottom', px(s.bottomRest)],
      ['--pg-left', px(geo.left)],
      ['--pg-hd', px(geo.headerDistance)],
      ['--pg-fd', px(geo.footerDistance)],
      ['--pg-content-w', px(s.pageW - geo.left - geo.right)],
      ['--pg-content-h', px(s.pageH - s.topRest - s.bottomRest)]
    ];
    let changed = false;
    for (const [k, v] of vars) {
      if (this.frame.style.getPropertyValue(k) !== v) {
        this.frame.style.setProperty(k, v);
        changed = true;
      }
    }
    const mode = paged ? 'paged' : 'pageless';
    if (this.mode !== mode) {
      const first = this.mode === null;
      this.mode = mode;
      this.frame.dataset.pg = mode;
      changed = true;
      // A new layout, not a resize: the page rises into it, as a menu does.
      if (!first) enter(this.frame, 'rise', { duration: DUR.slow });
    }
    if (this.styleEl.textContent !== pageRule) this.styleEl.textContent = pageRule;
    return changed;
  }

  // ── headers and footers ───────────────────────────────────────────────────

  private template(name: string, rev: number): DocumentFragment | null {
    if (rev !== this.templatesRev) {
      this.templates.clear();
      this.templatesRev = rev;
    }
    if (!this.templates.has(name)) this.templates.set(name, this.doc ? renderFragment(this.doc.getXmlFragment(name)) : null);
    return this.templates.get(name) ?? null;
  }

  /**
   * How tall each header and footer renders, read from hidden copies. Cached until a
   * fragment, the width, the title or the first-page rule changes, so a keystroke in the
   * body never pays for it.
   */
  measureHF(rev: number, ps: PageSetup, contentWidth: number, scale: () => number, title: string): ChromeHeights {
    const key = `${rev}|${ps.differentFirst}|${contentWidth.toFixed(2)}|${title}`;
    if (this.hfHeights?.key === key) return this.hfHeights.value;
    // Two-digit fields: a header is measured as tall as it will be on page 88.
    const values: FieldValues = { page: 88, pages: 88, title, date: this.date };
    const holder = document.createElement('div');
    holder.style.width = px(contentWidth);
    const boxes = new Map<string, HTMLElement | null>();
    for (const name of HF_FRAGMENTS) {
      const t = this.template(name, rev);
      if (!t) {
        boxes.set(name, null);
        continue;
      }
      const box = document.createElement('div');
      box.className = 'pg-hf';
      box.appendChild(filled(t, values));
      holder.appendChild(box);
      boxes.set(name, box);
    }
    let value: ChromeHeights = { headerFirst: 0, headerRest: 0, footerFirst: 0, footerRest: 0 };
    if (holder.childElementCount) {
      this.ghost.appendChild(holder);
      const k = scale();
      const h = (name: string) => {
        const b = boxes.get(name);
        return b ? b.getBoundingClientRect().height / k : 0;
      };
      value = {
        headerRest: h('header-default'),
        footerRest: h('footer-default'),
        headerFirst: ps.differentFirst ? h('header-first') : h('header-default'),
        footerFirst: ps.differentFirst ? h('footer-first') : h('footer-default')
      };
      holder.remove();
    }
    this.hfHeights = { key, value };
    return value;
  }

  // ── footnotes ─────────────────────────────────────────────────────────────

  /** Put a note that has no page yet where it can be measured. Writes only. */
  prepareNotes(notes: readonly FootnoteView[], contentWidth: number): void {
    const w = px(contentWidth);
    if (this.ghost.style.width !== w) this.ghost.style.width = w;
    for (const n of notes) if (!n.entry.isConnected) this.ghost.appendChild(n.entry);
  }

  /** A note's height where it is now. Reads only; a note whose text has not changed is not read again. */
  noteHeight(n: FootnoteView, contentWidth: number, scale: number): number {
    const hit = this.noteCache.get(n);
    if (hit && hit.node === n.node && Math.abs(hit.width - contentWidth) < 0.5) return hit.h;
    const h = n.entry.getBoundingClientRect().height / scale;
    this.noteCache.set(n, { node: n.node, width: contentWidth, h });
    return h;
  }

  private placeNotes(f: ChromeFrame): void {
    const animate = this.drawnOnce;
    f.notes.forEach((n, i) => {
      n.setNumber(i + 1);
      n.sync();
    });
    if (!f.paged) {
      for (const box of this.noteBoxes) box?.remove();
      this.noteBoxes = [];
      this.endnotes.hidden = f.notes.length === 0;
      for (const n of f.notes) this.put(this.endnotes, n, animate);
      return;
    }
    this.endnotes.hidden = true;
    const s = f.geo.setup;
    const byPage = new Map<number, FootnoteView[]>();
    f.notes.forEach((n, i) => {
      const p = Math.max(0, f.notePage(i));
      let list = byPage.get(p);
      if (!list) byPage.set(p, (list = []));
      list.push(n);
    });
    const used = new Set<number>();
    for (const [p, list] of byPage) {
      let box = this.noteBoxes[p];
      if (!box) {
        box = document.createElement('div');
        box.className = 'pg-notes';
        this.noteBoxes[p] = box;
      }
      const bottom = s.pageH - (p === 0 ? s.bottomFirst : s.bottomRest);
      const top = `calc(${p} * var(--pg-period) + ${px(bottom)})`;
      if (box.style.top !== top) box.style.top = top;
      if (!box.isConnected) this.notesEl.appendChild(box);
      for (const n of list) this.put(box, n, animate);
      used.add(p);
    }
    this.noteBoxes.forEach((box, p) => {
      if (box && !used.has(p)) {
        box.remove();
        this.noteBoxes[p] = undefined;
      }
    });
  }

  /**
   * Append in order, moving only what is out of place. A note being typed in is never
   * moved, because moving an element takes the focus and the selection out of it.
   */
  private put(parent: HTMLElement, n: FootnoteView, animate: boolean): void {
    const fresh = !this.seenNotes.has(n);
    this.seenNotes.add(n);
    const inPlace = n.entry.parentElement === parent && n.entry.nextElementSibling === null;
    if (!inPlace && !(n.entry.parentElement === parent && n.entry.contains(document.activeElement))) parent.appendChild(n.entry);
    if (fresh && animate) enter(n.entry, 'fade', { duration: DUR.base });
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  render(f: ChromeFrame, hfRev: number): void {
    const n = f.paged ? String(f.pageCount) : '0';
    if (this.frame.style.getPropertyValue('--pg-n') !== n) this.frame.style.setProperty('--pg-n', n);
    this.placeNotes(f);
    if (!f.paged) {
      for (const p of this.pages) p.el.remove();
      this.pages = [];
      this.drawnOnce = true;
      return;
    }
    const animate = this.drawnOnce;
    while (this.pages.length < f.pageCount) {
      const i = this.pages.length;
      const el = document.createElement('div');
      el.className = 'pg-page';
      el.style.top = `calc(${i} * var(--pg-period))`;
      const header = document.createElement('div');
      header.className = 'pg-hf pg-header';
      const footer = document.createElement('div');
      footer.className = 'pg-hf pg-footer';
      el.appendChild(header);
      el.appendChild(footer);
      this.pagesEl.appendChild(el);
      this.pages.push({ el, header, footer, hKey: '', fKey: '' });
      if (animate) enter(el, 'fade', { duration: DUR.base });
    }
    while (this.pages.length > f.pageCount) {
      const gone = this.pages.pop()!;
      if (animate) void leave(gone.el, 'fade').then(() => gone.el.remove());
      else gone.el.remove();
    }
    const values = (page: number): FieldValues => ({ page: page + 1, pages: f.pageCount, title: f.title, date: this.date });
    this.pages.forEach((p, i) => {
      const variant: HFVariant = i === 0 && f.ps.differentFirst ? 'first' : 'default';
      for (const kind of ['header', 'footer'] as const) {
        const box = kind === 'header' ? p.header : p.footer;
        const editing = this.live?.page === i && this.live.kind === kind;
        box.style.visibility = editing ? 'hidden' : '';
        const name = fragmentName(kind, variant);
        const key = `${hfRev}|${name}|${i}|${f.pageCount}|${f.title}`;
        const keyName = kind === 'header' ? 'hKey' : 'fKey';
        if (p[keyName] === key) continue;
        p[keyName] = key;
        const t = this.template(name, hfRev);
        box.replaceChildren(...(t ? [filled(t, values(i))] : []));
        box.dataset.empty = t ? 'false' : 'true';
      }
    });
    this.drawnOnce = true;
  }

  // ── editing a header or footer ────────────────────────────────────────────

  /** The box the live editor is mounted in, over the page's own copy. */
  startLive(page: number, kind: HFKind): HTMLElement {
    this.endLive();
    const box = document.createElement('div');
    box.className = `pg-hf pg-hf-live pg-${kind}-live`;
    box.dataset.kind = kind;
    box.style.top =
      kind === 'header' ? `calc(${page} * var(--pg-period) + var(--pg-hd))` : `calc(${page} * var(--pg-period) + var(--pg-h) - var(--pg-fd))`;
    this.host.appendChild(box);
    this.host.classList.add('pg-hf-editing');
    this.live = { box, page, kind };
    const copy = this.pageBox(page, kind);
    if (copy) copy.style.visibility = 'hidden';
    enter(box, 'fade', { duration: DUR.fast });
    return box;
  }

  endLive(): void {
    if (!this.live) return;
    const { box, page, kind } = this.live;
    this.live = null;
    box.remove();
    this.host.classList.remove('pg-hf-editing');
    const copy = this.pageBox(page, kind);
    if (copy) copy.style.visibility = '';
  }

  get liveBox(): HTMLElement | null {
    return this.live?.box ?? null;
  }

  /** Force the next draw to refill every header and footer. */
  redrawHF(): void {
    for (const p of this.pages) p.hKey = p.fKey = '';
  }

  pageBox(page: number, kind: HFKind): HTMLElement | null {
    const p = this.pages[page];
    return p ? (kind === 'header' ? p.header : p.footer) : null;
  }

  /** Which page, and which margin band of it, a point over the body is in. */
  hitBand(clientX: number, clientY: number, geo: PageGeometry, scale: number): { page: number; kind: HFKind } | null {
    const r = this.view.dom.getBoundingClientRect();
    const x = (clientX - r.left) / scale;
    const y = (clientY - r.top) / scale;
    const s = geo.setup;
    if (x < 0 || x > s.pageW) return null;
    const period = s.pageH + s.gap;
    const page = Math.floor(y / period);
    const within = y - page * period;
    if (page < 0 || page >= this.pages.length || within > s.pageH) return null;
    const topInset = page === 0 ? s.topFirst : s.topRest;
    const bottomInset = page === 0 ? s.bottomFirst : s.bottomRest;
    if (within < topInset) return { page, kind: 'header' };
    if (within > s.pageH - bottomInset) return { page, kind: 'footer' };
    return null;
  }
}
