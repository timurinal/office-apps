/**
 * The `@` picker's list, and the date editor a date chip opens.
 *
 * The list is a view of the store the suggestion plugin writes (picker.ts): the plugin
 * decides what is offered and handles the keys (arrows, Enter, Tab), and this draws it
 * under the `@`, grouped as People, Dates and Documents. Focus never leaves the page, so
 * typing carries on and narrows the list; the mouse chooses without taking focus either.
 */

import type { Editor } from '@tiptap/core';
import { useRef, useSyncExternalStore } from 'react';
import { Button } from '../../core/controls';
import { Icon, calendarBlankIcon, fileTextIcon, presentationChartIcon, tableIcon, userCircleIcon } from '../../core/icons';
import { useDismiss } from '../../core/ui';
import { pickerOf } from './chips';
import { isoDay, isIsoDay } from './chipText';
import { Float } from './Float';
import { useCaretRect, useEditorTick } from './hooks';
import { pickKey, SECTION, type PickItem } from './picker';
import { uiOf } from './ui';

const DOC_ICON = { docs: fileTextIcon, sheets: tableIcon, slides: presentationChartIcon } as const;

const glyph = (item: PickItem) => (item.kind === 'person' ? userCircleIcon : item.kind === 'date' ? calendarBlankIcon : DOC_ICON[item.docKind]);

export function PickerList({ editor, root }: { editor: Editor; root: HTMLElement | null }) {
  const store = pickerOf(editor);
  const s = useSyncExternalStore(store.subscribe, store.get);
  // The list is placed from the `@`, and the page scrolls under it.
  useEditorTick(editor, s.open, { selection: false });
  const rect = s.open ? (s.rect?.() ?? null) : null;

  let last: PickItem['kind'] | null = null;
  return (
    <Float root={root} rect={rect} open={s.open} role="listbox" label="Mention" className="oa-picker">
      {s.items.length === 0 && <div className="oa-picker-empty">{s.loading ? 'Searching' : 'Nothing matches that.'}</div>}
      {s.items.map((item, i) => {
        const head = item.kind !== last;
        last = item.kind;
        return (
          <div key={pickKey(item)}>
            {head && <div className="oa-picker-section">{SECTION[item.kind]}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === s.index}
              data-active={i === s.index ? 'true' : undefined}
              className="oa-picker-row"
              // A press must not take focus from the page, or the `@` is no longer being typed.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== s.index && store.set({ index: i })}
              onClick={() => s.choose(item)}
            >
              <Icon icon={glyph(item)} size={16} />
              <span className="oa-picker-title">{item.label}</span>
              {item.detail && <span className="oa-picker-detail">{item.detail}</span>}
            </button>
          </div>
        );
      })}
    </Float>
  );
}

/** Change a date chip's day. */
export function DateEditor({ editor, root, at }: { editor: Editor; root: HTMLElement | null; at: number }) {
  const panel = useRef<HTMLDivElement>(null);
  const node = editor.state.doc.nodeAt(at);
  const rect = useCaretRect(editor, true, at);
  const close = () => {
    uiOf(editor).set({ dateAt: null });
    editor.commands.focus();
  };
  useDismiss(true, panel, close);
  if (!node || node.type.name !== 'dateChip') return null;

  const set = (date: string) => {
    if (!isIsoDay(date)) return;
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(at, undefined, { ...node.attrs, date });
        return true;
      })
      .run();
  };

  return (
    <Float root={root} rect={rect} open role="dialog" label="Date" className="oa-datepop">
      <div ref={panel} style={{ display: 'contents' }}>
        <input
          type="date"
          aria-label="Date"
          autoFocus
          value={isIsoDay(node.attrs.date) ? (node.attrs.date as string) : ''}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close();
          }}
          style={{ height: 32, padding: '0 8px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--ctrl)', color: 'var(--fg-1)', font: 'inherit', fontSize: 13.5 }}
        />
        <Button size="sm" variant="secondary" onClick={() => set(isoDay())}>
          Today
        </Button>
      </div>
    </Float>
  );
}
