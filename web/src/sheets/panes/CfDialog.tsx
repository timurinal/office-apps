/**
 * A conditional-format rule: what to look for, where, and how to show it. The same dialog adds a rule
 * (the menu opens it on the kind the person chose) and edits one from the rules pane.
 *
 * The form holds what was typed; `draftFrom` turns it into the model's `CfRule` parts or says what
 * is wrong, so a rule that would never match anything is never written.
 */

import { useState } from 'react';
import { Select, Switch, TextField } from '../../core/controls';
import { Modal } from '../../core/ui';
import { parseAddress, rectAddress } from '../grid/a1';
import type { Rect } from '../grid/types';
import { parseValue } from '../engine';
import type { CfCondition, CfStyle, Comparison } from '../model';
import {
  COMPARISONS,
  DEFAULT_LOOK,
  LOOKS,
  addRule,
  rangesText,
  rulesOf,
  showFormula,
  storeFormula,
  updateRule
} from '../modules/conditionalActions';
import { Check, Fields, Footer, Labelled, ColorInput, type ToolProps } from './parts';

type Type = 'cell' | 'text' | 'dup' | 'top' | 'average' | 'blank' | 'formula' | 'scale' | 'bar';

const TYPES: { value: Type; label: string }[] = [
  { value: 'cell', label: 'Cell value' },
  { value: 'text', label: 'Text' },
  { value: 'dup', label: 'Duplicate or unique values' },
  { value: 'top', label: 'Top or bottom' },
  { value: 'average', label: 'Above or below average' },
  { value: 'blank', label: 'Blanks and errors' },
  { value: 'formula', label: 'Custom formula' },
  { value: 'scale', label: 'Colour scale' },
  { value: 'bar', label: 'Data bars' }
];

interface Custom {
  fill: string | null;
  color: string | null;
  bold: boolean;
  italic: boolean;
  strike: boolean;
}

interface Form {
  type: Type;
  op: Comparison;
  a: string;
  b: string;
  textOp: 'contains' | 'notContains' | 'begins' | 'ends';
  text: string;
  dup: 'duplicate' | 'unique';
  topKind: 'top' | 'bottom';
  n: string;
  percent: boolean;
  avg: 'above' | 'below';
  blank: 'blank' | 'notBlank' | 'error' | 'notError';
  formula: string;
  look: string;
  custom: Custom;
  three: boolean;
  min: string;
  mid: string;
  max: string;
  bar: string;
  ranges: string;
  stop: boolean;
}

const BLANK: Omit<Form, 'ranges'> = {
  type: 'cell',
  op: 'gt',
  a: '',
  b: '',
  textOp: 'contains',
  text: '',
  dup: 'duplicate',
  topKind: 'top',
  n: '10',
  percent: false,
  avg: 'above',
  blank: 'blank',
  formula: '',
  look: LOOKS[0]!.id,
  custom: { fill: '#ffeb9c', color: null, bold: false, italic: false, strike: false },
  three: true,
  min: '#63be7b',
  mid: '#ffeb84',
  max: '#f8696b',
  bar: '#638ec6',
  stop: false
};

const typed = (v: number | string | undefined): string => (v === undefined ? '' : String(v));

/** What a condition says, as form fields. */
function fromCondition(ctx: ToolProps['ctx'], w: CfCondition): Partial<Form> {
  switch (w.kind) {
    case 'cell':
      return { type: 'cell', op: w.op, a: typed(w.a), b: typed(w.b) };
    case 'text':
      return { type: 'text', textOp: w.op, text: w.text };
    case 'duplicate':
    case 'unique':
      return { type: 'dup', dup: w.kind };
    case 'top':
      return { type: 'top', topKind: w.bottom ? 'bottom' : 'top', n: String(w.n), percent: !!w.percent };
    case 'average':
      return { type: 'average', avg: w.below ? 'below' : 'above' };
    case 'blank':
    case 'notBlank':
    case 'error':
    case 'notError':
      return { type: 'blank', blank: w.kind };
    case 'formula':
      return { type: 'formula', formula: showFormula(ctx, w.f) };
    case 'scale':
      return { type: 'scale', three: w.mid !== undefined, min: w.min, mid: w.mid ?? BLANK.mid, max: w.max };
    case 'bar':
      return { type: 'bar', bar: w.color };
  }
}

function lookFor(style: CfStyle): Pick<Form, 'look' | 'custom'> {
  const preset = LOOKS.find((l) => JSON.stringify(l.style) === JSON.stringify(style));
  return {
    look: preset ? preset.id : 'custom',
    custom: { fill: style.fill ?? null, color: style.color ?? null, bold: !!style.bold, italic: !!style.italic, strike: !!style.strike }
  };
}

function initialForm(ctx: ToolProps['ctx'], initial: CfCondition | undefined, ruleId: string | undefined): Form {
  const sel = ctx.selection().rect;
  const base: Form = { ...BLANK, ranges: rectAddress(sel) };
  const rule = ruleId ? rulesOf(ctx).find((r) => r.id === ruleId) : undefined;
  if (rule) {
    return { ...base, ...fromCondition(ctx, rule.rule.when), ...lookFor(rule.rule.style), ranges: rangesText(rule.rects), stop: !!rule.rule.stop };
  }
  return { ...base, ...(initial ? fromCondition(ctx, initial) : {}) };
}

/** A typed operand: a number (a date or a percent too) where it reads as one, else the text itself. */
function operand(ctx: ToolProps['ctx'], text: string): number | string {
  const t = text.trim();
  const v = parseValue(t, ctx.model.engine.dateOrder).content?.v;
  return typeof v === 'number' ? v : t;
}

const isRange = (op: Comparison) => op === 'between' || op === 'notBetween';

function styleOf(f: Form): CfStyle {
  if (f.look !== 'custom') return LOOKS.find((l) => l.id === f.look)?.style ?? DEFAULT_LOOK;
  const c = f.custom;
  return {
    ...(c.fill ? { fill: c.fill } : {}),
    ...(c.color ? { color: c.color } : {}),
    ...(c.bold ? { bold: true } : {}),
    ...(c.italic ? { italic: true } : {}),
    ...(c.strike ? { strike: true } : {})
  };
}

function draftFrom(ctx: ToolProps['ctx'], f: Form): { rects: Rect[]; when: CfCondition; style: CfStyle; stop: boolean } | { error: string } {
  const rects: Rect[] = [];
  for (const part of f.ranges.split(',')) {
    if (!part.trim()) continue;
    const r = parseAddress(part, ctx.data.rowCount(), ctx.data.colCount());
    if (!r) return { error: `${part.trim()} is not a range on this sheet.` };
    rects.push(r);
  }
  if (rects.length === 0) return { error: 'Type the cells the rule covers.' };

  let when: CfCondition;
  switch (f.type) {
    case 'cell':
      if (f.a.trim() === '') return { error: 'Type a value to compare with.' };
      if (isRange(f.op) && f.b.trim() === '') return { error: 'Type the second value.' };
      when = { kind: 'cell', op: f.op, a: operand(ctx, f.a), ...(isRange(f.op) ? { b: operand(ctx, f.b) } : {}) };
      break;
    case 'text':
      if (f.text === '') return { error: 'Type the text to look for.' };
      when = { kind: 'text', op: f.textOp, text: f.text };
      break;
    case 'dup':
      when = { kind: f.dup };
      break;
    case 'top': {
      const n = Number(f.n);
      if (!Number.isInteger(n) || n < 1 || n > (f.percent ? 100 : 1_000_000)) return { error: f.percent ? 'Type a percentage from 1 to 100.' : 'Type a whole number of 1 or more.' };
      when = { kind: 'top', n, ...(f.percent ? { percent: true } : {}), ...(f.topKind === 'bottom' ? { bottom: true } : {}) };
      break;
    }
    case 'average':
      when = f.avg === 'below' ? { kind: 'average', below: true } : { kind: 'average' };
      break;
    case 'blank':
      when = { kind: f.blank };
      break;
    case 'formula': {
      const r = storeFormula(ctx, f.formula);
      if (!r.ok) return { error: r.message };
      when = { kind: 'formula', f: r.f };
      break;
    }
    case 'scale':
      when = { kind: 'scale', min: f.min, ...(f.three ? { mid: f.mid } : {}), max: f.max };
      break;
    case 'bar':
      when = { kind: 'bar', color: f.bar, negative: f.bar === '#f8696b' ? '#638ec6' : '#f8696b' };
      break;
  }
  return { rects, when, style: f.type === 'scale' || f.type === 'bar' ? {} : styleOf(f), stop: f.stop };
}

export default function CfDialog({ ctx, onClose, initial, ruleId }: ToolProps & { initial?: CfCondition; ruleId?: string }) {
  const [f, setF] = useState<Form>(() => initialForm(ctx, initial, ruleId));
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => {
    setF((p) => ({ ...p, ...patch }));
    setError('');
  };
  const setCustom = (patch: Partial<Custom>) => set({ look: 'custom', custom: { ...f.custom, ...patch } });

  const apply = (): boolean => {
    const r = draftFrom(ctx, f);
    if ('error' in r) {
      setError(r.error);
      return false;
    }
    const draft = { rects: r.rects, when: r.when, style: r.style, ...(r.stop ? { stop: true } : {}) };
    if (ruleId) updateRule(ctx, ruleId, draft);
    else addRule(ctx, draft);
    // The pane that lists the rules is where a rule is looked at again.
    ctx.panes.open('cf-rules');
    return true;
  };

  const style = styleOf(f);
  const showsLook = f.type !== 'scale' && f.type !== 'bar';

  return (
    <Modal
      title={ruleId ? 'Edit formatting rule' : 'New formatting rule'}
      width={520}
      onClose={onClose}
      footer={<Footer form="sx-cf" apply={ruleId ? 'Save' : 'Add rule'} onApply={apply} />}
    >
      <form id="sx-cf" className="sx-stack" onSubmit={(e) => e.preventDefault()}>
        <Select label="Format cells with" value={f.type} options={TYPES} onChange={(v) => set({ type: v as Type })} />

        {f.type === 'cell' && (
          <>
            <Select label="Cell value is" value={f.op} options={COMPARISONS.map((c) => ({ value: c.op, label: c.label }))} onChange={(v) => set({ op: v as Comparison })} />
            <Fields>
              <TextField label={isRange(f.op) ? 'From' : 'Value'} value={f.a} autoFocus onChange={(e) => set({ a: e.target.value })} />
              {isRange(f.op) && <TextField label="To" value={f.b} onChange={(e) => set({ b: e.target.value })} />}
            </Fields>
          </>
        )}

        {f.type === 'text' && (
          <Fields>
            <Select
              label="Text"
              value={f.textOp}
              options={[
                { value: 'contains', label: 'contains' },
                { value: 'notContains', label: 'does not contain' },
                { value: 'begins', label: 'begins with' },
                { value: 'ends', label: 'ends with' }
              ]}
              onChange={(v) => set({ textOp: v as Form['textOp'] })}
              style={{ width: 170, flex: 'none' }}
            />
            <TextField label="Text to look for" value={f.text} autoFocus onChange={(e) => set({ text: e.target.value })} style={{ flex: 1 }} />
          </Fields>
        )}

        {f.type === 'dup' && (
          <Select
            label="Highlight"
            value={f.dup}
            options={[
              { value: 'duplicate', label: 'Duplicate values' },
              { value: 'unique', label: 'Unique values' }
            ]}
            onChange={(v) => set({ dup: v as Form['dup'] })}
          />
        )}

        {f.type === 'top' && (
          <Fields>
            <Select
              label="Highlight"
              value={f.topKind}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' }
              ]}
              onChange={(v) => set({ topKind: v as Form['topKind'] })}
            />
            <TextField label="How many" inputMode="numeric" value={f.n} autoFocus onChange={(e) => set({ n: e.target.value })} style={{ width: 90 }} />
            <Select
              label="Counting"
              value={f.percent ? 'percent' : 'items'}
              options={[
                { value: 'items', label: 'Items' },
                { value: 'percent', label: 'Percent' }
              ]}
              onChange={(v) => set({ percent: v === 'percent' })}
            />
          </Fields>
        )}

        {f.type === 'average' && (
          <Select
            label="Highlight values"
            value={f.avg}
            options={[
              { value: 'above', label: 'Above the average' },
              { value: 'below', label: 'Below the average' }
            ]}
            onChange={(v) => set({ avg: v as Form['avg'] })}
          />
        )}

        {f.type === 'blank' && (
          <Select
            label="Highlight cells that are"
            value={f.blank}
            options={[
              { value: 'blank', label: 'Blank' },
              { value: 'notBlank', label: 'Not blank' },
              { value: 'error', label: 'An error' },
              { value: 'notError', label: 'Not an error' }
            ]}
            onChange={(v) => set({ blank: v as Form['blank'] })}
          />
        )}

        {f.type === 'formula' && <TextField label="Formula" value={f.formula} placeholder="=B2>C2" hint="Written for the first cell of the range, and copied down and across it." onChange={(e) => set({ formula: e.target.value })} />}

        {f.type === 'scale' && (
          <>
            <div className="sx-switch-row">
              <Switch checked={f.three} onChange={(v) => set({ three: v })} label="Use a middle colour" />
              Use a middle colour
            </div>
            <div className="sx-fields" style={{ alignItems: 'flex-end' }}>
              <Labelled label="Lowest">
                <ColorInput label="Colour of the lowest value" value={f.min} onChange={(v) => set({ min: v })} />
              </Labelled>
              {f.three && (
                <Labelled label="Middle">
                  <ColorInput label="Colour of the middle value" value={f.mid} onChange={(v) => set({ mid: v })} />
                </Labelled>
              )}
              <Labelled label="Highest">
                <ColorInput label="Colour of the highest value" value={f.max} onChange={(v) => set({ max: v })} />
              </Labelled>
              <span
                className="sx-sample"
                aria-hidden="true"
                style={{ flex: 1, background: `linear-gradient(90deg, ${f.min}, ${f.three ? `${f.mid}, ` : ''}${f.max})` }}
              />
            </div>
          </>
        )}

        {f.type === 'bar' && (
          <div className="sx-fields" style={{ alignItems: 'flex-end' }}>
            <Labelled label="Bar colour">
              <ColorInput label="Bar colour" value={f.bar} onChange={(v) => set({ bar: v })} />
            </Labelled>
            <span className="sx-sample" aria-hidden="true" style={{ flex: 1, justifyContent: 'flex-start', padding: 0 }}>
              <span style={{ width: '62%', height: 18, marginLeft: 4, background: f.bar, borderRadius: 2 }} />
            </span>
          </div>
        )}

        <TextField label="Applies to" value={f.ranges} placeholder="B2:B20, D2:D20" onChange={(e) => set({ ranges: e.target.value })} />

        {showsLook && (
          <>
            <div className="sx-rule" />
            <Fields>
              <Select
                label="Format"
                value={f.look}
                options={[...LOOKS.map((l) => ({ value: l.id, label: l.label })), { value: 'custom', label: 'Custom' }]}
                onChange={(v) => set({ look: v })}
                style={{ flex: 1 }}
              />
              <Labelled label="Preview">
                <span
                  className="sx-sample"
                  style={{
                    ...(style.fill ? { background: style.fill } : {}),
                    ...(style.color ? { color: style.color } : {}),
                    fontWeight: style.bold ? 600 : 400,
                    fontStyle: style.italic ? 'italic' : 'normal',
                    textDecoration: style.strike ? 'line-through' : 'none'
                  }}
                >
                  AaBbCc
                </span>
              </Labelled>
            </Fields>
            {f.look === 'custom' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', alignItems: 'center' }}>
                <Check checked={f.custom.fill !== null} onChange={(on) => setCustom({ fill: on ? '#ffeb9c' : null })}>
                  Fill
                </Check>
                {f.custom.fill !== null && <ColorInput label="Fill colour" value={f.custom.fill} onChange={(v) => setCustom({ fill: v })} />}
                <Check checked={f.custom.color !== null} onChange={(on) => setCustom({ color: on ? '#9c0006' : null })}>
                  Text colour
                </Check>
                {f.custom.color !== null && <ColorInput label="Text colour" value={f.custom.color} onChange={(v) => setCustom({ color: v })} />}
                <Check checked={f.custom.bold} onChange={(on) => setCustom({ bold: on })}>
                  Bold
                </Check>
                <Check checked={f.custom.italic} onChange={(on) => setCustom({ italic: on })}>
                  Italic
                </Check>
                <Check checked={f.custom.strike} onChange={(on) => setCustom({ strike: on })}>
                  Strikethrough
                </Check>
              </div>
            )}
          </>
        )}

        <Check checked={f.stop} onChange={(on) => set({ stop: on })}>
          Stop when this rule applies
        </Check>

        {error && (
          <p className="sx-note" data-tone="danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
