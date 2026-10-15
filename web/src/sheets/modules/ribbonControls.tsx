/**
 * The ribbon controls the shell's own kinds cannot say: the size box, the borders panel, the cell
 * styles gallery, the conditional formatting menu and the format painter. Each is a `custom` item
 * (core/shell/types.ts), so each carries `data-rb-item` on what takes focus, which puts it in the
 * ribbon's arrow-key order, and each reads the workbook itself: a custom item is not in the ribbon's
 * cheap state refresh, so one that shows a value watches for it (`useWatch`) and re-renders only
 * when what it shows has changed.
 *
 * A press on any of them must not take the keyboard from the grid, or the selection the command is
 * about to act on is lost with it, so each button swallows its mouse-down as the shell's do.
 */

import { useEffect, useRef, useState } from 'react';
import { caretDownIcon, Icon } from '../../core/icons';
import { Popover } from '../../core/ui';
import { type StoredStyle } from '../model';
import { ColorInput } from '../panes/parts';
import { openTool } from '../panes/tools';
import {
  type BorderLine,
  type BorderPen,
  type BorderPreset,
  CELL_STYLES,
  activeStyle,
  applyBorders,
  applyCellStyle,
  clearFormats,
  lift,
  parseSize,
  setSize,
  sizeOf,
  stepSize
} from './formatActions';
import { BARS, SCALES, addBars, addQuick, addScale, clearRules } from './conditionalActions';
import { BORDER_ICONS, chartBarHorizontalIcon, paintBrushBroadIcon, swatchesIcon } from './formatIcons';
import { arm, disarm, usePainter } from './painter';
import { SIZES } from './palettes';
import type { SheetsContext } from './types';

const keepSelection = (e: React.MouseEvent): void => e.preventDefault();

/** One value read from the context, kept current as the workbook and the selection change. */
export function useWatch<T>(ctx: Pick<SheetsContext, 'model' | 'session'>, read: () => T): T {
  const [value, setValue] = useState(read);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setValue((prev) => {
          const next = latest.current();
          return Object.is(prev, next) ? prev : next;
        });
      });
    };
    check();
    const a = ctx.model.subscribe(check);
    const b = ctx.session.subscribe(check);
    return () => {
      a();
      b();
      cancelAnimationFrame(frame);
    };
  }, [ctx.model, ctx.session]);
  return value;
}

/** A popover's open state, and which edge of its button it hangs from: the right one where the left would run off the page. */
function useOpen(width = 260) {
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<'left' | 'right'>('left');
  return {
    open,
    align,
    setOpen,
    close: () => setOpen(false),
    toggle: (e: React.MouseEvent<HTMLElement>) => {
      setAlign(e.currentTarget.getBoundingClientRect().left + width > window.innerWidth - 8 ? 'right' : 'left');
      setOpen((v) => !v);
    }
  };
}

// ── the size box ────────────────────────────────────────────────────────────

export function SizeBox({ ctx }: { ctx: SheetsContext }) {
  const current = useWatch(ctx, () => sizeOf(ctx));
  const [draft, setDraft] = useState<string | null>(null);
  const o = useOpen();
  const input = useRef<HTMLInputElement>(null);
  const disabled = !ctx.can.edit;

  const apply = (n: number) => {
    setSize(ctx, n);
    setDraft(null);
  };
  const commit = () => {
    const n = draft === null ? null : parseSize(draft);
    if (n !== null && n !== current) apply(n);
    else setDraft(null);
  };

  return (
    <span className="oa-pop-wrap sx-sizebox">
      <input
        ref={input}
        data-rb-item
        data-id="home.size"
        aria-label="Font size"
        title="Font size"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft ?? String(current)}
        onFocus={(e) => {
          setDraft(String(current));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            ctx.actions.focusGrid();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
            ctx.actions.focusGrid();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const from = draft === null ? current : (parseSize(draft) ?? current);
            const next = stepSize(from, e.key === 'ArrowUp' ? 1 : -1, SIZES);
            // Applied now, and the field shows it: the sheet's own state arrives a frame later, and a
            // held arrow would otherwise step from the old size each time.
            setDraft(String(next));
            setSize(ctx, next);
            requestAnimationFrame(() => input.current?.select());
          }
        }}
      />
      <button
        type="button"
        className="sx-sizebox-caret"
        data-rb-item
        data-id="home.size.more"
        aria-label="Font sizes"
        aria-haspopup="listbox"
        aria-expanded={o.open}
        disabled={disabled}
        tabIndex={-1}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={caretDownIcon} size={10} />
      </button>
      <Popover open={o.open} onClose={o.close} role="presentation">
        <div role="listbox" aria-label="Font sizes" className="oa-rb-list" style={{ minWidth: 70 }}>
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={n === current}
              className="oa-menu-item"
              onMouseDown={keepSelection}
              onClick={() => {
                apply(n);
                o.close();
                ctx.actions.focusGrid();
              }}
            >
              <span className="oa-menu-label">{n}</span>
            </button>
          ))}
        </div>
      </Popover>
    </span>
  );
}

// ── borders ─────────────────────────────────────────────────────────────────

const PRESETS: { id: BorderPreset; label: string }[] = [
  { id: 'bottom', label: 'Bottom border' },
  { id: 'top', label: 'Top border' },
  { id: 'left', label: 'Left border' },
  { id: 'right', label: 'Right border' },
  { id: 'none', label: 'No border' },
  { id: 'all', label: 'All borders' },
  { id: 'outside', label: 'Outside borders' },
  { id: 'thick-outside', label: 'Thick outside borders' },
  { id: 'inside', label: 'Inside borders' },
  { id: 'inside-h', label: 'Inside horizontal borders' },
  { id: 'inside-v', label: 'Inside vertical borders' },
  { id: 'top-bottom', label: 'Top and bottom borders' },
  { id: 'bottom-double', label: 'Double bottom border' },
  { id: 'bottom-thick', label: 'Thick bottom border' }
];

const LINES: { line: BorderLine; label: string; css: string }[] = [
  { line: 'thin', label: 'Thin', css: 'solid' },
  { line: 'medium', label: 'Medium', css: 'solid' },
  { line: 'thick', label: 'Thick', css: 'solid' },
  { line: 'dashed', label: 'Dashed', css: 'dashed' },
  { line: 'dotted', label: 'Dotted', css: 'dotted' },
  { line: 'double', label: 'Double', css: 'double' }
];

const LINE_WIDTH: Record<BorderLine, number> = { thin: 1, medium: 2, thick: 3, dashed: 2, dotted: 2, double: 4 };

/** The pen is the person's for the visit: the line and colour they last chose, kept while the page is open. */
let pen: BorderPen = { line: 'thin' };

export function BordersButton({ ctx }: { ctx: SheetsContext }) {
  const o = useOpen(260);
  const [now, setNow] = useState<BorderPen>(pen);
  const choose = (next: BorderPen) => {
    pen = next;
    setNow(next);
  };
  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id="home.borders"
        className="oa-rb-tl"
        aria-label="Borders"
        title="Borders"
        aria-haspopup="dialog"
        aria-expanded={o.open}
        disabled={!ctx.can.edit}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={BORDER_ICONS.all} size={16} />
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} align={o.align} role="dialog" label="Borders" className="sx-pop-wide">
        <div className="sx-border-panel">
          <div className="sx-border-grid" role="group" aria-label="Where">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-label={p.label}
                title={p.label}
                onMouseDown={keepSelection}
                onClick={() => {
                  applyBorders(ctx, p.id, now);
                  o.close();
                  ctx.actions.focusGrid();
                }}
              >
                <Icon icon={BORDER_ICONS[p.id]} size={18} />
              </button>
            ))}
          </div>
          <div className="sx-pen" role="group" aria-label="Line">
            <div className="sx-pen-lines">
              {LINES.map((l) => (
                <button
                  key={l.line}
                  type="button"
                  className="sx-pen-line"
                  aria-pressed={now.line === l.line}
                  aria-label={l.label}
                  title={l.label}
                  onMouseDown={keepSelection}
                  onClick={() => choose({ ...now, line: l.line })}
                >
                  <i style={{ borderTopStyle: l.css as 'solid', borderTopWidth: LINE_WIDTH[l.line] }} />
                </button>
              ))}
            </div>
            <div className="sx-pen-colour">
              <ColorInput label="Line colour" value={now.color ?? '#292b31'} onChange={(hex) => choose({ ...now, color: hex })} />
              <span style={{ flex: 1 }}>Line colour</span>
              {now.color && (
                <button type="button" className="oa-menu-item" style={{ width: 'auto' }} onMouseDown={keepSelection} onClick={() => choose({ line: now.line })}>
                  Automatic
                </button>
              )}
            </div>
          </div>
        </div>
      </Popover>
    </span>
  );
}

// ── cell styles ─────────────────────────────────────────────────────────────

/** A named style as it looks: its fill, its text, its weight and its lines, on a button. */
function swatchStyle(s: StoredStyle): React.CSSProperties {
  const line = (b: StoredStyle['borderBottom']) => (b && b.line === 'double' ? `4px double ${b.color ?? 'currentColor'}` : b ? `${b.line === 'thin' ? 1 : b.line === 'medium' ? 2 : 3}px solid ${b.color ?? 'currentColor'}` : undefined);
  return {
    ...(s.fill ? { background: s.fill } : {}),
    ...(s.color ? { color: s.color } : {}),
    ...(s.bold ? { fontWeight: 700 } : {}),
    ...(s.italic ? { fontStyle: 'italic' } : {}),
    ...(s.size ? { fontSize: Math.min(15, Math.max(12, s.size)) } : {}),
    ...(line(s.borderBottom) ? { borderBottom: line(s.borderBottom) } : {}),
    ...(line(s.borderTop) ? { borderTop: line(s.borderTop) } : {})
  };
}

export function CellStylesButton({ ctx }: { ctx: SheetsContext }) {
  const o = useOpen(300);
  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id="home.cell-styles"
        className="oa-rb-tl"
        aria-label="Cell styles"
        title="Cell styles"
        aria-haspopup="dialog"
        aria-expanded={o.open}
        disabled={!ctx.can.edit}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={swatchesIcon} size={16} />
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} align={o.align} role="dialog" label="Cell styles" className="sx-pop-wide">
        <div className="sx-styles-grid">
          {CELL_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              style={swatchStyle(s.style)}
              onMouseDown={keepSelection}
              onClick={() => {
                applyCellStyle(ctx, s.id);
                o.close();
                ctx.actions.focusGrid();
              }}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            style={{ gridColumn: '1 / -1' }}
            onMouseDown={keepSelection}
            onClick={() => {
              clearFormats(ctx);
              o.close();
              ctx.actions.focusGrid();
            }}
          >
            Clear formats
          </button>
        </div>
      </Popover>
    </span>
  );
}

// ── conditional formatting ──────────────────────────────────────────────────

export function ConditionalButton({ ctx }: { ctx: SheetsContext }) {
  const o = useOpen(520);
  const go = (run: () => void) => () => {
    o.close();
    run();
    ctx.actions.focusGrid();
  };
  const ask = (run: () => void) => () => {
    o.close();
    run();
  };
  // A row of the menu. Plain rows give the keyboard back to the grid; those that open a dialog leave it to the dialog.
  const item = (label: string, run: () => void, dialog = false) => (
    <button key={label} type="button" role="menuitem" className="oa-menu-item" onMouseDown={keepSelection} onClick={dialog ? ask(run) : go(run)}>
      <span className="oa-menu-label">{label}</span>
    </button>
  );
  const when = (initial: Parameters<typeof openTool>[0]) => () => openTool(initial);
  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id="home.conditional"
        className="oa-rb-tl"
        aria-label="Conditional formatting"
        title="Conditional formatting"
        aria-haspopup="menu"
        aria-expanded={o.open}
        disabled={!ctx.can.edit}
        onMouseDown={keepSelection}
        onClick={o.toggle}
      >
        <Icon icon={chartBarHorizontalIcon} size={16} />
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={o.open} onClose={o.close} align={o.align} role="menu" label="Conditional formatting" className="sx-pop-wide">
        <div className="sx-cf-menu">
          <div className="sx-cf-col">
            <div className="sx-cf-head">Highlight cells</div>
            {item('Greater than…', when({ id: 'cf', initial: { kind: 'cell', op: 'gt', a: '' } }), true)}
            {item('Less than…', when({ id: 'cf', initial: { kind: 'cell', op: 'lt', a: '' } }), true)}
            {item('Between…', when({ id: 'cf', initial: { kind: 'cell', op: 'between', a: '', b: '' } }), true)}
            {item('Equal to…', when({ id: 'cf', initial: { kind: 'cell', op: 'eq', a: '' } }), true)}
            {item('Text that contains…', when({ id: 'cf', initial: { kind: 'text', op: 'contains', text: '' } }), true)}
            {item('Duplicate values', () => addQuick(ctx, { kind: 'duplicate' }))}

            <div className="sx-cf-head">Top and bottom</div>
            {item('Top 10 items…', when({ id: 'cf', initial: { kind: 'top', n: 10 } }), true)}
            {item('Bottom 10 items…', when({ id: 'cf', initial: { kind: 'top', n: 10, bottom: true } }), true)}
            {item('Above average', () => addQuick(ctx, { kind: 'average' }))}
            {item('Below average', () => addQuick(ctx, { kind: 'average', below: true }))}
          </div>

          <div className="sx-cf-col">
            <div className="sx-cf-head">Data bars</div>
            <div className="sx-cf-swatches" data-cols="5">
              {BARS.map((b) => (
                <button key={b.id} type="button" aria-label={`${b.label} data bars`} title={`${b.label} data bars`} style={{ background: `linear-gradient(90deg, ${b.color} 70%, transparent 70%)` }} onMouseDown={keepSelection} onClick={go(() => addBars(ctx, b))} />
              ))}
            </div>

            <div className="sx-cf-head">Colour scales</div>
            <div className="sx-cf-swatches">
              {SCALES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`${s.label} colour scale`}
                  title={`${s.label} colour scale`}
                  style={{ background: `linear-gradient(90deg, ${s.min}, ${s.mid ? `${s.mid}, ` : ''}${s.max})` }}
                  onMouseDown={keepSelection}
                  onClick={go(() => addScale(ctx, s))}
                />
              ))}
            </div>

            <div className="oa-menu-rule" />
            {item('More rules…', when({ id: 'cf' }), true)}
            {item('Clear rules from the selection', () => clearRules(ctx, 'selection'))}
            {item('Clear rules from the sheet', () => clearRules(ctx, 'sheet'))}
            {item('Manage rules', () => ctx.panes.open('cf-rules'))}
          </div>
        </div>
      </Popover>
    </span>
  );
}

// ── the format painter ──────────────────────────────────────────────────────

export function PainterButton({ ctx }: { ctx: SheetsContext }) {
  const armed = usePainter() !== null;
  return (
    <button
      type="button"
      data-rb-item
      data-id="home.painter"
      className="oa-rb-tb"
      aria-label="Format painter"
      title="Format painter"
      aria-pressed={armed}
      disabled={!ctx.can.edit}
      onMouseDown={keepSelection}
      onClick={() => {
        if (armed) disarm();
        else arm(lift(activeStyle(ctx)));
        ctx.actions.focusGrid();
      }}
    >
      <Icon icon={paintBrushBroadIcon} size={16} />
    </button>
  );
}
