/**
 * A chart part (`c:chartSpace`) as the deck's `ChartElement`: its kind, its categories, and each
 * series' name, values and colour, taken from the cached values the file carries beside its
 * formulas. The workbook behind a chart is never opened; what the chart showed when it was saved
 * is what is read.
 *
 * Bar and column, line, pie and scatter are the deck's. An area chart is drawn as a line chart,
 * a doughnut as a pie, a bubble as a scatter; radar, stock and surface charts are left out. A
 * chart of two kinds (columns and a line) keeps the first kind's series.
 */

import type { ChartElement, Color } from '../../slides/model/deck';
import { plural } from '../types';
import { child, elements, textContent, descendants, type XNode } from '../xml';
import { colorIn } from './color';
import type { PartCtx } from './ctx';
import { pick } from './part';

const MAX_SERIES = 50;
const MAX_POINTS = 1000;

type Kind = ChartElement['chart'];

const GROUPS: Record<string, { kind: Kind; approx?: { noun: string; as: string } }> = {
  'c:barChart': { kind: 'column' },
  'c:bar3DChart': { kind: 'column' },
  'c:lineChart': { kind: 'line' },
  'c:line3DChart': { kind: 'line' },
  'c:areaChart': { kind: 'line', approx: { noun: 'area chart', as: 'line chart' } },
  'c:area3DChart': { kind: 'line', approx: { noun: 'area chart', as: 'line chart' } },
  'c:pieChart': { kind: 'pie' },
  'c:pie3DChart': { kind: 'pie' },
  'c:ofPieChart': { kind: 'pie' },
  'c:doughnutChart': { kind: 'pie', approx: { noun: 'doughnut chart', as: 'pie chart' } },
  'c:scatterChart': { kind: 'scatter' },
  'c:bubbleChart': { kind: 'scatter', approx: { noun: 'bubble chart', as: 'scatter chart' } }
};

const UNSUPPORTED = ['c:radarChart', 'c:stockChart', 'c:surfaceChart', 'c:surface3DChart'];

/** The points of a cache (`strCache`, `numCache`, or a literal) as strings, in index order. */
function points(n: XNode | null | undefined): string[] {
  if (!n) return [];
  const cache = child(n, 'c:strCache') ?? child(n, 'c:numCache') ?? child(n, 'c:multiLvlStrCache') ?? n;
  const count = Math.min(MAX_POINTS, Number(child(cache, 'c:ptCount')?.attrs.val ?? 0) || 0);
  const out: string[] = Array.from({ length: count }, () => '');
  let max = -1;
  // Categories in levels (a year over its months): the innermost level, which is the first, is what names a point.
  for (const pt of elements(child(cache, 'c:lvl') ?? cache)) {
    if (pt.name !== 'c:pt') continue;
    const idx = Number(pt.attrs.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_POINTS) continue;
    const v = child(pt, 'c:v');
    out[idx] = v ? textContent(v).slice(0, 200) : '';
    max = Math.max(max, idx);
  }
  return out.length > max ? out : out.concat(Array.from({ length: max + 1 - out.length }, () => ''));
}

/** The reference or literal inside a `c:cat`, `c:val`, `c:xVal`, `c:yVal` or `c:tx`. */
function data(n: XNode | null | undefined): XNode | null {
  if (!n) return null;
  return child(n, 'c:strRef') ?? child(n, 'c:numRef') ?? child(n, 'c:multiLvlStrRef') ?? child(n, 'c:strLit') ?? child(n, 'c:numLit') ?? n;
}

const numbers = (xs: string[]): number[] => xs.map((v) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : 0));

function seriesColor(ser: XNode, pc: PartCtx): Color | undefined {
  const sp = child(ser, 'c:spPr');
  const fill = colorIn(child(sp, 'a:solidFill'), pc.color) ?? colorIn(child(child(sp, 'a:ln'), 'a:solidFill'), pc.color);
  return fill?.color;
}

type ChartParts = Pick<ChartElement, 'chart' | 'categories' | 'series' | 'title'>;

export function readChart(root: XNode, pc: PartCtx): ChartParts | null {
  const chart = child(root, 'c:chart');
  const plot = child(chart, 'c:plotArea');
  if (!plot) return null;
  const groups = elements(plot).filter((c) => pick(GROUPS, c.name) !== undefined);
  if (groups.length === 0) {
    if (elements(plot).some((c) => UNSUPPORTED.includes(c.name))) pc.deck.warnings.add('chart-kind', (n) => `${plural(n, 'chart')} of a kind that cannot be drawn ${n === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  const group = groups[0]!;
  const info = pick(GROUPS, group.name)!;
  if (info.approx) {
    const { noun, as } = info.approx;
    pc.deck.warnings.add(`chart-${noun}`, (n) => `${plural(n, noun)} ${n === 1 ? `is drawn as a ${as}` : `are drawn as ${as}s`}.`);
  }
  const grouping = child(groups[0]!, 'c:grouping')?.attrs.val;
  if (grouping === 'stacked' || grouping === 'percentStacked') pc.deck.warnings.add('chart-stacked', (n) => `${plural(n, 'stacked chart')} ${n === 1 ? 'is' : 'are'} drawn side by side.`);
  if (groups.length > 1) pc.deck.warnings.add('chart-combo', (n) => `${plural(n, 'chart')} of more than one kind kept only the first kind's series.`);

  let kind = info.kind;
  if (group.name === 'c:barChart' || group.name === 'c:bar3DChart') kind = child(group, 'c:barDir')?.attrs.val === 'bar' ? 'bar' : 'column';

  const sers = elements(group).filter((c) => c.name === 'c:ser').slice(0, MAX_SERIES);
  let categories: string[] = [];
  const series: ChartParts['series'] = [];
  sers.forEach((ser, i) => {
    const nameNode = data(child(ser, 'c:tx'));
    const name = nameNode ? (points(nameNode)[0] ?? (child(nameNode, 'c:v') ? textContent(child(nameNode, 'c:v')!) : '')) : '';
    const valNode = kind === 'scatter' ? child(ser, 'c:yVal') : child(ser, 'c:val');
    const values = numbers(points(data(valNode)));
    if (categories.length === 0) categories = points(data(child(ser, kind === 'scatter' ? 'c:xVal' : 'c:cat')));
    const color = seriesColor(ser, pc);
    series.push({ name: name.slice(0, 200) || `Series ${i + 1}`, values, ...(color !== undefined ? { color } : {}) });
  });
  if (series.length === 0) return null;
  const n = Math.max(categories.length, ...series.map((s) => s.values.length));
  if (categories.length < n) categories = categories.concat(Array.from({ length: n - categories.length }, (_, i) => String(categories.length + i + 1)));
  const out: ChartParts = { chart: kind, categories: categories.slice(0, MAX_POINTS), series: series.map((s) => ({ ...s, values: s.values.slice(0, MAX_POINTS) })) };
  const deleted = child(chart, 'c:autoTitleDeleted')?.attrs.val;
  const title = child(chart, 'c:title');
  if (title && deleted !== '1') {
    const text = descendants(title, 'a:t').map((t) => textContent(t)).join('').trim();
    if (text) out.title = text.slice(0, 200);
  }
  return out;
}
