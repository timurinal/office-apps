/**
 * The chart pane: everything about the selected chart that is not its place on the sheet.
 *
 * Type, data range, series in rows or columns, title, legend, axis titles and limits, colours.
 * Each control is one model step: a switch or a choice at once, a text field when it is left or
 * Enter is pressed (a step for each keystroke would be a hundred undos), Escape putting the old text
 * back. A change is optimistic by being local: the model applies it, the store hears it and the card
 * draws it in the same frame, and the room is told afterwards.
 */

import { useEffect, useState } from 'react';
import { Button, Select, Switch, TextField } from '../../core/controls';
import { trashIcon } from '../../core/icons';
import type { SheetsContext } from '../modules/types';
import { deleteChart, parseRange, rangeText, setChartOptions, setData, setSeriesIn, setTitle, setType } from './edit';
import { effectiveLegend, isPie } from './layout';
import { SERIES_COLORS, cleanColor, colorFor } from './palette';
import { type ChartEntry, useChartStore } from './store';
import type { ChartType, LegendPosition } from './types';

const TYPES: { value: ChartType; label: string }[] = [
  { value: 'column', label: 'Column' },
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
  { value: 'doughnut', label: 'Doughnut' },
  { value: 'scatter', label: 'Scatter' }
];

const LEGENDS: { value: LegendPosition; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' }
];

type Ctx = Pick<SheetsContext, 'model' | 'sheetId' | 'can'>;

/** A text field that commits when it is left or Enter is pressed, and puts the old text back on Escape. */
export function CommitField({
  label,
  value,
  onCommit,
  placeholder,
  error,
  inputMode,
  disabled
}: {
  label: string;
  value: string;
  /** Answer an error message to keep the field open on it, or nothing. */
  onCommit: (text: string) => string | void;
  placeholder?: string;
  error?: string;
  inputMode?: 'decimal' | 'text';
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState('');
  // A change made elsewhere (undo, another person) shows, unless this field is being typed in.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft === value) return;
    const said = onCommit(draft);
    if (said) setProblem(said);
    else setProblem('');
  };

  return (
    <TextField
      label={label}
      value={draft}
      size="sm"
      disabled={disabled}
      {...(placeholder ? { placeholder } : {})}
      {...(inputMode ? { inputMode } : {})}
      {...(problem || error ? { error: problem || error } : {})}
      onChange={(e) => {
        setDraft(e.target.value);
        if (problem) setProblem('');
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
          setProblem('');
        }
      }}
    />
  );
}

/** A number field: empty is "automatic", which stores nothing. */
function NumberField({ label, value, onChange, disabled }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; disabled?: boolean }) {
  return (
    <CommitField
      label={label}
      value={value === undefined ? '' : String(value)}
      placeholder="Auto"
      inputMode="decimal"
      {...(disabled ? { disabled } : {})}
      onCommit={(text) => {
        const t = text.trim();
        if (t === '') return void onChange(undefined);
        const n = Number(t);
        if (!Number.isFinite(n)) return 'Enter a number.';
        onChange(n);
      }}
    />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="oac-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

function ColorRow({ name, index, entry, ctx }: { name: string; index: number; entry: ChartEntry; ctx: Ctx }) {
  const colors = entry.spec.options?.colors;
  const current = colorFor(index, colors);
  const [draft, setDraft] = useState<string | null>(null);
  const set = (color: string) => {
    const next = [...(colors ?? [])];
    while (next.length < index) next.push('');
    next[index] = color;
    setChartOptions(ctx.model, entry, { colors: next });
  };
  return (
    <div className="oac-color">
      <span title={name}>{name}</span>
      <div className="oac-swatches" role="group" aria-label={`Colour for ${name}`}>
        {SERIES_COLORS.map((c) => (
          <button key={c} type="button" className="oac-swatch" style={{ background: c }} aria-label={c} aria-pressed={current === c} disabled={!ctx.can.edit} onClick={() => set(c)} />
        ))}
        <input
          type="color"
          className="oac-custom"
          aria-label={`Custom colour for ${name}`}
          value={cleanColor(draft ?? current) ?? '#000000'}
          disabled={!ctx.can.edit}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft && draft !== current) set(draft);
            setDraft(null);
          }}
        />
      </div>
    </div>
  );
}

function Pane({ entry, ctx }: { entry: ChartEntry; ctx: Ctx }) {
  const { model, can } = ctx;
  const spec = entry.spec;
  const o = spec.options ?? {};
  const type = spec.type;
  const pie = isPie(type);
  const rows = (o.seriesIn ?? 'cols') === 'rows';
  const stackable = type === 'column' || type === 'bar' || type === 'area';
  const names = pie ? (entry.data?.labels ?? []) : (entry.data?.series.map((s) => s.name) ?? []);
  const legend = effectiveLegend(type, entry.data?.series.length ?? 0, o.legend);
  const set = (patch: Parameters<typeof setChartOptions>[2]) => setChartOptions(model, entry, patch);
  const hasCustom = (o.colors ?? []).some((c) => c !== '');

  return (
    <div className="oac-pane">
      <section className="oac-group" aria-label="Chart type">
        <Select label="Chart type" size="sm" value={type} options={TYPES} disabled={!can.edit} onChange={(v) => setType(model, entry, v as ChartType)} />
        {stackable && (
          <Row label="Stacked">
            <Switch label="Stacked" checked={o.stacked === true} disabled={!can.edit} onChange={(on) => set({ stacked: on ? true : undefined })} />
          </Row>
        )}
      </section>

      <section className="oac-group" aria-label="Data">
        <h3>Data</h3>
        <CommitField
          label="Data range"
          value={rangeText(model, entry)}
          disabled={!can.edit}
          onCommit={(text) => {
            const parsed = parseRange(model, entry, text);
            if (!parsed) return 'That is not a range in this spreadsheet.';
            setData(model, entry, parsed.sheet, parsed.data);
          }}
        />
        <Select
          label="Series in"
          size="sm"
          value={rows ? 'rows' : 'cols'}
          options={[
            { value: 'cols', label: 'Columns' },
            { value: 'rows', label: 'Rows' }
          ]}
          disabled={!can.edit}
          onChange={(v) => setSeriesIn(model, entry, v as 'cols' | 'rows')}
        />
        <Row label={rows ? 'First column is headers' : 'First row is headers'}>
          <Switch label="Headers" checked={o.headers ?? true} disabled={!can.edit} onChange={(on) => set({ headers: on })} />
        </Row>
        <Row label={rows ? 'First row is labels' : 'First column is labels'}>
          <Switch label="Labels" checked={o.labels ?? true} disabled={!can.edit} onChange={(on) => set({ labels: on })} />
        </Row>
      </section>

      <section className="oac-group" aria-label="Title and legend">
        <h3>Title and legend</h3>
        <CommitField label="Title" value={spec.title ?? ''} disabled={!can.edit} onCommit={(t) => void setTitle(model, entry, t)} />
        <Select label="Legend" size="sm" value={legend} options={LEGENDS} disabled={!can.edit} onChange={(v) => set({ legend: v as LegendPosition })} />
      </section>

      {!pie && (
        <section className="oac-group" aria-label="Axes">
          <h3>Axes</h3>
          <CommitField label="Horizontal axis title" value={o.xTitle ?? ''} disabled={!can.edit} onCommit={(t) => void set({ xTitle: t.trim() })} />
          <CommitField label="Vertical axis title" value={o.yTitle ?? ''} disabled={!can.edit} onCommit={(t) => void set({ yTitle: t.trim() })} />
          <div className="oac-pair">
            <NumberField label={type === 'bar' ? 'Minimum' : 'Vertical minimum'} value={o.yMin} disabled={!can.edit} onChange={(v) => set({ yMin: v })} />
            <NumberField label={type === 'bar' ? 'Maximum' : 'Vertical maximum'} value={o.yMax} disabled={!can.edit} onChange={(v) => set({ yMax: v })} />
          </div>
          {(type === 'scatter' || entry.data?.xDate) && (
            <div className="oac-pair">
              <NumberField label="Horizontal minimum" value={o.xMin} disabled={!can.edit} onChange={(v) => set({ xMin: v })} />
              <NumberField label="Horizontal maximum" value={o.xMax} disabled={!can.edit} onChange={(v) => set({ xMax: v })} />
            </div>
          )}
        </section>
      )}

      <section className="oac-group" aria-label="Colours">
        <h3>{pie ? 'Slice colours' : 'Series colours'}</h3>
        <div className="oac-colors">
          {names.slice(0, 24).map((name, i) => (
            <ColorRow key={i} name={name} index={i} entry={entry} ctx={ctx} />
          ))}
        </div>
        {hasCustom && can.edit && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => set({ colors: undefined })}>
              Reset colours
            </Button>
          </div>
        )}
      </section>

      {can.edit && (
        <section className="oac-group" aria-label="Delete">
          <Button variant="danger" size="sm" icon={trashIcon} onClick={() => deleteChart(model, entry)}>
            Delete chart
          </Button>
        </section>
      )}
    </div>
  );
}

export function ChartPane({ ctx }: { ctx: Ctx }) {
  const store = useChartStore(ctx.model);
  const entry = store.selected ? store.get(store.selected) : undefined;
  if (!entry || entry.host !== ctx.sheetId) return <div className="oac-pane-empty">Select a chart.</div>;
  return <Pane key={entry.id} entry={entry} ctx={ctx} />;
}
