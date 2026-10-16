/**
 * Chosen elements of a slide as an SVG that stands alone.
 *
 * The elements are drawn by the renderer itself (`ElementView`), once, in a stage the page cannot
 * see and at the slide's own size, with no rotation on them. What the renderer drew is then written
 * out: nothing here knows how a star or a gradient is drawn, so the file shows what the slide
 * shows, and what the renderer learns tomorrow, the file learns too.
 *
 *   a shape's outline   the renderer's own `<svg class="sl-geom">`, its paths, gradients, picture
 *                       fills and arrow heads copied across as they are (geometry.ts made them)
 *   rotation, flips     `transform` on a `<g>`; a flip is on the outline alone, as it is on the slide
 *   text                `<text>` with a `<tspan>` for each run on a line, positioned from the line
 *                       boxes the browser laid out (measure.ts), with the family, size, weight,
 *                       style and colour the run had
 *   pictures            `<image>` with the bytes in a data URL, cropped by a clip, as on the slide
 *   tables, charts      their cells' boxes and text, and the chart's own SVG
 *
 * Everything is in the slide's logical px, shifted so the chosen elements' bounds start at 0,0, and
 * the background is not drawn. No `<foreignObject>`, no script and no address of the page's: a
 * picture that could not be had is left out, and a font of ours is carried in the file (fonts.ts).
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SLIDE_WIDTH, type Aspect, type ElementJSON } from '../model/deck';
import type { Design } from '../model/styles';
import type { AssetUrl } from '../render/assets';
import { ElementView, renderCtx, slideHeight } from '../render/SlideView';
import { embeddedFontCss, type FontUse } from './fonts';
import { inlineImages } from './images';
import { measureText, parseColor, type Measurer, type Segment } from './measure';

export interface PictureSource {
  /** The chosen elements, top level, back to front. */
  elements: readonly ElementJSON[];
  design: Design & { size: Aspect };
  /** The slide's layout and place in the deck, which a slide-number placeholder reads. */
  layoutId: string;
  number: number;
  assetUrl: AssetUrl;
}

export interface Picture {
  svg: string;
  /** In slide px; the PNG is twice this. */
  width: number;
  height: number;
  /** Pictures that could not be had and were left out. */
  missing: number;
}

/** What `buildPicture` asks of the browser, so a test can answer for it. */
export interface PictureDeps {
  measure?: Measurer;
  inline?: (urls: Iterable<string>) => Promise<Map<string, string | null>>;
  fonts?: (uses: readonly FontUse[]) => Promise<string>;
  /** Resolves when the stage is laid out for good: fonts loaded, charts drawn. */
  settle?: (stage: HTMLElement) => Promise<void>;
}

// ── numbers, text, matrices ─────────────────────────────────────────────────

const n2 = (v: number): string => String(Math.round(v * 100) / 100);
const num = (v: string | null | undefined): number => (v ? Number.parseFloat(v) || 0 : 0);

/** XML text and attribute values, without the characters XML 1.0 does not allow at all. */
export function esc(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Mat = readonly [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5]
];
const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const rotateAbout = (deg: number, cx: number, cy: number): Mat => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return mul(translate(cx, cy), mul([c, s, -s, c, 0, 0], translate(-cx, -cy)));
};
const at = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

class Bounds {
  x0 = Infinity;
  y0 = Infinity;
  x1 = -Infinity;
  y1 = -Infinity;
  /** A box in an element's own frame, as it lands on the slide. */
  box(m: Mat, x: number, y: number, w: number, h: number): void {
    for (const [px, py] of [at(m, x, y), at(m, x + w, y), at(m, x + w, y + h), at(m, x, y + h)]) {
      this.x0 = Math.min(this.x0, px);
      this.y0 = Math.min(this.y0, py);
      this.x1 = Math.max(this.x1, px);
      this.y1 = Math.max(this.y1, py);
    }
  }
  get empty(): boolean {
    return !Number.isFinite(this.x0);
  }
}

/** The drop shadow of `.sl-shadow` (render.css): 0 6px 10px, 28% black. Blur 10px is a deviation of 5. */
const SHADOW = { dy: 6, deviation: 5, opacity: 0.28 } as const;
const SHADOW_PAD = { l: 15, t: 9, r: 15, b: 21 } as const;

interface State {
  measure: Measurer;
  images: ReadonlyMap<string, string | null>;
  defs: string[];
  uses: Map<string, { use: Omit<FontUse, 'chars'>; chars: Set<string> }>;
  bounds: Bounds;
  missing: number;
  uid: number;
}

const XLINK = 'http://www.w3.org/1999/xlink';

function noteFont(st: State, primary: string, weight: number, style: 'normal' | 'italic', text: string): void {
  const key = `${primary}|${weight}|${style}`;
  let hit = st.uses.get(key);
  if (!hit) st.uses.set(key, (hit = { use: { family: primary, weight, style }, chars: new Set() }));
  for (const ch of text) hit.chars.add(ch);
}

// ── an element ──────────────────────────────────────────────────────────────

const flipOf = (el: HTMLElement | SVGElement): [number, number] => {
  const m = /scale\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(el.style.transform);
  return m ? [Number(m[1]), Number(m[2])] : [1, 1];
};

/** `translate(cx cy) scale(sx sy) translate(-cx -cy)`: a flip about the centre of a box, as CSS does it. */
const flipAbout = (sx: number, sy: number, cx: number, cy: number): string => `translate(${n2(cx)} ${n2(cy)}) scale(${sx} ${sy}) translate(${n2(-cx)} ${n2(-cy)})`;

/** The strokes in a drawn outline: how far they reach past the box. */
function strokeReach(svg: Element): number {
  let reach = 0;
  for (const e of Array.from(svg.querySelectorAll('[stroke-width]'))) {
    const stroke = e.getAttribute('stroke');
    if (!stroke || stroke === 'none') continue;
    const w = num(e.getAttribute('stroke-width'));
    const markers = e.hasAttribute('marker-start') || e.hasAttribute('marker-end');
    reach = Math.max(reach, markers ? w * 2 : w / 2);
  }
  return reach;
}

/** A drawn outline's contents, with every picture in it as a data URL (or gone, where it could not be had). */
function outline(svg: Element, st: State): string {
  const copy = svg.cloneNode(true) as Element;
  for (const img of Array.from(copy.querySelectorAll('image'))) {
    const url = img.getAttribute('href') ?? img.getAttributeNS(XLINK, 'href') ?? '';
    const data = st.images.get(url) ?? null;
    if (!data) {
      st.missing += 1;
      img.remove();
      continue;
    }
    img.setAttribute('href', data);
  }
  return new XMLSerializer().serializeToString(copy).replace(/^<svg\b[^>]*?\/>$/, '').replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

function textOf(frame: Element, origin: { x: number; y: number }, st: State, m: Mat): string {
  const segments = st.measure(frame, origin);
  if (!segments.length) return '';
  // A line is the runs of one paragraph that sit on one baseline.
  const lines: Segment[][] = [];
  const index = new Map<string, Segment[]>();
  for (const s of segments) {
    const key = `${s.block}|${Math.round(s.y)}`;
    let line = index.get(key);
    if (!line) {
      index.set(key, (line = []));
      lines.push(line);
    }
    line.push(s);
  }
  let out = '';
  for (const s of segments) {
    st.bounds.box(m, s.box.x, s.box.y, s.box.w, s.box.h);
    noteFont(st, s.primary, s.weight, s.style, s.text);
    if (s.highlight) out += `<rect x="${n2(s.box.x)}" y="${n2(s.box.y)}" width="${n2(s.box.w)}" height="${n2(s.box.h)}" fill="${s.highlight.fill}"${s.highlight.opacity < 1 ? ` fill-opacity="${n2(s.highlight.opacity)}"` : ''}/>`;
  }
  for (const line of lines) {
    out += '<text xml:space="preserve">';
    for (const s of line) {
      out +=
        `<tspan x="${n2(s.x)}" y="${n2(s.y)}" font-family="${esc(s.family)}" font-size="${n2(s.size)}"` +
        (s.weight !== 400 ? ` font-weight="${s.weight}"` : '') +
        (s.style === 'italic' ? ' font-style="italic"' : '') +
        ` fill="${s.fill}"` +
        (s.opacity < 1 ? ` fill-opacity="${n2(s.opacity)}"` : '') +
        (s.decoration ? ` text-decoration="${s.decoration}"` : '') +
        `>${esc(s.text)}</tspan>`;
    }
    out += '</text>';
  }
  return out;
}

function table(grid: HTMLElement, box: DOMRect, st: State, m: Mat): string {
  const rel = (r: DOMRect) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
  const paint = (color: string): string => {
    const c = parseColor(color);
    return c && c.alpha > 0 ? ` fill="${c.hex}"${c.alpha < 1 ? ` fill-opacity="${n2(c.alpha)}"` : ''}` : '';
  };
  const rect = (x: number, y: number, w: number, h: number, color: string): string => {
    const fill = paint(color);
    return fill && w > 0 && h > 0 ? `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}"${fill}/>` : '';
  };
  const g = rel(grid.getBoundingClientRect());
  const gs = getComputedStyle(grid);
  st.bounds.box(m, g.x, g.y, g.w, g.h);
  let out = rect(g.x, g.y, g.w, num(gs.borderTopWidth), gs.borderTopColor) + rect(g.x, g.y, num(gs.borderLeftWidth), g.h, gs.borderLeftColor);
  for (const cell of Array.from(grid.children) as HTMLElement[]) {
    const r = rel(cell.getBoundingClientRect());
    const cs = getComputedStyle(cell);
    const right = num(cs.borderRightWidth);
    const bottom = num(cs.borderBottomWidth);
    out += rect(r.x, r.y, r.w, r.h, cs.backgroundColor);
    out += rect(r.x + r.w - right, r.y, right, r.h, cs.borderRightColor) + rect(r.x, r.y + r.h - bottom, r.w, bottom, cs.borderBottomColor);
    out += textOf(cell, { x: box.left, y: box.top }, st, m);
  }
  return out;
}

/** The font uses in a chart's own SVG, which names its family on each `<text>`. */
function noteChartFonts(svg: Element, st: State): void {
  for (const t of Array.from(svg.querySelectorAll('text'))) {
    const family = (t.getAttribute('font-family') ?? '').split(',')[0]?.trim().replace(/^["']|["']$/g, '');
    if (!family) continue;
    noteFont(st, family, Number.parseInt(t.getAttribute('font-weight') ?? '', 10) || 400, t.getAttribute('font-style') === 'italic' ? 'italic' : 'normal', t.textContent ?? '');
  }
}

function emit(n: HTMLElement, parent: Mat, st: State): string {
  const w = num(n.style.width);
  const h = num(n.style.height);
  const left = num(n.style.left);
  const top = num(n.style.top);
  const rot = num(n.dataset.rot);
  const m = mul(parent, mul(translate(left, top), rot ? rotateAbout(rot, w / 2, h / 2) : IDENTITY));
  const origin = n.getBoundingClientRect();
  const pad = { l: 0, t: 0, r: 0, b: 0 };
  let body = '';
  let kids = 0;

  for (const c of Array.from(n.children) as HTMLElement[]) {
    if (c.classList.contains('sl-el')) {
      kids += 1;
      body += emit(c, m, st);
    } else if (c.tagName.toLowerCase() === 'svg' && c.classList.contains('sl-geom')) {
      const [sx, sy] = flipOf(c);
      const reach = strokeReach(c);
      pad.l = pad.r = pad.t = pad.b = Math.max(pad.l, reach);
      let inner = outline(c, st);
      if (c.classList.contains('sl-shadow')) {
        const id = `sh${st.uid++}`;
        st.defs.push(
          `<filter id="${id}" filterUnits="userSpaceOnUse" x="${-SHADOW_PAD.l - 8}" y="${-SHADOW_PAD.t - 8}" width="${n2(w + SHADOW_PAD.l + SHADOW_PAD.r + 16)}" height="${n2(h + SHADOW_PAD.t + SHADOW_PAD.b + 16)}" color-interpolation-filters="sRGB">` +
            `<feGaussianBlur in="SourceAlpha" stdDeviation="${SHADOW.deviation}"/><feOffset dy="${SHADOW.dy}" result="shadow"/>` +
            `<feFlood flood-color="#000000" flood-opacity="${SHADOW.opacity}"/><feComposite in2="shadow" operator="in"/>` +
            `<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
        );
        inner = `<g filter="url(#${id})">${inner}</g>`;
        pad.l = Math.max(pad.l, SHADOW_PAD.l);
        pad.r = Math.max(pad.r, SHADOW_PAD.r);
        pad.t = Math.max(pad.t, SHADOW_PAD.t);
        pad.b = Math.max(pad.b, SHADOW_PAD.b);
      }
      body += sx === 1 && sy === 1 ? `<g>${inner}</g>` : `<g transform="${flipAbout(sx, sy, w / 2, h / 2)}">${inner}</g>`;
    } else if (c.classList.contains('sl-frame')) {
      body += textOf(c, { x: origin.left, y: origin.top }, st, m);
    } else if (c.tagName.toLowerCase() === 'img') {
      const data = st.images.get(c.getAttribute('src') ?? '') ?? null;
      if (!data) {
        st.missing += 1;
        continue;
      }
      const [sx, sy] = flipOf(c);
      const x = num(c.style.left);
      const y = num(c.style.top);
      const iw = num(c.style.width);
      const ih = num(c.style.height);
      const id = `c${st.uid++}`;
      st.defs.push(`<clipPath id="${id}"><rect x="0" y="0" width="${n2(w)}" height="${n2(h)}"/></clipPath>`);
      const image = `<image x="${n2(x)}" y="${n2(y)}" width="${n2(iw)}" height="${n2(ih)}" preserveAspectRatio="none" href="${data}"/>`;
      body += `<g clip-path="url(#${id})">${sx === 1 && sy === 1 ? image : `<g transform="${flipAbout(sx, sy, x + iw / 2, y + ih / 2)}">${image}</g>`}</g>`;
    } else if (c.classList.contains('sl-missing')) {
      body += `<rect x="0" y="0" width="${n2(w)}" height="${n2(h)}" fill="#e7e7ef"/>`;
    } else if (c.classList.contains('sl-grid')) {
      body += table(c, origin, st, m);
    } else if (c.classList.contains('sl-chart')) {
      const svg = c.querySelector('svg');
      if (!svg) continue;
      const copy = svg.cloneNode(true) as SVGSVGElement;
      for (const hit of Array.from(copy.querySelectorAll('[data-hit]'))) hit.remove();
      noteChartFonts(copy, st);
      const k = /scale\(\s*([\d.]+)/.exec(c.style.transform)?.[1];
      body += `<g${k ? ` transform="scale(${k})"` : ''}>${new XMLSerializer().serializeToString(copy)}</g>`;
    }
  }

  // A group is its children; only an empty one counts for its own box.
  if (!n.classList.contains('sl-group') || kids === 0) st.bounds.box(m, -pad.l, -pad.t, w + pad.l + pad.r, h + pad.t + pad.b);

  const tf = `translate(${n2(left)} ${n2(top)})${rot ? ` rotate(${n2(rot)} ${n2(w / 2)} ${n2(h / 2)})` : ''}`;
  return `<g transform="${tf}">${body}</g>`;
}

// ── the picture ─────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The stage laid out for good: the fonts it asks for loaded, and any chart drawn. */
async function settle(stage: HTMLElement): Promise<void> {
  void stage.offsetHeight;
  const charts = stage.querySelectorAll('.sl-chart-el').length > 0;
  if (charts) await import('../render/ChartBody');
  const until = Date.now() + 4000;
  const drawn = () => Array.from(stage.querySelectorAll('.sl-chart-el')).every((c) => c.querySelector('svg'));
  while (!drawn() && Date.now() < until) await sleep(16);
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, sleep(3000)]);
  void stage.offsetHeight;
}

export async function buildPicture(src: PictureSource, deps: PictureDeps = {}): Promise<Picture | null> {
  if (!src.elements.length) return null;
  const stage = document.createElement('div');
  stage.className = 'sl-stage';
  stage.setAttribute('aria-hidden', 'true');
  Object.assign(stage.style, {
    position: 'fixed',
    left: '-30000px',
    top: '0',
    width: `${SLIDE_WIDTH}px`,
    height: `${slideHeight(src.design.size)}px`,
    overflow: 'visible',
    transform: 'none',
    pointerEvents: 'none'
  });
  document.body.appendChild(stage);
  const root = createRoot(stage, { identifierPrefix: 'pic' });
  try {
    const ctx = renderCtx(src.design, src.layoutId, 'thumb', src.number, null, src.assetUrl);
    flushSync(() =>
      root.render(
        <>
          {src.elements.map((el, i) => (
            <ElementView key={el.id ?? i} el={el} ctx={ctx} ox={0} oy={0} />
          ))}
        </>
      )
    );
    await (deps.settle ?? settle)(stage);

    // The rotation is each shape's own `<g>`: read it, and lay the text out without it.
    for (const e of Array.from(stage.querySelectorAll<HTMLElement>('.sl-el'))) {
      e.dataset.rot = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(e.style.transform)?.[1] ?? '0';
      e.style.transform = 'none';
    }

    const urls = new Set<string>();
    for (const e of Array.from(stage.querySelectorAll('svg.sl-geom image'))) urls.add(e.getAttribute('href') ?? '');
    for (const e of Array.from(stage.querySelectorAll('img'))) urls.add(e.getAttribute('src') ?? '');
    urls.delete('');
    const st: State = {
      measure: deps.measure ?? measureText,
      images: await (deps.inline ?? inlineImages)(urls),
      defs: [],
      uses: new Map(),
      bounds: new Bounds(),
      missing: 0,
      uid: 0
    };

    let body = '';
    for (const e of Array.from(stage.children) as HTMLElement[]) if (e.classList.contains('sl-el')) body += emit(e, IDENTITY, st);
    const b = st.bounds;
    if (b.empty) return null;

    const ox = Math.floor(b.x0 * 100) / 100;
    const oy = Math.floor(b.y0 * 100) / 100;
    const width = Math.max(1, Math.ceil(b.x1 - ox));
    const height = Math.max(1, Math.ceil(b.y1 - oy));
    const faces = await (deps.fonts ?? embeddedFontCss)([...st.uses.values()].map((u) => ({ ...u.use, chars: u.chars })));
    const defs = [...st.defs, ...(faces ? [`<style type="text/css"><![CDATA[${faces}]]></style>`] : [])].join('');
    const svg =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="${XLINK}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      (defs ? `<defs>${defs}</defs>` : '') +
      `<g transform="translate(${n2(-ox)} ${n2(-oy)})">${body}</g></svg>`;
    // `xlink:href` is what every program that opens an SVG reads; `href` is only the newest.
    return { svg: svg.replace(/(<image\b[^>]*?)\shref="/g, '$1 xlink:href="'), width, height, missing: st.missing };
  } finally {
    root.unmount();
    stage.remove();
  }
}
