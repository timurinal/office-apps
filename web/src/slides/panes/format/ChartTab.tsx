/**
 * A chart's own options: its kind, its title, and its data.
 *
 * The data is a small grid: categories down the side (an x value for a scatter), a column per series
 * with its name above it, and a number in each cell. A cell commits when Enter is pressed or it is
 * left, as a number field does (a step for every keystroke of "4.25" would be four undo entries), and
 * what is not a number says so in place and writes nothing. A row or a series is added or removed
 * with its own button. Each change writes the chart's `categories` and `series` whole, in one step, so
 * the chart redraws for the other person at once; two people editing different cells of one chart at
 * the same moment leave the later one's, as they would a title.
 */

import { useState } from 'react';
import { plusIcon, trashIcon, Icon } from '../../../core/icons';
import { CHART_NAMES, CHART_KINDS } from '../../modules/insert/defaults';
import type { ChartElement } from '../../model/deck';
import type { PaneEnv } from './env';
import { CommitText, Dropdown, Row } from './fields';

/** The most a chart's data grid has: more is a chart nobody reads, and a pane nobody can scroll. */
export const MAX_ROWS = 50;
export const MAX_SERIES = 12;

type Data = Pick<ChartElement, 'categories' | 'series'>;

/** A cell's text as a number: a comma for a point is allowed, and nothing is zero. Null when it is not one. */
export function parseCell(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return 0;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// The data edits are plain functions of the data, so each is tested without a pane.

export const withCategory = (d: Data, row: number, text: string): Data => ({ ...d, categories: d.categories.map((c, i) => (i === row ? text : c)) });

export const withValue = (d: Data, series: number, row: number, value: number): Data => ({
  ...d,
  series: d.series.map((s, si) => (si === series ? { ...s, values: s.values.map((v, i) => (i === row ? value : v)) } : s))
});

export const withSeriesName = (d: Data, series: number, name: string): Data => ({ ...d, series: d.series.map((s, i) => (i === series ? { ...s, name } : s)) });

/** A row at the end: an x one past the last for a scatter, else `Item n`, with a zero in every series. */
export function withRowAdded(d: Data, scatter: boolean): Data {
  const last = Number(d.categories[d.categories.length - 1]);
  const label = scatter && Number.isFinite(last) ? String(Math.round((last + 1) * 1000) / 1000) : `Item ${d.categories.length + 1}`;
  return { categories: [...d.categories, label], series: d.series.map((s) => ({ ...s, values: [...s.values, 0] })) };
}

export const withRowRemoved = (d: Data, row: number): Data => ({
  categories: d.categories.filter((_, i) => i !== row),
  series: d.series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== row) }))
});

export const withSeriesAdded = (d: Data): Data => ({ ...d, series: [...d.series, { name: `Series ${d.series.length + 1}`, values: d.categories.map(() => 0) }] });

export const withSeriesRemoved = (d: Data, series: number): Data => ({ ...d, series: d.series.filter((_, i) => i !== series) });

/** A cell that keeps what is typed until it is left or Enter is pressed. */
function Cell({ label, value, onCommit, numeric }: { label: string; value: string; onCommit: (text: string) => string | void; numeric?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const done = () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text === value) return;
    setBad(!!onCommit(text));
  };
  return (
    <input
      type="text"
      className="sl-fp-cell"
      aria-label={label}
      aria-invalid={bad || undefined}
      inputMode={numeric ? 'decimal' : 'text'}
      autoComplete="off"
      spellCheck={false}
      value={draft ?? value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          done();
        } else if (e.key === 'Escape' && draft !== null) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(null);
          setBad(false);
        }
      }}
    />
  );
}

function DataGrid({ chart, env }: { chart: ChartElement; env: PaneEnv }) {
  const { write, edit } = env;
  const data: Data = { categories: chart.categories, series: chart.series };
  const scatter = chart.chart === 'scatter';
  const pie = chart.chart === 'pie';
  const put = (next: Data) => write([{ id: chart.id!, patch: next }]);
  return (
    <div className="sl-fp-data-wrap">
      <table className="sl-fp-data">
        <thead>
          <tr>
            <th scope="col">{scatter ? 'X' : 'Category'}</th>
            {chart.series.map((s, si) => (
              <th key={si} scope="col">
                <div className="sl-fp-th">
                  <Cell label={`Series ${si + 1} name`} value={s.name} onCommit={(t) => void put(withSeriesName(data, si, t))} />
                  {edit && chart.series.length > 1 && (
                    <button type="button" className="sl-fp-x" aria-label={`Remove series ${si + 1}`} title="Remove series" onClick={() => put(withSeriesRemoved(data, si))}>
                      <Icon icon={trashIcon} size={12} />
                    </button>
                  )}
                </div>
              </th>
            ))}
            <td />
          </tr>
        </thead>
        <tbody>
          {chart.categories.map((c, ri) => (
            <tr key={ri}>
              <th scope="row">
                <Cell label={`${scatter ? 'X value' : 'Category'} ${ri + 1}`} value={c} onCommit={(t) => void put(withCategory(data, ri, t))} />
              </th>
              {chart.series.map((s, si) => (
                <td key={si}>
                  <Cell
                    label={`${s.name || `Series ${si + 1}`}, ${c || `row ${ri + 1}`}`}
                    numeric
                    value={String(s.values[ri] ?? 0)}
                    onCommit={(t) => {
                      const n = parseCell(t);
                      if (n === null) return 'Enter a number.';
                      put(withValue(data, si, ri, n));
                    }}
                  />
                </td>
              ))}
              <td>
                {edit && chart.categories.length > 1 && (
                  <button type="button" className="sl-fp-x" aria-label={`Remove row ${ri + 1}`} title="Remove row" onClick={() => put(withRowRemoved(data, ri))}>
                    <Icon icon={trashIcon} size={12} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <div className="sl-fp-data-add">
          <button type="button" disabled={chart.categories.length >= MAX_ROWS} onClick={() => put(withRowAdded(data, scatter))}>
            <Icon icon={plusIcon} size={12} />
            Add row
          </button>
          {!pie && (
            <button type="button" disabled={chart.series.length >= MAX_SERIES} onClick={() => put(withSeriesAdded(data))}>
              <Icon icon={plusIcon} size={12} />
              Add series
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ChartTab({ env }: { env: PaneEnv }) {
  const { els, write, edit } = env;
  const charts = els.filter((e): e is ChartElement => e.type === 'chart');
  if (!charts.length) return null;
  const kind = charts.every((c) => c.chart === charts[0]!.chart) ? charts[0]!.chart : null;
  const title = charts.every((c) => (c.title ?? '') === (charts[0]!.title ?? '')) ? (charts[0]!.title ?? '') : null;
  return (
    <div className="sl-fp-group">
      <Row label="Type">
        <Dropdown
          label="Chart type"
          value={kind}
          options={CHART_KINDS.map((k) => ({ value: k, label: CHART_NAMES[k] }))}
          disabled={!edit}
          onChange={(v) => write(charts.map((c) => ({ id: c.id!, patch: { chart: v as ChartElement['chart'] } })))}
        />
      </Row>
      <CommitText label="Chart title" value={title} placeholder="Chart title" disabled={!edit} onCommit={(t) => write(charts.map((c) => ({ id: c.id!, patch: { title: t.trim() ? t : null } })))} />
      {charts.length === 1 ? <DataGrid chart={charts[0]!} env={env} /> : <p className="sl-fp-hint">Choose one chart to edit its data.</p>}
    </div>
  );
}
