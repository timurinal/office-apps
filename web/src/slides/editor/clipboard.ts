/**
 * Copy, cut and paste of elements and slides.
 *
 * What goes on the clipboard is the plain values (model/deck.ts) in three forms: our own type,
 * `application/x-oa-slides`, for a paste in another tab of this app; HTML carrying the same
 * payload in a data attribute, because the async clipboard (the ribbon's Paste button) can read
 * HTML but not a type of our own; and plain text of the shapes, for anything else.
 *
 * A paste of our own payload makes new elements (or slides) with new ids, through one model step.
 * Pictures are the document's assets, so pictures from another presentation are left out and the
 * person is told. Plain text from elsewhere becomes a text box.
 *
 * What a paste reads came from outside this page: it is checked for shape here and validated
 * again by the model's step (`checkElements`), which refuses what cannot go on a slide.
 */

import { DECK_LIMITS, type ElementJSON, type Fill, type SlideJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import { boundsOf, unionOf } from '../model/model';
import { plainText, plainTextDoc } from '../model/schema';
import { deleteElements, deleteSlides } from './actions';
import type { SelectionStore } from './selection';

export const SLIDES_MIME = 'application/x-oa-slides';
const ATTR = 'data-oa-slides';
/** A payload bigger than this is not read: it is not one this page wrote. */
const MAX_PAYLOAD = 8 * 1024 * 1024;
/** How far each paste of the same thing on the same slide moves from the last, slide px. */
export const PASTE_OFFSET = 20;

export type ClipKind = 'elements' | 'slides';

/** What a paste that left pictures out says. */
export const PICTURES_LEFT_OUT = 'Pictures from another presentation were left out.';

export interface ClipPayload {
  v: 1;
  kind: ClipKind;
  /** The document it was copied from: pictures are that document's. */
  doc: string;
  items: ElementJSON[] | SlideJSON[];
}

export interface ClipForms {
  json: string;
  html: string;
  text: string;
}

// ── encoding ────────────────────────────────────────────────────────────────

const toBase64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const fromBase64 = (b: string): string => {
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Every shape's text, in order, a group's included: what another app pastes. */
export function textOf(items: readonly (ElementJSON | SlideJSON)[]): string {
  const out: string[] = [];
  const walk = (e: ElementJSON) => {
    if (e.type === 'shape') {
      const t = plainText(e.text).trim();
      if (t) out.push(t);
    } else if (e.type === 'group') e.children.forEach(walk);
    else if (e.type === 'table') for (const row of e.rows) for (const c of row.cells) if (!c.merged) out.push(plainText(c.text).trim());
  };
  for (const item of items) {
    if ('elements' in item) item.elements.forEach(walk);
    else walk(item);
  }
  return out.filter(Boolean).join('\n');
}

export function encodeClip(payload: ClipPayload): ClipForms {
  const json = JSON.stringify(payload);
  const text = textOf(payload.items);
  const html = `<meta charset="utf-8"><div ${ATTR}="${toBase64(json)}">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  return { json, html, text };
}

// ── decoding ────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A payload, if `raw` is one: its shape only, the model checks the rest. */
export function parsePayload(raw: string): ClipPayload | null {
  if (!raw || raw.length > MAX_PAYLOAD) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v) || v.v !== 1 || (v.kind !== 'elements' && v.kind !== 'slides') || typeof v.doc !== 'string' || !Array.isArray(v.items)) return null;
  const cap = v.kind === 'slides' ? DECK_LIMITS.slides : DECK_LIMITS.elementsPerSlide;
  if (!v.items.length || v.items.length > cap || !v.items.every(isObject)) return null;
  if (v.kind === 'slides' && !v.items.every((s) => typeof s.layout === 'string' && Array.isArray(s.elements))) return null;
  if (v.kind === 'elements' && !v.items.every((e) => typeof e.type === 'string')) return null;
  return { v: 1, kind: v.kind, doc: v.doc, items: v.items as unknown as ElementJSON[] | SlideJSON[] };
}

/** Our payload, from our own type or from the HTML that carries it. */
export function readClip(data: Pick<DataTransfer, 'getData'>): ClipPayload | null {
  const own = parsePayload(data.getData(SLIDES_MIME));
  if (own) return own;
  return payloadFromHtml(data.getData('text/html'));
}

export function payloadFromHtml(html: string): ClipPayload | null {
  if (!html || html.length > MAX_PAYLOAD * 2) return null;
  const m = new RegExp(`${ATTR}="([A-Za-z0-9+/=]+)"`).exec(html);
  if (!m) return null;
  try {
    return parsePayload(fromBase64(m[1]!));
  } catch {
    return null;
  }
}

// ── pictures from another document ──────────────────────────────────────────

const imageFill = (f: Fill | undefined): boolean => f?.kind === 'image';

/** The elements without pictures, and whether any were taken out. */
export function withoutPictures(els: readonly ElementJSON[]): { els: ElementJSON[]; dropped: boolean } {
  let dropped = false;
  const walk = (e: ElementJSON): ElementJSON | null => {
    if (e.type === 'image') {
      dropped = true;
      return null;
    }
    if (e.type === 'shape' && imageFill(e.fill)) {
      dropped = true;
      const { fill: _fill, ...rest } = e;
      return rest;
    }
    if (e.type === 'group') {
      const children = e.children.map(walk).filter((c): c is ElementJSON => !!c);
      if (!children.length) return null;
      return { ...e, children };
    }
    return e;
  };
  const out = els.map(walk).filter((e): e is ElementJSON => !!e);
  return { els: out, dropped };
}

function slidesWithoutPictures(slides: readonly SlideJSON[]): { slides: SlideJSON[]; dropped: boolean } {
  let dropped = false;
  const out = slides.map((s) => {
    const r = withoutPictures(s.elements);
    dropped ||= r.dropped;
    if (imageFill(s.bg)) {
      dropped = true;
      const { bg: _bg, ...rest } = s;
      return { ...rest, elements: r.els };
    }
    return { ...s, elements: r.els };
  });
  return { slides: out, dropped };
}

// ── copying and pasting ─────────────────────────────────────────────────────

export interface ClipTarget {
  model: SlideModel;
  selection: SelectionStore;
  /** This document's id. */
  doc: string;
}

/** What is chosen, as a payload: the elements on the slide, or the slides from the rail. Null for nothing. */
export function copyPayload(t: ClipTarget): ClipPayload | null {
  const s = t.selection.get();
  if (s.focus === 'canvas' && s.slide && s.els.length) {
    const els = s.els.map((id) => t.model.element(s.slide!, id)).filter((e): e is ElementJSON => !!e);
    return els.length ? { v: 1, kind: 'elements', doc: t.doc, items: els } : null;
  }
  const slides = s.slides.map((id) => t.model.slide(id)).filter((x): x is SlideJSON => !!x);
  return slides.length ? { v: 1, kind: 'slides', doc: t.doc, items: slides } : null;
}

/** How far pasted elements move so they do not land exactly on what is there: 20 px per copy already there. */
export function pasteOffset(existing: readonly ElementJSON[], pasted: readonly ElementJSON[]): number {
  const box = unionOf(pasted.map(boundsOf));
  if (!box) return 0;
  const taken = new Set(existing.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`));
  const first = pasted[0]!;
  let k = 0;
  while (k < 50 && taken.has(`${Math.round(first.x + k * PASTE_OFFSET)},${Math.round(first.y + k * PASTE_OFFSET)}`)) k++;
  return k * PASTE_OFFSET;
}

export interface PasteResult {
  /** What was made: element ids on the slide, or slide ids. */
  ids: string[];
  kind: ClipKind | 'text';
  /** Pictures from another presentation were left out. */
  droppedPictures: boolean;
}

/**
 * Pastes a payload: elements onto the slide on the canvas (a copy of what is already there sits
 * 20 px down and right of it), slides after the slide on the canvas. What was made is chosen.
 */
export function pastePayload(t: ClipTarget, payload: ClipPayload): PasteResult | null {
  const s = t.selection.get();
  const foreign = payload.doc !== t.doc;
  if (payload.kind === 'slides') {
    const { slides, dropped } = foreign ? slidesWithoutPictures(payload.items as SlideJSON[]) : { slides: payload.items as SlideJSON[], dropped: false };
    const at = s.slide ? t.model.indexOf(s.slide) + 1 : t.model.order().length;
    // A layout this deck does not have draws as blank (deck.ts), so the slide keeps its elements.
    const ids = t.model.pasteSlides(slides, at);
    if (!ids?.length) return null;
    t.selection.set({ slide: ids[0]!, slides: ids, els: [], editing: null, focus: 'rail' });
    return { ids, kind: 'slides', droppedPictures: dropped };
  }
  if (!s.slide) return null;
  const { els, dropped } = foreign ? withoutPictures(payload.items as ElementJSON[]) : { els: payload.items as ElementJSON[], dropped: false };
  if (!els.length) return { ids: [], kind: 'elements', droppedPictures: dropped };
  const d = pasteOffset(t.model.slide(s.slide)?.elements ?? [], els);
  const moved = d ? els.map((e) => shift(e, d)) : els;
  const ids = t.model.pasteElements(s.slide, moved);
  if (!ids?.length) return null;
  t.selection.set({ els: ids, editing: null, focus: 'canvas' });
  return { ids, kind: 'elements', droppedPictures: dropped };
}

function shift(e: ElementJSON, d: number): ElementJSON {
  if (e.type === 'group') return { ...e, x: e.x + d, y: e.y + d, children: e.children.map((c) => shift(c, d)) };
  return { ...e, x: e.x + d, y: e.y + d };
}

/** Text from another app, as a text box in the middle of the slide. */
export function pasteText(t: ClipTarget, text: string): PasteResult | null {
  const s = t.selection.get();
  const clean = text.replace(/\r\n?/g, '\n').slice(0, 20_000);
  if (!s.slide || !clean.trim()) return null;
  const lines = clean.split('\n').length;
  const w = 1200;
  const h = Math.min(t.model.height - 80, Math.max(120, lines * 64));
  const ids = t.model.pasteElements(s.slide, [
    {
      type: 'shape',
      shape: 'rect',
      x: Math.round((t.model.width - w) / 2),
      y: Math.round((t.model.height - h) / 2),
      w,
      h,
      textBox: { wrap: true, autofit: 'none' },
      text: plainTextDoc(clean)
    }
  ]);
  if (!ids?.length) return null;
  t.selection.set({ els: ids, editing: null, focus: 'canvas' });
  return { ids, kind: 'text', droppedPictures: false };
}

/** After a cut: what was copied, gone, as one step. */
export function removeCopied(t: ClipTarget, kind: ClipKind): boolean {
  return kind === 'elements' ? deleteElements(t) : deleteSlides(t);
}

/** Pastes whatever a paste event or the async clipboard brought. */
export function pasteFrom(t: ClipTarget, data: { json?: string; html?: string; text?: string }): PasteResult | null {
  const payload = (data.json ? parsePayload(data.json) : null) ?? (data.html ? payloadFromHtml(data.html) : null);
  if (payload) return pastePayload(t, payload);
  return data.text ? pasteText(t, data.text) : null;
}

// ── the system clipboard ────────────────────────────────────────────────────

/** Puts the forms on a copy event's clipboard. */
export function writeEvent(data: Pick<DataTransfer, 'setData'>, forms: ClipForms): void {
  data.setData(SLIDES_MIME, forms.json);
  data.setData('text/html', forms.html);
  data.setData('text/plain', forms.text);
}

/** Puts the forms on the clipboard from a button (no event): HTML and text, which the async clipboard allows. */
export async function writeSystem(forms: ClipForms): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([forms.html], { type: 'text/html' }),
          'text/plain': new Blob([forms.text], { type: 'text/plain' })
        })
      ]);
      return true;
    }
    await navigator.clipboard.writeText(forms.text);
    return true;
  } catch {
    return false;
  }
}

/** Reads the clipboard from a button: null when the browser says no. */
export async function readSystem(): Promise<{ html?: string; text?: string } | null> {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      const out: { html?: string; text?: string } = {};
      for (const item of items) {
        if (item.types.includes('text/html')) out.html = await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain')) out.text = await (await item.getType('text/plain')).text();
      }
      return out;
    }
    return { text: await navigator.clipboard.readText() };
  } catch {
    return null;
  }
}
