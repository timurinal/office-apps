/**
 * More number formats: a category, its options, and the format code itself, which can be typed. The
 * code is the one thing the dialog holds, and everything else is read from it and writes to it, so a
 * code typed by hand and one made from the options are the same thing.
 */

import { useState } from 'react';
import { Select, TextField } from '../../core/controls';
import { Modal } from '../../core/ui';
import { formatValue } from '../engine';
import { activeStyle, setNumberFormat } from '../modules/formatActions';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  FORMATS,
  type FormatId,
  accountingCode,
  categoryOf,
  currencyCode,
  currencyOf,
  decimalsOf,
  hasThousands
} from '../modules/numfmt';
import { Check, Footer, Labelled, type ToolProps } from './parts';

const DATES = ['dd/mm/yyyy', 'dd/mm/yy', 'd mmm yyyy', 'd mmmm yyyy', 'dddd, d mmmm yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'mmm yy', 'dd/mm/yyyy hh:mm'];
const TIMES = ['hh:mm', 'hh:mm:ss', 'h:mm AM/PM', 'h:mm:ss AM/PM', '[h]:mm:ss'];
const FRACTIONS = ['# ?/?', '# ??/??', '# ?/2', '# ?/4', '# ?/8', '# ?/10', '# ?/16'];

const places = (n: number) => (n > 0 ? `.${'0'.repeat(n)}` : '');

/** The code a category starts as, in the options a person already had. */
function codeFor(id: FormatId, current: string): string {
  const d = decimalsOf(current) ?? 2;
  const sym = currencyOf(current) ?? DEFAULT_CURRENCY;
  switch (id) {
    case 'general':
      return 'General';
    case 'number':
      return `${hasThousands(current) ? '#,##0' : '0'}${places(d)}`;
    case 'currency':
      return currencyCode(sym, d);
    case 'accounting':
      return accountingCode(sym, d);
    case 'percent':
      return `0${places(d)}%`;
    case 'scientific':
      return `0${places(d)}E+00`;
    default:
      return FORMATS.find((f) => f.id === id)?.code(sym) ?? current;
  }
}

export default function NumberFormatDialog({ ctx, onClose }: ToolProps) {
  const style = activeStyle(ctx);
  const [code, setCode] = useState(style.numFmt ?? 'General');
  const id = categoryOf(code);
  const { active } = ctx.selection();
  const value = ctx.data.cell(active.row, active.col)?.value;
  const sample = typeof value === 'number' ? value : 1234.5678;
  const shown = (() => {
    try {
      return formatValue(sample, code).text;
    } catch {
      return '';
    }
  })();
  const decimals = decimalsOf(code) ?? 0;
  const sym = currencyOf(code) ?? DEFAULT_CURRENCY;
  const rebuild = (patch: { decimals?: number; thousands?: boolean; symbol?: string }) => {
    const d = patch.decimals ?? decimals;
    const s = patch.symbol ?? sym;
    if (id === 'currency') setCode(currencyCode(s, d));
    else if (id === 'accounting') setCode(accountingCode(s, d));
    else if (id === 'number') setCode(`${(patch.thousands ?? hasThousands(code)) ? '#,##0' : '0'}${places(d)}`);
    else if (id === 'percent') setCode(`0${places(d)}%`);
    else if (id === 'scientific') setCode(`0${places(d)}E+00`);
  };

  const withDecimals = id === 'number' || id === 'currency' || id === 'accounting' || id === 'percent' || id === 'scientific';
  const presets = id === 'date-short' || id === 'date-long' ? DATES : id === 'time' ? TIMES : id === 'fraction' ? FRACTIONS : null;

  return (
    <Modal
      title="Number format"
      width={560}
      onClose={onClose}
      footer={<Footer form="sx-numfmt" apply="Apply" onApply={() => setNumberFormat(ctx, code.trim() || 'General')} />}
    >
      <form id="sx-numfmt" className="sx-stack" onSubmit={(e) => e.preventDefault()}>
        <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 16 }}>
          <div className="sx-list" role="listbox" aria-label="Categories" style={{ maxHeight: 280 }}>
            {[...FORMATS, { id: 'custom' as FormatId, label: 'Custom', code: () => code }].map((f) => (
              <button
                key={f.id}
                type="button"
                role="option"
                className="sx-list-row"
                aria-selected={id === f.id}
                onClick={() => f.id !== 'custom' && setCode(codeFor(f.id, code))}
              >
                <span className="sx-grow">{f.label}</span>
              </button>
            ))}
          </div>
          <div className="sx-stack">
            <Labelled label="Sample">
              <span className="sx-sample" style={{ justifyContent: 'flex-start', minHeight: 34 }} aria-live="polite">
                {shown}
              </span>
            </Labelled>
            {withDecimals && (
              <TextField
                label="Decimal places"
                size="sm"
                inputMode="numeric"
                value={String(decimals)}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, '').slice(0, 1));
                  rebuild({ decimals: Number.isFinite(n) ? n : 0 });
                }}
                style={{ width: 120 }}
              />
            )}
            {(id === 'currency' || id === 'accounting') && (
              <Select label="Symbol" size="sm" value={sym} options={CURRENCIES.map((c) => ({ value: c.symbol, label: `${c.symbol}  ${c.name}` }))} onChange={(v) => rebuild({ symbol: v })} />
            )}
            {id === 'number' && (
              <Check checked={hasThousands(code)} onChange={(on) => rebuild({ thousands: on })}>
                Separate thousands
              </Check>
            )}
            {presets && (
              <Select label="Type" size="sm" value={presets.includes(code) ? code : ''} options={[...(presets.includes(code) ? [] : [{ value: '', label: 'Custom' }]), ...presets.map((p) => ({ value: p, label: formatValue(sample, p).text || p }))]} onChange={(v) => v && setCode(v)} />
            )}
            <TextField label="Format code" size="sm" value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)} style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12.5 }} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
