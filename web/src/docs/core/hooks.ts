/**
 * Hooks for the parts of the core module that are React and need the editor.
 *
 * The page is ProseMirror's and React does not own it, so a panel that depends on the
 * selection or the text has to ask the editor to tell it, and has to do so without a
 * re-render per keystroke: updates are coalesced to one per frame, and a panel that is
 * closed does not subscribe at all.
 */

import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { Transaction } from '@tiptap/pm/state';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The editor's view, or null before it is mounted. Tiptap 3 hands out an editor before
 * its `EditorContent` has attached it, and then `editor.view.dom` throws, so anything that
 * reads the DOM from an effect asks here first.
 */
export const viewOf = (editor: Editor | null): EditorView | null => (editor && !editor.isDestroyed ? ((editor as unknown as { editorView: EditorView | null }).editorView ?? null) : null);

/**
 * The editor while it is mounted, and null before and after. Mounting is an effect of
 * `EditorContent`, and it can be undone and redone (a new extension list makes a new editor,
 * and a remount makes a new view), so this asks the editor each render rather than
 * remembering an answer; the editor's `mount` and `create` events are what make it render.
 */
export function useMountedEditor(editor: Editor | null): Editor | null {
  const [, again] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => again((n) => n + 1);
    editor.on('mount', bump);
    editor.on('create', bump);
    return () => {
      editor.off('mount', bump);
      editor.off('create', bump);
    };
  }, [editor]);
  return viewOf(editor) ? editor : null;
}

export interface TickOptions {
  /**
   * What a change to the text does: `frame` re-renders on the next frame, `later` waits for
   * typing to pause, `never` ignores it. Anything on screen while someone types should not be
   * `frame` unless it shows the text itself; a keystroke does not pay for a panel.
   */
  docs?: 'frame' | 'later' | 'never';
  /** A move of the caret, a change of what is selected, or the page gaining and losing focus. */
  selection?: boolean;
  /** A transaction that is none of those but is for this component: the find plugin's. */
  also?: (transaction: Transaction) => boolean;
}

/** A number that changes when the editor does, in the ways asked for. Read it to re-render. */
export function useEditorTick(editor: Editor | null, active = true, opts: TickOptions = {}): number {
  const [tick, setTick] = useState(0);
  const { docs = 'frame', selection = true, also } = opts;
  const alsoRef = useRef(also);
  alsoRef.current = also;

  useEffect(() => {
    if (!editor || !active) return;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((n) => n + 1);
      });
    };
    const onTx = ({ transaction }: { transaction: Transaction }) => {
      if (alsoRef.current?.(transaction)) return bump();
      if (transaction.docChanged) {
        if (docs === 'frame') bump();
        else if (docs === 'later') {
          clearTimeout(timer);
          timer = setTimeout(bump, 200);
        }
      } else if (selection && (transaction.selectionSet || transaction.storedMarksSet || transaction.getMeta('focus') || transaction.getMeta('blur'))) bump();
    };
    editor.on('transaction', onTx);
    return () => {
      editor.off('transaction', onTx);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [editor, active, docs, selection]);
  return tick;
}

/**
 * The element a panel is drawn into: the shell. It carries `data-app`, so the panel has
 * the app's colour, and the tokens (`--shell-top`) that place it. Outside a shell
 * (a test) it is the body.
 */
export function usePortalRoot(editor: Editor | null): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const view = viewOf(editor);
    if (!view) return setRoot(null);
    setRoot(view.dom.closest<HTMLElement>('.oa-shell') ?? document.body);
  }, [editor]);
  return root;
}

export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Where position `pos` (default: the start of the selection) is in the window, kept current. */
export function useCaretRect(editor: Editor | null, active: boolean, pos?: number | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const tick = useEditorTick(editor, active);

  useLayoutEffect(() => {
    if (!editor || !active || editor.isDestroyed) return setRect(null);
    try {
      const at = Math.min(Math.max(pos ?? editor.state.selection.from, 0), editor.state.doc.content.size);
      const c = editor.view.coordsAtPos(at);
      setRect((prev) => (prev && Math.abs(prev.top - c.top) < 0.5 && Math.abs(prev.left - c.left) < 0.5 && Math.abs(prev.bottom - c.bottom) < 0.5 ? prev : { top: c.top, left: c.left, bottom: c.bottom, right: c.right }));
    } catch {
      setRect(null);
    }
  }, [editor, active, pos, tick]);

  // The page scrolls under a panel and the window resizes: place it again.
  useEffect(() => {
    if (!editor || !active) return;
    let frame = 0;
    const again = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (editor.isDestroyed) return;
        try {
          const at = Math.min(Math.max(pos ?? editor.state.selection.from, 0), editor.state.doc.content.size);
          const c = editor.view.coordsAtPos(at);
          setRect({ top: c.top, left: c.left, bottom: c.bottom, right: c.right });
        } catch {
          // The position is gone; the next transaction places it.
        }
      });
    };
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
    return () => {
      window.removeEventListener('scroll', again, true);
      window.removeEventListener('resize', again);
      cancelAnimationFrame(frame);
    };
  }, [editor, active, pos]);

  return rect;
}

/**
 * Where a floating panel of `size` goes for an anchor at `rect`: under it, flush left,
 * kept inside the window, and above it when there is no room below.
 */
export function placeFloat(
  rect: Pick<Rect, 'top' | 'left' | 'bottom'>,
  size: { width: number; height: number },
  view: { width: number; height: number },
  { gap = 6, margin = 12 }: { gap?: number; margin?: number } = {}
): { top: number; left: number } {
  const left = Math.max(margin, Math.min(rect.left, view.width - size.width - margin));
  const below = rect.bottom + gap;
  const fitsBelow = below + size.height <= view.height - margin;
  const above = rect.top - gap - size.height;
  const top = fitsBelow || above < margin ? below : above;
  return { top: Math.max(margin, Math.min(top, view.height - size.height - margin)), left };
}
