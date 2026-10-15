/**
 * Fill and line, and Effects: what a shape, a line or a picture is drawn with.
 *
 * Fill is for shapes (a group's shapes included): none, a solid colour from the theme with its
 * transparency, or a two-colour gradient at an angle. Line is for shapes, lines and pictures: its
 * colour, width in points, dash, and, for a line, the heads at its two ends. A colour is a theme
 * slot, so a theme change recolours it. Effects: a shape's shadow and a rounded rectangle's corner.
 *
 * Every control reads across the whole selection and changes each chosen element in one step.
 */

import { ROUND_RECT_DEFAULT } from '../../render/geometry';
import type { Fill, Line } from '../../model/deck';
import { ColorPicker } from './ColorPicker';
import {
  cornerPatches,
  fillOfKind,
  fillPatches,

  linePatches,
  readFillKind,
  readGradient,
  readLine,
  readShadow,
  readSolid,
  shadowPatches,
  shapesOf,
  strokablesOf,
  withAlpha,
  withAngle,
  withColor,
  withStop,
  type FillKind
} from './edits';
import type { PaneEnv } from './env';
import { Check, NumField, Dropdown, Row, Seg } from './fields';
import { formatDegrees, formatPercent, formatPt, parseDegrees, parsePercent, parsePt } from './units';

const KINDS: { value: Exclude<FillKind, 'image'>; label: string }[] = [
  { value: 'none', label: 'No fill' },
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' }
];

const DASHES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dash', label: 'Dash' },
  { value: 'dot', label: 'Dots' },
  { value: 'dashDot', label: 'Dash and dot' }
];

const HEADS = [
  { value: 'none', label: 'None' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'oval', label: 'Oval' }
];

export function FillSection({ env }: { env: PaneEnv }) {
  const { els, theme, write, edit } = env;
  const shapes = shapesOf(els);
  if (!shapes.length) return null;
  const kind = readFillKind(shapes);
  const solid = readSolid(shapes);
  const grad = readGradient(shapes);
  const change = (f: (fill: Fill) => Fill) => write(fillPatches(shapes, f));
  return (
    <div className="sl-fp-group">
      <Seg
        label="Fill"
        value={kind && kind.value !== 'image' ? kind.value : null}
        options={KINDS}
        disabled={!edit}
        onChange={(k) => change((f) => fillOfKind(k, f))}
      />
      {kind?.value === 'solid' && (
        <>
          <Row label="Colour">
            <ColorPicker label="Fill colour" value={solid.color?.value ?? null} empty="Mixed" theme={theme} disabled={!edit} onPick={(c) => change((f) => withColor(f, c))} />
          </Row>
          <Row label="Transparency">
            <NumField
              label="Fill transparency"
              value={solid.alpha ? 1 - solid.alpha.value : null}
              format={formatPercent}
              parse={parsePercent}
              step={0.05}
              min={0}
              max={1}
              disabled={!edit}
              onCommit={(t) => change((f) => withAlpha(f, 1 - t))}
            />
          </Row>
        </>
      )}
      {kind?.value === 'gradient' && (
        <>
          <Row label="Start">
            <ColorPicker label="Gradient start colour" value={grad.start?.value ?? null} empty="Mixed" theme={theme} disabled={!edit} onPick={(c) => change((f) => withStop(f, 0, c))} />
          </Row>
          <Row label="End">
            <ColorPicker label="Gradient end colour" value={grad.end?.value ?? null} empty="Mixed" theme={theme} disabled={!edit} onPick={(c) => change((f) => withStop(f, 1, c))} />
          </Row>
          <Row label="Angle">
            <NumField label="Gradient angle" value={grad.angle?.value ?? null} format={formatDegrees} parse={parseDegrees} step={15} min={0} max={359.99} disabled={!edit} onCommit={(a) => change((f) => withAngle(f, a))} />
          </Row>
        </>
      )}
    </div>
  );
}

export function LineSection({ env }: { env: PaneEnv }) {
  const { els, theme, write, edit } = env;
  const strokes = strokablesOf(els);
  if (!strokes.length) return null;
  const hasLine = strokes.some((e) => e.type === 'line');
  const only = strokes.every((e) => e.type === 'line');
  const width = readLine(els, 'width', 0);
  const color = readLine(els, 'color', { theme: 'accent1' } as Line['color']);
  const dash = readLine(els, 'dash', 'solid');
  const head = readLine(els, 'head', 'none');
  const tail = readLine(els, 'tail', 'none');
  const set = (change: Partial<Line>) => write(linePatches(els, change));
  return (
    <div className="sl-fp-group">
      <Row label="Colour">
        <ColorPicker label="Line colour" value={color?.value ?? null} empty="Mixed" theme={theme} disabled={!edit} onPick={(c) => set({ color: c })} />
      </Row>
      <Row label="Width">
        <NumField label="Line width" value={width?.value ?? null} format={formatPt} parse={parsePt} step={0.5} min={0} max={200} disabled={!edit} onCommit={(px) => set({ width: px })} />
      </Row>
      <Row label="Dash">
        <Dropdown label="Line dash" value={dash?.value ?? null} options={DASHES} disabled={!edit} onChange={(v) => set({ dash: v as Line['dash'] })} />
      </Row>
      {hasLine && only && (
        <>
          <Row label="Start">
            <Dropdown label="Line start" value={head?.value ?? null} options={HEADS} disabled={!edit} onChange={(v) => set({ head: v as Line['head'] })} />
          </Row>
          <Row label="End">
            <Dropdown label="Line end" value={tail?.value ?? null} options={HEADS} disabled={!edit} onChange={(v) => set({ tail: v as Line['tail'] })} />
          </Row>
        </>
      )}
    </div>
  );
}

export function EffectsTab({ env }: { env: PaneEnv }) {
  const { els, write, edit } = env;
  const shapes = shapesOf(els);
  const rounded = shapes.filter((s) => s.shape === 'roundRect');
  const corner = rounded.length
    ? (() => {
        const v = new Set(rounded.map((s) => Math.round((s.adjust ?? ROUND_RECT_DEFAULT) * 10000)));
        return v.size === 1 ? [...v][0]! / 10000 : null;
      })()
    : null;
  return (
    <div className="sl-fp-group">
      <Check label="Shadow" value={readShadow(shapes)?.value ?? null} disabled={!edit} onChange={(on) => write(shadowPatches(shapes, on))} />
      {rounded.length > 0 && (
        <Row label="Corner radius">
          <NumField
            label="Corner radius"
            value={corner}
            format={(n) => formatPercent(n * 2)}
            parse={(t) => {
              const f = parsePercent(t);
              return f === null ? null : f / 2;
            }}
            step={0.025}
            min={0}
            max={0.5}
            disabled={!edit}
            onCommit={(f) => write(cornerPatches(shapes, f))}
          />
        </Row>
      )}
    </div>
  );
}

