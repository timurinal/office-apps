/**
 * A chart, drawn: `ChartGeom` (layout.ts) in, SVG out, and no decisions of its own.
 *
 * Everything is a presentation attribute, never a class or a custom property, so the element can
 * be serialised as it stands and opened anywhere (Download as SVG, and the PNG drawn from it).
 * Marks carry `data-k`, a key that stays the same for the same bar, point or slice across versions
 * of the chart, which is how animate.ts finds the element to move. The hit layer carries
 * `data-tip`, an index into `geom.tips`, and is left out of an export.
 */

import { memo, type Ref } from 'react';
import { INK } from './palette';
import { MONO, SANS, dotPath, type ChartGeom, type DotMark, type LineMark, type RectMark, type SliceMark } from './layout';

const num = (n: number): string => String(Math.round(n * 100) / 100);

// ── paths ───────────────────────────────────────────────────────────────────

/** x, y, x, y … as `M … L …`, broken wherever a point is missing; a lone point draws nothing. */
export function linePath(pts: readonly number[]): string {
  let d = '';
  let run = 0;
  for (let k = 0; k < pts.length; k += 2) {
    const x = pts[k]!;
    const y = pts[k + 1]!;
    if (Number.isNaN(x) || Number.isNaN(y)) {
      run = 0;
      continue;
    }
    d += `${run === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`;
    run++;
  }
  // A segment of one point is a move with nothing after it, which draws nothing: leave it.
  return d;
}

/** The wash under an area's line: each unbroken run, along the top and back along the floor. */
export function areaPath(pts: readonly number[], floor: readonly number[]): string {
  let d = '';
  let start = -1;
  const close = (end: number) => {
    if (start < 0 || end - start < 1) return;
    let top = '';
    let back = '';
    for (let k = start; k <= end; k++) top += `${k === start ? 'M' : 'L'}${num(pts[k * 2]!)} ${num(pts[k * 2 + 1]!)}`;
    for (let k = end; k >= start; k--) back += `L${num(pts[k * 2]!)} ${num(floor[k]!)}`;
    d += `${top}${back}Z`;
  };
  const n = pts.length / 2;
  for (let k = 0; k < n; k++) {
    if (Number.isNaN(pts[k * 2]!)) {
      close(k - 1);
      start = -1;
    } else if (start < 0) start = k;
  }
  close(n - 1);
  return d;
}

/** A bar's outline with only its data end rounded, at 4px or half its thickness if that is less. */
export function rectPath(m: Pick<RectMark, 'x' | 'y' | 'w' | 'h' | 'round'>): string {
  const { x, y, w, h } = m;
  // The rounded end is as thick as the bar, so its radius is bounded by that, not by the bar's length.
  const r = Math.max(0, m.round === 'left' || m.round === 'right' ? Math.min(4, h / 2, w) : Math.min(4, w / 2, h));
  const X = x + w;
  const Y = y + h;
  switch (m.round) {
    case 'up':
      return `M${num(x)} ${num(Y)}V${num(y + r)}A${r} ${r} 0 0 1 ${num(x + r)} ${num(y)}H${num(X - r)}A${r} ${r} 0 0 1 ${num(X)} ${num(y + r)}V${num(Y)}Z`;
    case 'down':
      return `M${num(x)} ${num(y)}V${num(Y - r)}A${r} ${r} 0 0 0 ${num(x + r)} ${num(Y)}H${num(X - r)}A${r} ${r} 0 0 0 ${num(X)} ${num(Y - r)}V${num(y)}Z`;
    case 'right':
      return `M${num(x)} ${num(y)}H${num(X - r)}A${r} ${r} 0 0 1 ${num(X)} ${num(y + r)}V${num(Y - r)}A${r} ${r} 0 0 1 ${num(X - r)} ${num(Y)}H${num(x)}Z`;
    case 'left':
      return `M${num(X)} ${num(y)}H${num(x + r)}A${r} ${r} 0 0 0 ${num(x)} ${num(y + r)}V${num(Y - r)}A${r} ${r} 0 0 0 ${num(x + r)} ${num(Y)}H${num(X)}Z`;
    default:
      return `M${num(x)} ${num(y)}H${num(X)}V${num(Y)}H${num(x)}Z`;
  }
}

/** A slice of a pie or a ring of a doughnut; a whole circle is two arcs, since one cannot start where it ends. */
export function slicePath(m: Pick<SliceMark, 'cx' | 'cy' | 'r0' | 'r1' | 'a0' | 'a1'>): string {
  const { cx, cy, r0, r1, a0, a1 } = m;
  const at = (r: number, a: number) => `${num(cx + r * Math.sin(a))} ${num(cy - r * Math.cos(a))}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const ring = (r: number, sweep: number) => `M${num(cx)} ${num(cy - r)}A${r} ${r} 0 1 ${sweep} ${num(cx)} ${num(cy + r)}A${r} ${r} 0 1 ${sweep} ${num(cx)} ${num(cy - r)}Z`;
    return r0 > 0 ? ring(r1, 1) + ring(r0, 0) : ring(r1, 1);
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (r0 <= 0) return `M${num(cx)} ${num(cy)}L${at(r1, a0)}A${num(r1)} ${num(r1)} 0 ${large} 1 ${at(r1, a1)}Z`;
  return `M${at(r1, a0)}A${num(r1)} ${num(r1)} 0 ${large} 1 ${at(r1, a1)}L${at(r0, a1)}A${num(r0)} ${num(r0)} 0 ${large} 0 ${at(r0, a0)}Z`;
}

/** Where a bar's tween is anchored: the side it grows from. */
export const ORIGIN: Record<RectMark['base'], string> = { bottom: '0% 100%', top: '0% 0%', left: '0% 0%', right: '100% 0%' };

// ── elements ────────────────────────────────────────────────────────────────

const fillOpacityOfArea = 0.12;
const SWATCH = 10;

function Mark({ m }: { m: RectMark | DotMark | SliceMark }) {
  switch (m.kind) {
    case 'rect': {
      const style = { transformBox: 'fill-box', transformOrigin: ORIGIN[m.base] } as const;
      const stroke = m.gap ? { stroke: INK.surface, strokeWidth: 2 } : {};
      return m.round === 'none' ? (
        <rect data-k={m.key} x={m.x} y={m.y} width={m.w} height={m.h} fill={m.fill} style={style} {...stroke} />
      ) : (
        <path data-k={m.key} d={rectPath(m)} fill={m.fill} style={style} {...stroke} />
      );
    }
    case 'dot':
      return m.shape % 4 === 0 ? (
        <circle data-k={m.key} cx={m.x} cy={m.y} r={m.r} fill={m.fill} stroke={INK.surface} strokeWidth={4} paintOrder="stroke" />
      ) : (
        <path data-k={m.key} d={dotPath(m.shape, m.x, m.y, m.r)} fill={m.fill} stroke={INK.surface} strokeWidth={4} strokeLinejoin="round" paintOrder="stroke" />
      );
    case 'slice':
      return <path data-k={m.key} d={slicePath(m)} fill={m.fill} stroke={INK.surface} strokeWidth={2} strokeLinejoin="round" data-tip={m.tip} />;
  }
}

/** Marks in the order they are painted: washes, bars, slices, lines, then the dots that sit on them. */
const ORDER: Record<string, number> = { rect: 1, slice: 1, line: 2, dot: 3 };

export interface ChartSvgProps {
  geom: ChartGeom;
  svgRef?: Ref<SVGSVGElement>;
}

export const ChartSvg = memo(function ChartSvg({ geom, svgRef }: ChartSvgProps) {
  const marks = [...geom.marks].sort((a, b) => ORDER[a.kind]! - ORDER[b.kind]!);
  const areas = marks.filter((m): m is LineMark => m.kind === 'line' && m.floor !== undefined);
  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${geom.w} ${geom.h}`}
      width={geom.w}
      height={geom.h}
      role="img"
      aria-label={geom.summary}
      fontFamily={SANS}
    >
      <rect data-bg="" width={geom.w} height={geom.h} fill={INK.surface} />
      {geom.rules.map((r) => (
        <line key={r.key} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={r.stroke} strokeWidth={1} shapeRendering="crispEdges" />
      ))}
      {/* An area's wash goes under every line, so one series never hides another's edge. */}
      {areas.map((m) => (
        <path key={`${m.key}.area`} data-k={`${m.key}.area`} d={areaPath(m.pts, m.floor!)} fill={m.color} fillOpacity={fillOpacityOfArea} stroke="none" />
      ))}
      {marks.map((m) => (m.kind === 'line' ? <LineOnly key={m.key} m={m} /> : <Mark key={m.key} m={m} />))}
      {geom.texts.map((t) => (
        <text
          key={t.key}
          x={t.x}
          y={t.y}
          textAnchor={t.anchor}
          fontSize={t.size}
          fontWeight={t.weight}
          fill={t.fill}
          fontFamily={t.mono ? MONO : SANS}
          {...(t.rotate ? { transform: `rotate(${t.rotate} ${t.x} ${t.y})` } : {})}
        >
          {t.text}
        </text>
      ))}
      {geom.empty && (
        <text x={geom.plot.x + geom.plot.w / 2} y={geom.plot.y + geom.plot.h / 2} textAnchor="middle" fontSize={13} fill={INK.text}>
          {geom.empty}
        </text>
      )}
      {geom.legend.map((l) => (
        <g key={l.key}>
          {l.shape === 'swatch' && <rect x={l.x} y={l.y - SWATCH / 2} width={SWATCH} height={SWATCH} rx={2} fill={l.color} />}
          {l.shape === 'line' && (
            <>
              <line x1={l.x} y1={l.y} x2={l.x + 18} y2={l.y} stroke={l.color} strokeWidth={2} strokeLinecap="round" />
              <path d={dotPath(l.mark, l.x + 9, l.y, 3.2)} fill={l.color} />
            </>
          )}
          {l.shape === 'dot' && <path d={dotPath(l.mark, l.x + 5, l.y, 4)} fill={l.color} />}
          <text x={l.x + (l.shape === 'line' ? 24 : 16)} y={l.y + 4} fontSize={12} fill={INK.text}>
            {l.text}
          </text>
        </g>
      ))}
      <g data-hit="">
        <line data-guide="" x1={0} y1={geom.plot.y} x2={0} y2={geom.plot.y + geom.plot.h} stroke={INK.axis} strokeWidth={1} visibility="hidden" pointerEvents="none" />
        {geom.hits.map((h, n) =>
          h.kind === 'rect' ? (
            <rect key={n} x={h.x} y={h.y} width={h.w} height={h.h} fill="transparent" data-tip={h.tip} {...(h.guide !== undefined ? { 'data-guide': h.guide } : {})} />
          ) : (
            <circle key={n} cx={h.cx} cy={h.cy} r={h.r} fill="transparent" data-tip={h.tip} />
          )
        )}
      </g>
    </svg>
  );
});

/** A line without its wash, which `ChartSvg` has already drawn underneath every line. */
function LineOnly({ m }: { m: LineMark }) {
  return <path data-k={m.key} d={linePath(m.pts)} fill="none" stroke={m.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
}
