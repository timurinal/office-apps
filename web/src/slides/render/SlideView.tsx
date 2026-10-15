/**
 * One slide, drawn as static DOM at any width: the thumbnails in the rail, the slide on the canvas,
 * a slide in the show, a version's preview.
 *
 * The slide is laid out once at its logical size (1920 wide) and scaled by one `transform`, so a
 * thumbnail and the canvas are the same markup. Layers, back to front: the background (the
 * slide's, else its layout's, else the master's), the master's elements (unless the layout or the
 * slide turns them off), the layout's decorations (unless the slide does), the slide's elements.
 * Placeholders on the master and the layout are never drawn on a slide; an empty placeholder on
 * the slide shows its layout's prompt in the editor only.
 *
 * Memoised per element: the model hands back the same object for an element until it changes, so
 * typing in one box re-renders that box and nothing else.
 */

import { lazy, memo, Suspense, useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import type {
  Aspect,
  ChartElement,
  ElementJSON,
  Fill,
  GroupElement,
  ImageElement,
  LayoutJSON,
  Line,
  LineElement,
  Placeholder,
  ShapeElement,
  SlideJSON,
  TableElement,
  ThemeJSON
} from '../model/deck';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../model/deck';
import { resolveColor } from '../model/color';
import { safeFill, safeLine } from '../model/safe';
import { isEmptyText } from '../model/schema';
import { inheritedStyle, layoutById, layoutPlaceholder, type Design, type ResolvedStyle } from '../model/styles';
import { useAssetUrl, type AssetUrl } from './assets';
import { dashArray, lineEnds, shapePath } from './geometry';
import { backgroundCss, pictureUrl, reactStyle, solidCss } from './paint';
import { Paragraphs, TextFrame, type RenderMode } from './Text';
import './render.css';

const ChartBody = lazy(() => import('./ChartBody'));

export type { RenderMode };

export interface SlideViewProps {
  design: Design & { size: Aspect };
  slide: SlideJSON;
  /** CSS px. */
  width: number;
  /** The slide's number, 1 first, for a slide-number placeholder. */
  number?: number;
  mode?: RenderMode;
  /** The element whose text the text editor is drawing; its own text is left out here. */
  editing?: string | null;
  className?: string;
  style?: CSSProperties;
}

export const slideHeight = (size: Aspect | undefined): number => SLIDE_HEIGHT[size ?? '16:9'] ?? 1080;

const n = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const domId = (raw: string): string => `sl${raw.replace(/[^A-Za-z0-9_-]/g, '')}`;

export interface RenderCtx {
  design: Design;
  theme: ThemeJSON;
  layout: LayoutJSON | undefined;
  layoutId: string;
  mode: RenderMode;
  number?: number;
  editing: string | null;
  assetUrl: AssetUrl;
  styleAt: (ph: Placeholder | undefined, level: number) => ResolvedStyle;
}

export function renderCtx(design: Design, layoutId: string, mode: RenderMode, number: number | undefined, editing: string | null, assetUrl: AssetUrl): RenderCtx {
  const cache = new Map<string, ResolvedStyle>();
  const layout = layoutById(design, layoutId) ?? layoutById(design, 'blank');
  const id = layout?.id ?? layoutId;
  return {
    design,
    theme: design.theme,
    layout,
    layoutId: id,
    mode,
    number,
    editing,
    assetUrl,
    styleAt: (ph, level) => {
      const key = `${ph?.type ?? ''}|${ph?.idx ?? ''}|${level}`;
      let s = cache.get(key);
      if (!s) cache.set(key, (s = inheritedStyle(design, id, ph ?? null, level)));
      return s;
    }
  };
}

/** Where an element sits inside its parent, and its turn. */
function frame(el: ElementJSON, ox: number, oy: number): CSSProperties {
  const rot = n(el.rot);
  return {
    left: n(el.x) - ox,
    top: n(el.y) - oy,
    width: Math.max(0, n(el.w)),
    height: Math.max(0, n(el.h)),
    ...(rot ? { transform: `rotate(${rot}deg)` } : {})
  };
}

const flipOf = (el: { flipH?: boolean; flipV?: boolean }): string | undefined =>
  el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined;

// ── fills and strokes in SVG ────────────────────────────────────────────────

interface Paint {
  fill: string;
  opacity?: number;
  defs: ReactNode;
  /** A picture clipped to the outline, drawn in place of a fill. */
  picture?: ReactNode;
}

function paintOf(raw: Fill | undefined, theme: ThemeJSON, id: string, d: string, w: number, h: number, assetUrl: AssetUrl): Paint {
  const fill = safeFill(raw);
  if (!fill || fill.kind === 'none') return { fill: 'none', defs: null };
  if (fill.kind === 'solid') {
    const c = resolveColor(fill.color, theme);
    if (!c) return { fill: 'none', defs: null };
    const a = typeof fill.alpha === 'number' ? Math.min(1, Math.max(0, fill.alpha)) : 1;
    return a < 1 ? { fill: c, opacity: a, defs: null } : { fill: c, defs: null };
  }
  if (fill.kind === 'gradient') {
    const stops = fill.stops
      .map((s) => ({ at: Math.min(1, Math.max(0, n(s.at))), color: resolveColor(s.color, theme) }))
      .filter((s): s is { at: number; color: string } => s.color !== null)
      .sort((a, b) => a.at - b.at);
    if (!stops.length) return { fill: 'none', defs: null };
    const gid = `${id}g`;
    return {
      fill: `url(#${gid})`,
      defs: (
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0" gradientTransform={`rotate(${n(fill.angle)} 0.5 0.5)`}>
          {stops.map((s, i) => (
            <stop key={i} offset={s.at} stopColor={s.color} />
          ))}
        </linearGradient>
      )
    };
  }
  const url = pictureUrl(fill.asset, assetUrl);
  if (!url) return { fill: '#e7e7ef', defs: null };
  const cid = `${id}c`;
  const ratio = fill.fit === 'contain' ? 'xMidYMid meet' : fill.fit === 'stretch' ? 'none' : 'xMidYMid slice';
  return {
    fill: 'none',
    defs: (
      <clipPath id={cid}>
        <path d={d} />
      </clipPath>
    ),
    picture: <image href={url} x={0} y={0} width={w} height={h} preserveAspectRatio={ratio} clipPath={`url(#${cid})`} />
  };
}

interface Stroke {
  stroke: string;
  strokeWidth?: number;
  strokeDasharray?: string;
}

function strokeOf(raw: Line | undefined, theme: ThemeJSON): Stroke {
  const line = safeLine(raw);
  if (!line || !(line.width > 0)) return { stroke: 'none' };
  const c = resolveColor(line.color, theme);
  if (!c) return { stroke: 'none' };
  const dash = dashArray(line.dash, line.width);
  return { stroke: c, strokeWidth: line.width, ...(dash ? { strokeDasharray: dash } : {}) };
}

// ── elements ────────────────────────────────────────────────────────────────

interface ElProps {
  el: ElementJSON;
  ctx: RenderCtx;
  ox: number;
  oy: number;
}

const ShapeView = memo(function ShapeView({ el, ctx, ox, oy }: ElProps & { el: ShapeElement }) {
  const id = domId(useId());
  const w = Math.max(0, n(el.w));
  const h = Math.max(0, n(el.h));
  const path = shapePath(el.shape, w, h, el.adjust);
  const paint = paintOf(el.fill, ctx.theme, id, path.d, w, h, ctx.assetUrl);
  const stroke = strokeOf(el.line, ctx.theme);
  const drawn = paint.fill !== 'none' || paint.picture || stroke.stroke !== 'none';
  const styleAt = (level: number) => ctx.styleAt(el.ph, level);
  let text = el.text;
  let prompt = false;
  if (ctx.editing === el.id) text = undefined;
  else if (el.ph && isEmptyText(text)) {
    const own = ctx.mode === 'edit' ? layoutPlaceholder(ctx.layout, el.ph) : undefined;
    text = own?.type === 'shape' && el.ph.type !== 'sldNum' ? own.text : undefined;
    prompt = !!text;
  }
  return (
    <div className="sl-el" data-el={el.id} style={frame(el, ox, oy)}>
      {drawn && (
        <svg className={el.shadow ? 'sl-geom sl-shadow' : 'sl-geom'} width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ transform: flipOf(el) }} aria-hidden="true">
          {paint.defs && <defs>{paint.defs}</defs>}
          <path d={path.d} fill={paint.fill} fillOpacity={paint.opacity} fillRule={path.evenOdd ? 'evenodd' : undefined} stroke={path.stroke ? 'none' : stroke.stroke} strokeWidth={stroke.strokeWidth} strokeDasharray={stroke.strokeDasharray} />
          {paint.picture}
          {paint.fill !== 'none' &&
            path.shades?.map((s, i) => <path key={i} d={s.d} fill={s.tone === 'darker' ? '#000000' : '#ffffff'} fillOpacity={s.tone === 'darker' ? 0.18 : 0.28} stroke="none" />)}
          {path.stroke && stroke.stroke !== 'none' && <path d={path.stroke} fill="none" {...stroke} />}
        </svg>
      )}
      {text && !isEmptyText(text) && (
        <TextFrame doc={text} styleAt={styleAt} theme={ctx.theme} mode={ctx.mode} number={ctx.number} box={el.textBox} w={w} h={h} className={prompt ? 'sl-prompt' : undefined} />
      )}
    </div>
  );
});

const ImageView = memo(function ImageView({ el, ctx, ox, oy }: ElProps & { el: ImageElement }) {
  const url = pictureUrl(el.asset, ctx.assetUrl);
  const w = Math.max(0, n(el.w));
  const h = Math.max(0, n(el.h));
  const c = el.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const cut = (v: unknown) => Math.min(0.95, Math.max(-1, n(v)));
  const [l, t, r, b] = [cut(c.l), cut(c.t), cut(c.r), cut(c.b)];
  const fw = w / Math.max(0.05, 1 - l - r);
  const fh = h / Math.max(0.05, 1 - t - b);
  const stroke = strokeOf(el.line, ctx.theme);
  return (
    <div className="sl-el sl-image" data-el={el.id} style={frame(el, ox, oy)}>
      {url ? (
        <img
          src={url}
          alt={ctx.mode === 'present' ? (el.alt ?? '') : ''}
          draggable={false}
          decoding="async"
          style={{ left: -l * fw, top: -t * fh, width: fw, height: fh, transform: flipOf(el) }}
        />
      ) : (
        <div className="sl-missing" />
      )}
      {stroke.stroke !== 'none' && (
        <svg className="sl-geom" width={w} height={h} aria-hidden="true">
          <rect x={0} y={0} width={w} height={h} fill="none" {...stroke} />
        </svg>
      )}
    </div>
  );
});

function Marker({ id, kind, color }: { id: string; kind: string; color: string }) {
  if (kind === 'oval') {
    return (
      <marker id={id} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" markerUnits="strokeWidth" orient="auto-start-reverse">
        <circle cx="5" cy="5" r="4.5" fill={color} />
      </marker>
    );
  }
  const open = kind === 'arrow';
  return (
    <marker id={id} viewBox="0 0 10 10" refX={open ? '8' : '9'} refY="5" markerWidth="3.5" markerHeight="3.5" markerUnits="strokeWidth" orient="auto-start-reverse">
      <path d={open ? 'M1 1 L9 5 L1 9' : 'M0 0 L10 5 L0 10 Z'} fill={open ? 'none' : color} stroke={open ? color : 'none'} strokeWidth={open ? 1.5 : 0} strokeLinecap="round" strokeLinejoin="round" />
    </marker>
  );
}

const LineView = memo(function LineView({ el, ctx, ox, oy }: ElProps & { el: LineElement }) {
  const id = domId(useId());
  const w = Math.max(0, n(el.w));
  const h = Math.max(0, n(el.h));
  const stroke = strokeOf(el.line, ctx.theme);
  const line = safeLine(el.line);
  const end = lineEnds(w, h, el.flipH, el.flipV);
  const head = line?.head && line.head !== 'none' ? line.head : null;
  const tail = line?.tail && line.tail !== 'none' ? line.tail : null;
  return (
    <div className="sl-el sl-line" data-el={el.id} style={frame(el, ox, oy)}>
      {stroke.stroke !== 'none' && (
        <svg className="sl-geom" width={Math.max(1, w)} height={Math.max(1, h)} aria-hidden="true">
          <defs>
            {head && <Marker id={`${id}h`} kind={head} color={stroke.stroke} />}
            {tail && <Marker id={`${id}t`} kind={tail} color={stroke.stroke} />}
          </defs>
          <line
            {...end}
            {...stroke}
            strokeLinecap="round"
            markerStart={head ? `url(#${id}h)` : undefined}
            markerEnd={tail ? `url(#${id}t)` : undefined}
          />
        </svg>
      )}
    </div>
  );
});

/** A table's own look: its header row and bands in the theme's first accent, as PowerPoint's default style. */
function tableLook(el: TableElement, theme: ThemeJSON) {
  const accent = { theme: 'accent1' as const };
  const banded = !!el.bandRows;
  const header = !!el.firstRow;
  const border = safeLine(el.border);
  const line = border && border.width > 0 ? { w: border.width, c: resolveColor(border.color, theme) ?? '#ffffff' } : header || banded ? { w: 2, c: resolveColor({ theme: 'lt1' }, theme)! } : { w: 1, c: resolveColor({ theme: 'dk1', lum: 0.75 }, theme)! };
  const rowFill = (r: number): string | null => {
    if (header && r === 0) return resolveColor(accent, theme);
    const k = header ? r - 1 : r;
    if (banded) return resolveColor({ theme: 'accent1', lum: k % 2 === 0 ? 0.6 : 0.8 }, theme);
    return header ? resolveColor({ theme: 'accent1', lum: 0.8 }, theme) : null;
  };
  return { line, rowFill, header };
}

const TableView = memo(function TableView({ el, ctx, ox, oy }: ElProps & { el: TableElement }) {
  const cols = (Array.isArray(el.cols) ? el.cols : []).map((c) => Math.max(0, n(c)));
  const rows = Array.isArray(el.rows) ? el.rows : [];
  const look = tableLook(el, ctx.theme);
  const headStyle = (level: number): ResolvedStyle => ({ ...ctx.styleAt(undefined, level), color: { theme: 'lt1' }, bold: true });
  const bodyStyle = (level: number): ResolvedStyle => ctx.styleAt(undefined, level);
  const border = `${look.line.w}px solid ${look.line.c}`;
  return (
    <div className="sl-el sl-table" data-el={el.id} style={frame(el, ox, oy)}>
      <div
        className="sl-grid"
        style={{
          gridTemplateColumns: cols.map((c) => `${c}px`).join(' '),
          gridTemplateRows: rows.map((r) => `minmax(${Math.max(0, n(r?.h))}px, auto)`).join(' '),
          borderTop: border,
          borderLeft: border
        }}
      >
        {rows.map((row, r) =>
          (Array.isArray(row?.cells) ? row.cells : []).map((cell, c) => {
            if (!cell || cell.merged || c >= cols.length) return null;
            const fill = safeFill(cell.fill);
            const own = fill?.kind === 'solid' ? solidCss(fill, ctx.theme) : fill?.kind === 'none' ? 'transparent' : null;
            const bg = own ?? look.rowFill(r);
            const rs = Math.max(1, Math.round(n(cell.rowSpan, 1)));
            const cs = Math.max(1, Math.round(n(cell.colSpan, 1)));
            return (
              <div
                key={`${r}.${c}`}
                className="sl-cell"
                style={{
                  gridRow: `${r + 1} / span ${rs}`,
                  gridColumn: `${c + 1} / span ${cs}`,
                  background: bg ?? 'transparent',
                  borderRight: border,
                  borderBottom: border,
                  justifyContent: cell.anchor === 'middle' ? 'center' : cell.anchor === 'bottom' ? 'flex-end' : 'flex-start'
                }}
              >
                <div className="sl-text">
                  <Paragraphs doc={cell.text} styleAt={look.header && r === 0 ? headStyle : bodyStyle} theme={ctx.theme} mode={ctx.mode} number={ctx.number} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

const ChartView = memo(function ChartView({ el, ctx, ox, oy }: ElProps & { el: ChartElement }) {
  return (
    <div className="sl-el sl-chart-el" data-el={el.id} style={frame(el, ox, oy)}>
      <Suspense fallback={<div className="sl-chart-wait" />}>
        <ChartBody el={el} theme={ctx.theme} />
      </Suspense>
    </div>
  );
});

/** A group's children, which are in slide coordinates, drawn inside the group's box; a flipped group mirrors them. */
const GroupView = memo(function GroupView({ el, ctx, ox, oy }: ElProps & { el: GroupElement }) {
  const gx = n(el.x);
  const gy = n(el.y);
  const children = useMemo(() => {
    const list = Array.isArray(el.children) ? el.children : [];
    if (!el.flipH && !el.flipV) return list;
    const w = n(el.w);
    const h = n(el.h);
    return list.map((c): ElementJSON => {
      const out = { ...c };
      if (el.flipH) {
        out.x = gx + w - (n(c.x) - gx) - n(c.w);
        out.flipH = !c.flipH;
      }
      if (el.flipV) {
        out.y = gy + h - (n(c.y) - gy) - n(c.h);
        out.flipV = !c.flipV;
      }
      return out;
    });
  }, [el, gx, gy]);
  return (
    <div className="sl-el sl-group" data-el={el.id} style={frame(el, ox, oy)}>
      {children.map((c, i) => (
        <ElementView key={c.id ?? i} el={c} ctx={ctx} ox={gx} oy={gy} />
      ))}
    </div>
  );
});

export const ElementView = memo(function ElementView(p: ElProps): ReactNode {
  switch (p.el.type) {
    case 'shape':
      return <ShapeView {...p} el={p.el} />;
    case 'image':
      return <ImageView {...p} el={p.el} />;
    case 'line':
      return <LineView {...p} el={p.el} />;
    case 'table':
      return <TableView {...p} el={p.el} />;
    case 'chart':
      return <ChartView {...p} el={p.el} />;
    case 'group':
      return <GroupView {...p} el={p.el} />;
    default:
      return null;
  }
});

// ── the slide ───────────────────────────────────────────────────────────────

/** What is drawn behind a slide's own elements: the master's (unless turned off) and the layout's decorations. */
export function backdropOf(design: Design, layout: LayoutJSON | undefined, slide: SlideJSON): { master: ElementJSON[]; layout: ElementJSON[] } {
  const own = slide.showMaster !== false;
  const master = own && layout?.showMaster !== false ? (design.master?.elements ?? []).filter((e) => !e.ph) : [];
  const deco = own ? (layout?.elements ?? []).filter((e) => !e.ph) : [];
  return { master, layout: deco };
}

export const SlideView = memo(function SlideView({ design, slide, width, number, mode = 'thumb', editing = null, className, style }: SlideViewProps) {
  const assetUrl = useAssetUrl();
  const ctx = useMemo(() => renderCtx(design, slide.layout, mode, number, editing, assetUrl), [design, slide.layout, mode, number, editing, assetUrl]);
  const height = slideHeight(design.size);
  const k = width / SLIDE_WIDTH;
  const back = useMemo(() => backdropOf(design, ctx.layout, slide), [design, ctx.layout, slide]);
  const bg = backgroundCss(safeFill(slide.bg) ?? safeFill(ctx.layout?.bg) ?? safeFill(design.master?.bg), ctx.theme, assetUrl);
  return (
    <div className={className ? `sl-view ${className}` : 'sl-view'} style={{ ...style, width, height: height * k }}>
      <div className="sl-stage" style={{ width: SLIDE_WIDTH, height, transform: `scale(${k})`, ...reactStyle(bg) }}>
        {back.master.map((e, i) => (
          <ElementView key={`m${i}`} el={e} ctx={ctx} ox={0} oy={0} />
        ))}
        {back.layout.map((e, i) => (
          <ElementView key={`l${i}`} el={e} ctx={ctx} ox={0} oy={0} />
        ))}
        {slide.elements.map((e, i) => (
          <ElementView key={e.id ?? `e${i}`} el={e} ctx={ctx} ox={0} oy={0} />
        ))}
      </div>
    </div>
  );
});
