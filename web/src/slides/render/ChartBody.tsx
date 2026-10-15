/**
 * A slide's chart, drawn by Sheets' chart code from the chart's own data. Loaded on demand: it
 * brings Sheets' number formatting with it, and most decks have no chart.
 *
 * Sheets lays a chart out in CSS px for a grid at 100%; a slide is 1920 wide, so the chart is laid
 * out at a fraction of its size and scaled up, which puts its labels at about 16 pt. Series take
 * the theme's accents in order unless they name their own colour.
 */

import { useMemo } from 'react';
import { layoutChart, resolveInput } from '../../sheets/charts/layout';
import { ChartSvg } from '../../sheets/charts/render';
import type { ChartData } from '../../sheets/charts/types';
import { defaultMeasure } from '../../sheets/model/measure';
import type { ChartElement, ThemeJSON, ThemeSlot } from '../model/deck';
import { resolveColor } from '../model/color';

/** Slide px per chart px. */
const SCALE = 2.5;
const ACCENTS: ThemeSlot[] = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function chartData(el: ChartElement): ChartData {
  const labels = (Array.isArray(el.categories) ? el.categories : []).slice(0, 2000).map((c) => String(c ?? ''));
  const xs = labels.map((l) => (l.trim() === '' ? Number.NaN : Number(l)));
  const numeric = labels.length > 0 && xs.every((x) => Number.isFinite(x));
  const series = (Array.isArray(el.series) ? el.series : []).slice(0, 24).map((s) => ({
    name: String(s?.name ?? ''),
    values: labels.map((_, i) => finite(Array.isArray(s?.values) ? s.values[i] : null))
  }));
  return { labels, x: el.chart === 'scatter' && numeric ? xs : null, xDate: false, series, every: 1, total: labels.length };
}

export default function ChartBody({ el, theme }: { el: ChartElement; theme: ThemeJSON }) {
  const geom = useMemo(() => {
    const data = chartData(el);
    const n = el.chart === 'pie' ? data.labels.length : data.series.length;
    const colors = Array.from({ length: n }, (_, i) => {
      const own = el.chart === 'pie' ? null : resolveColor(el.series[i]?.color, theme);
      return own ?? resolveColor({ theme: ACCENTS[i % ACCENTS.length]! }, theme) ?? '';
    });
    const input = resolveInput({ type: el.chart, title: el.title, options: { colors } }, data);
    return layoutChart(input, { w: el.w / SCALE, h: el.h / SCALE }, defaultMeasure());
  }, [el, theme]);
  const k = Math.min(el.w / geom.w, el.h / geom.h);
  return (
    <div className="sl-chart" style={{ width: geom.w, height: geom.h, transform: `scale(${k})` }}>
      <ChartSvg geom={geom} />
    </div>
  );
}
