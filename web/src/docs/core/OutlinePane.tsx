/**
 * The outline pane: the document's headings, for finding your place and jumping.
 *
 * Re-read when typing pauses (a pass over the document's blocks, not between keystrokes),
 * and the section the caret is in is marked as the caret moves. A click puts the caret at
 * the heading and scrolls it to just under the banner (core.css's `scroll-margin-top`),
 * smoothly unless the reader asked for less movement.
 */

import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';
import { motionOff } from '../../motion';
import { outlineOf, sectionAt, type OutlineItem } from './outline';

function useOutline(editor: Editor | null): { items: OutlineItem[]; at: number } {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [at, setAt] = useState(-1);
  const latest = useRef<OutlineItem[]>([]);

  useEffect(() => {
    if (!editor) return;
    const read = () => {
      if (editor.isDestroyed) return;
      const next = outlineOf(editor.state.doc);
      latest.current = next;
      setItems(next);
      setAt(sectionAt(next, editor.state.selection.from));
    };
    read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 250);
    };
    // The section follows the caret at once, from the list as last read; the list itself
    // waits, so an arrow key does not walk the document.
    const moved = () => setAt(sectionAt(latest.current, editor.state.selection.from));
    editor.on('update', later);
    editor.on('selectionUpdate', moved);
    return () => {
      editor.off('update', later);
      editor.off('selectionUpdate', moved);
      clearTimeout(timer);
    };
  }, [editor]);

  return { items, at };
}

export function jumpTo(editor: Editor, pos: number): void {
  editor.chain().focus().setTextSelection(pos).run();
  const dom = editor.view.nodeDOM(Math.max(0, pos - 1));
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: motionOff() ? 'auto' : 'smooth' });
}

export function OutlinePane({ editor }: { editor: Editor | null }) {
  const { items, at } = useOutline(editor);
  if (!editor) return null;
  if (items.length === 0) return <div className="oa-outline-empty">Add a heading to see it here.</div>;
  return (
    <nav className="oa-outline" aria-label="Headings">
      {items.map((it, i) => (
        <button
          key={`${it.pos}-${it.text}`}
          type="button"
          className="oa-outline-row"
          data-level={it.level}
          aria-current={i === at ? 'true' : undefined}
          style={{ paddingLeft: 10 + (it.level - 1) * 14 }}
          title={it.text}
          onClick={() => jumpTo(editor, it.pos)}
        >
          {it.text}
        </button>
      ))}
    </nav>
  );
}
