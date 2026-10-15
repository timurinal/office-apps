/**
 * The ribbon controls the framework's own kinds cannot say: the size box, the table grid
 * and the picture button. Each is a `custom` item (core/shell/types.ts), so each carries
 * `data-rb-item` on what takes focus, which is what puts it in the ribbon's arrow-key
 * order, and each reads the editor itself: a custom item is not in the ribbon's cheap
 * state refresh, so a control that shows a value subscribes to the editor for it.
 */

import { useRef, useState } from 'react';
import { caretDownIcon, Icon, tableIcon } from '../../core/icons';
import { Popover } from '../../core/ui';
import type { DocsContext } from '../modules/types';
import { DEFAULT_SIZE, parseSize, SIZES, sizeNumber, stepSize } from './fonts';
import { useEditorTick } from './hooks';
import { imageSquareIcon } from './icons';
import { pickPictureFiles } from './images';
import { GRID, insertTable } from './tables';
import { setSize, sizeAt } from './text';

const label = (n: number): string => String(n);

export function FontSizeBox({ ctx }: { ctx: DocsContext }) {
  const editor = ctx.editor;
  useEditorTick(editor, true, { docs: 'later' });
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const disabled = !ctx.can.edit || !editor;
  const current = editor ? sizeNumber(sizeAt(editor)) : DEFAULT_SIZE;

  const apply = (n: number) => {
    if (editor) setSize(editor, n);
    setDraft(null);
  };
  const commit = () => {
    const n = draft === null ? null : parseSize(draft);
    if (n !== null) apply(n);
    else setDraft(null);
  };

  return (
    <span className="oa-pop-wrap oa-sizebox">
      <input
        ref={input}
        data-rb-item
        data-id="home.font.size"
        aria-label="Font size"
        title="Font size"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft ?? label(current)}
        onFocus={(e) => {
          setDraft(label(current));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            editor?.commands.focus();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
            editor?.commands.focus();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const from = draft === null ? current : (parseSize(draft) ?? current);
            const next = stepSize(from, e.key === 'ArrowUp' ? 1 : -1);
            // The size is applied now and the field keeps showing it: the editor's own state
            // reaches this component after typing pauses, and a held arrow key would step
            // from the old size each time.
            setDraft(label(next));
            if (editor) setSize(editor, next);
            requestAnimationFrame(() => input.current?.select());
          }
        }}
      />
      <button
        type="button"
        className="oa-sizebox-caret"
        data-rb-item
        data-id="home.font.size.more"
        aria-label="Font sizes"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={caretDownIcon} size={11} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} role="presentation">
        <div role="listbox" aria-label="Font sizes" className="oa-rb-list" style={{ minWidth: 70 }}>
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={n === current}
              className="oa-menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                apply(n);
                setOpen(false);
              }}
            >
              <span className="oa-menu-label">{label(n)}</span>
            </button>
          ))}
        </div>
      </Popover>
    </span>
  );
}

/** Insert > Table: a grid to sweep out, as Word has. */
export function TableButton({ ctx }: { ctx: DocsContext }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ rows: 3, cols: 3 });
  const disabled = !ctx.can.edit;

  const insert = (rows: number, cols: number) => {
    if (ctx.editor) insertTable(ctx.editor, rows, cols);
    setOpen(false);
  };
  const key = (e: React.KeyboardEvent) => {
    const step: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    const d = step[e.key];
    if (d) {
      e.preventDefault();
      setAt((p) => ({ rows: Math.min(GRID.rows, Math.max(1, p.rows + d[0])), cols: Math.min(GRID.cols, Math.max(1, p.cols + d[1])) }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      insert(at.rows, at.cols);
    }
  };

  return (
    <span className="oa-pop-wrap">
      <button
        type="button"
        data-rb-item
        data-id="insert.table"
        className="oa-rb-tl"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Table"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={tableIcon} size={16} />
        Table
        <Icon icon={caretDownIcon} size={11} className="oa-rb-cv" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} role="dialog" label="Insert table">
        <div
          className="oa-grid"
          tabIndex={0}
          ref={(el) => el && open && requestAnimationFrame(() => el.focus({ preventScroll: true }))}
          onKeyDown={key}
          aria-label="Choose the size of the table"
        >
          <div className="oa-grid-cells">
            {Array.from({ length: GRID.rows * GRID.cols }, (_, i) => {
              const r = Math.floor(i / GRID.cols) + 1;
              const c = (i % GRID.cols) + 1;
              return (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${r} rows by ${c} columns`}
                  className="oa-grid-cell"
                  data-on={r <= at.rows && c <= at.cols ? 'true' : undefined}
                  onMouseEnter={() => setAt({ rows: r, cols: c })}
                  onClick={() => insert(r, c)}
                />
              );
            })}
          </div>
          <div className="oa-grid-label" aria-live="polite">
            {at.cols} × {at.rows}
          </div>
        </div>
      </Popover>
    </span>
  );
}

export function PictureButton({ ctx }: { ctx: DocsContext }) {
  return (
    <button
      type="button"
      data-rb-item
      data-id="insert.picture"
      className="oa-rb-tl"
      title="Picture from a file"
      disabled={!ctx.can.edit || !ctx.editor}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => ctx.editor && pickPictureFiles(ctx.editor)}
    >
      <Icon icon={imageSquareIcon} size={16} />
      Picture
    </button>
  );
}
