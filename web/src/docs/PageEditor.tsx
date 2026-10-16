/**
 * The page and the editor on it.
 *
 * One component for the ways a Docs body is shown, which differ only in the
 * extensions they are given (docs/extensions.ts) and so in where the Yjs document
 * comes from:
 *
 *   live      the room's document, with carets coming in
 *   local     a document the host opened from a file: no provider, no carets
 *   locked    a document opened from ciphertext in this tab, likewise
 *   preview   a version's state in a throwaway document, read-only
 */

import { useEffect, useMemo } from 'react';
import type { AnyExtension, Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { usePageColour } from './pageColour';
import './doc.css';

/**
 * How far the floating banner and footer (core/shell) cover the top and bottom of the
 * scrolling stage. ProseMirror keeps a caret inside the scrollable box, and under glass
 * the box's edge is not where the page stops being visible, so a caret moved up to the
 * first lines would be scrolled to just under the banner and be hidden by it.
 *
 * The banner's height changes (collapsed ribbon, wrapped on a phone), so the numbers are
 * read when ProseMirror asks, from the property the shell keeps current. Without a shell
 * (a test, a bare page) they are zero and ProseMirror behaves as usual.
 */
export function chromeInsets(shell: HTMLElement | null): { top: number; bottom: number } {
  const top = Number.parseFloat(shell?.style.getPropertyValue('--shell-top') ?? '');
  return Number.isFinite(top) ? { top, bottom: 56 } : { top: 0, bottom: 0 };
}
const insets = () => chromeInsets(document.querySelector<HTMLElement>('.oa-shell'));
// `top` and `bottom` are read as properties each time: ProseMirror takes a number or an object.
const clearOfChrome = (breathing: number) => ({
  get top() {
    const t = insets().top;
    return t ? t + breathing : 0;
  },
  get bottom() {
    const b = insets().bottom;
    return b ? b + breathing : 0;
  },
  left: 0,
  right: 0
});

export function PageEditor({
  extensions,
  editable,
  restricted = false,
  hint = false,
  onEditor
}: {
  /** From `documentExtensions`. A new list makes a new editor, so memoise it. */
  extensions: AnyExtension[];
  editable: boolean;
  /** Readers who may not copy: the page does not hand out its text. */
  restricted?: boolean;
  /** Show "Start typing" on an empty page. */
  hint?: boolean;
  onEditor?: (editor: Editor | null) => void;
}) {
  const editor = useEditor(
    {
      extensions,
      editable,
      editorProps: {
        attributes: { 'aria-label': 'Document', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
        // A caret is brought into view only when it is under the chrome, and then to just clear of it.
        scrollThreshold: clearOfChrome(0),
        scrollMargin: clearOfChrome(24),
        handleDOMEvents: {
          copy: (_view, e) => (restricted ? (e.preventDefault(), true) : false),
          cut: (_view, e) => (restricted ? (e.preventDefault(), true) : false),
          dragstart: (_view, e) => (restricted ? (e.preventDefault(), true) : false)
        }
      }
    },
    [extensions]
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  const empty = useEditorState({ editor, selector: ({ editor: e }) => (e ? e.isEmpty : false) });

  const classes = useMemo(() => `oa-doc${restricted ? ' oa-no-download' : ''}`, [restricted]);

  return (
    <div className={classes} style={{ position: 'relative' }}>
      {hint && editable && empty && <span aria-hidden="true" className="oa-doc-hint">Start typing</span>}
      <EditorContent editor={editor} />
    </div>
  );
}

/** The sheet of paper the editor sits on, centred on the desk. `--page-zoom` is the
 *  shell's zoom slider. `data-page` is the reader's page colour, resolved (docs/pageColour.ts). */
export function Page({ children }: { children: React.ReactNode }) {
  const { tone } = usePageColour();
  return (
    <article className="oa-paper" data-doc-page="true" data-page={tone}>
      {children}
    </article>
  );
}
