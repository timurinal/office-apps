/**
 * Data validation for the selected cells: what is allowed, a message that shows before anything is
 * typed, and what happens to a value that is not allowed (refused, or kept with a warning).
 *
 * The form holds text as it was typed; `draftFrom` turns it into the model's rule or says what is
 * wrong, so the dialog never writes a rule the model would have to repair.
 */

import { useState } from 'react';
import { Button, Select, Switch, TextField } from '../../core/controls';
import { Modal, useModalClose } from '../../core/ui';
import { type Comparison, type ValidationCheck, toIdRect } from '../model';
import { COMPARISONS, showFormula, storeFormula } from '../modules/conditionalActions';
import {
  type ValidationDraft,
  applyValidation,
  clearValidation,
  parseDateInput,
  parseItems,
  parseSource,
  showDate,
  showSource,
  validationAt
} from '../modules/dataActions';
import { Fields, Footer, type ToolProps } from './parts';

type Allow = 'any' | 'list' | 'number' | 'integer' | 'date' | 'textLength' | 'formula';

const ALLOW: { value: Allow; label: string }[] = [
  { value: 'any', label: 'Any value' },
  { value: 'list', label: 'List' },
  { value: 'integer', label: 'Whole number' },
  { value: 'number', label: 'Decimal' },
  { value: 'date', label: 'Date' },
  { value: 'textLength', label: 'Text length' },
  { value: 'formula', label: 'Custom formula' }
];

interface Form {
  allow: Allow;
  op: Comparison;
  a: string;
  b: string;
  listMode: 'items' | 'range';
  items: string;
  source: string;
  formula: string;
  allowBlank: boolean;
  strict: boolean;
  message: string;
  promptTitle: string;
  promptText: string;
}

const BLANK: Form = {
  allow: 'list',
  op: 'between',
  a: '',
  b: '',
  listMode: 'items',
  items: '',
  source: '',
  formula: '',
  allowBlank: true,
  strict: true,
  message: '',
  promptTitle: '',
  promptText: ''
};

const num = (n: number | undefined): string => (n === undefined ? '' : String(n));

function formFor(ctx: ToolProps['ctx']): Form {
  const hit = validationAt(ctx, ctx.selection().active);
  if (!hit) return BLANK;
  const { rule } = hit;
  const f: Form = {
    ...BLANK,
    allowBlank: rule.allowBlank !== false,
    strict: rule.strict === true,
    message: rule.message ?? '',
    promptTitle: rule.prompt?.title ?? '',
    promptText: rule.prompt?.text ?? ''
  };
  const c = rule.check;
  switch (c.kind) {
    case 'list':
      return { ...f, allow: 'list', items: c.items.join(', ') };
    case 'listRange':
      return { ...f, allow: 'list', listMode: 'range', source: showSource(ctx, c) };
    case 'formula':
      return { ...f, allow: 'formula', formula: showFormula(ctx, c.f) };
    case 'date':
      return { ...f, allow: 'date', op: c.op, a: showDate(c.a), b: c.b === undefined ? '' : showDate(c.b) };
    default:
      return { ...f, allow: c.kind, op: c.op, a: num(c.a), b: num(c.b) };
  }
}

const isRange = (op: Comparison) => op === 'between' || op === 'notBetween';

/** The rule the form describes, or what to tell the person. */
function draftFrom(ctx: ToolProps['ctx'], f: Form): { draft: ValidationDraft } | { error: string } {
  let check: ValidationCheck;
  switch (f.allow) {
    case 'any':
      return { error: '' };
    case 'list': {
      if (f.listMode === 'items') {
        const items = parseItems(f.items);
        if (items.length === 0) return { error: 'Type at least one item.' };
        check = { kind: 'list', items };
      } else {
        const src = parseSource(ctx, f.source);
        const sheet = src ? ctx.model.engine.sheet(src.sheet) : undefined;
        const range = src && sheet ? toIdRect(sheet, src.rect) : null;
        if (!src || !range) return { error: 'That is not a range in this spreadsheet.' };
        check = { kind: 'listRange', sheet: src.sheet, range };
      }
      break;
    }
    case 'formula': {
      const r = storeFormula(ctx, f.formula);
      if (!r.ok) return { error: r.message };
      check = { kind: 'formula', f: r.f };
      break;
    }
    default: {
      const read = (text: string): number | null => {
        if (f.allow === 'date') return parseDateInput(ctx, text);
        const n = Number(text.trim().replace(',', '.'));
        return text.trim() !== '' && Number.isFinite(n) ? n : null;
      };
      const a = read(f.a);
      const b = isRange(f.op) ? read(f.b) : undefined;
      const what = f.allow === 'date' ? 'a date' : 'a number';
      if (a === null) return { error: `Type ${what}${isRange(f.op) ? ' for the minimum' : ''}.` };
      if (b === null) return { error: `Type ${what} for the maximum.` };
      if (f.allow === 'textLength' && (a < 0 || !Number.isInteger(a) || (b !== undefined && (b < 0 || !Number.isInteger(b))))) return { error: 'A length is a whole number.' };
      check = { kind: f.allow, op: f.op, a, ...(b === undefined ? {} : { b }) };
    }
  }
  return {
    draft: {
      check,
      strict: f.strict,
      allowBlank: f.allowBlank,
      ...(f.message.trim() ? { message: f.message.trim() } : {}),
      ...(f.promptTitle.trim() || f.promptText.trim() ? { prompt: { ...(f.promptTitle.trim() ? { title: f.promptTitle.trim() } : {}), text: f.promptText.trim() } } : {})
    }
  };
}

function ClearAll({ onClear }: { onClear: () => void }) {
  const close = useModalClose();
  return (
    <Button
      variant="ghost"
      onClick={() => {
        onClear();
        close();
      }}
    >
      Clear all
    </Button>
  );
}

export default function ValidationDialog({ ctx, onClose }: ToolProps) {
  const [rect] = useState(() => ctx.selection().rect);
  const [f, setF] = useState<Form>(() => formFor(ctx));
  const [shownError, setShownError] = useState('');
  const set = (patch: Partial<Form>) => {
    setF((p) => ({ ...p, ...patch }));
    setShownError('');
  };

  const apply = (): boolean => {
    if (f.allow === 'any') {
      clearValidation(ctx, [rect]);
      return true;
    }
    const r = draftFrom(ctx, f);
    if ('error' in r) {
      setShownError(r.error);
      return false;
    }
    applyValidation(ctx, [rect], r.draft);
    return true;
  };

  const between = isRange(f.op);

  return (
    <Modal
      title="Data validation"
      width={520}
      onClose={onClose}
      footer={<Footer form="sx-valid" apply="Apply" onApply={apply} start={<ClearAll onClear={() => clearValidation(ctx, [rect])} />} />}
    >
      <form id="sx-valid" className="sx-stack" onSubmit={(e) => e.preventDefault()}>
        <Select label="Allow" value={f.allow} options={ALLOW} onChange={(v) => set({ allow: v as Allow })} />

        {f.allow === 'list' && (
          <>
            <Select
              label="Choices come from"
              value={f.listMode}
              options={[
                { value: 'items', label: 'Items typed here' },
                { value: 'range', label: 'A range of cells' }
              ]}
              onChange={(v) => set({ listMode: v as Form['listMode'] })}
            />
            {f.listMode === 'items' ? (
              <TextField label="Items" value={f.items} placeholder="Yes, No, Maybe" autoFocus onChange={(e) => set({ items: e.target.value })} />
            ) : (
              <TextField label="Range" value={f.source} placeholder="=Lists!$A$1:$A$10" onChange={(e) => set({ source: e.target.value })} />
            )}
          </>
        )}

        {(f.allow === 'number' || f.allow === 'integer' || f.allow === 'date' || f.allow === 'textLength') && (
          <>
            <Select label="Data" value={f.op} options={COMPARISONS.map((c) => ({ value: c.op, label: c.label }))} onChange={(v) => set({ op: v as Comparison })} />
            <Fields>
              <TextField label={between ? 'Minimum' : 'Value'} value={f.a} placeholder={f.allow === 'date' ? '01/01/2026' : ''} onChange={(e) => set({ a: e.target.value })} />
              {between && <TextField label="Maximum" value={f.b} placeholder={f.allow === 'date' ? '31/12/2026' : ''} onChange={(e) => set({ b: e.target.value })} />}
            </Fields>
          </>
        )}

        {f.allow === 'formula' && <TextField label="Formula" value={f.formula} placeholder="=COUNTIF($A:$A, A1)=1" hint="Written for the first selected cell." onChange={(e) => set({ formula: e.target.value })} />}

        {f.allow !== 'any' && (
          <>
            <div className="sx-switch-row">
              <Switch checked={f.allowBlank} onChange={(v) => set({ allowBlank: v })} label="Allow an empty cell" />
              Allow an empty cell
            </div>

            <div className="sx-rule" />
            <h3 className="sx-heading">Message while typing</h3>
            <TextField label="Title" size="sm" value={f.promptTitle} maxLength={32} onChange={(e) => set({ promptTitle: e.target.value })} />
            <TextField label="Message" multiline rows={2} value={f.promptText} maxLength={255} onChange={(e) => set({ promptText: e.target.value })} />

            <div className="sx-rule" />
            <h3 className="sx-heading">When a value is not allowed</h3>
            <Select
              label="Then"
              value={f.strict ? 'stop' : 'warn'}
              options={[
                { value: 'stop', label: 'Refuse it' },
                { value: 'warn', label: 'Keep it and warn' }
              ]}
              onChange={(v) => set({ strict: v === 'stop' })}
            />
            <TextField label="Message" size="sm" value={f.message} maxLength={255} placeholder="That value is not allowed in this cell." onChange={(e) => set({ message: e.target.value })} />
          </>
        )}

        {shownError && (
          <p className="sx-note" data-tone="danger" role="alert">
            {shownError}
          </p>
        )}
      </form>
    </Modal>
  );
}
