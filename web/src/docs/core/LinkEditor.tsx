/**
 * The link editor and the card that shows a link: both popovers at the caret.
 *
 * **The editor** opens on Ctrl+K in the page and from Insert > Link. It has the text, when
 * there is no selection to take it from, and the address; Apply links, Remove takes the
 * link off. The address is cleaned and checked (docs/links.ts `normaliseLink`, then
 * `isSafeHref`) and an address that is not a web or mail address is refused where it
 * was typed, with the field's own error.
 *
 * **The card** is what Docs shows when the caret is inside a link: the address, and Open,
 * Edit and Remove. It is out of the way while typing (a keystroke hides it, and a move of
 * the caret shows it again) and not drawn for a reader, whose links open on a click.
 */

import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, TextField } from '../../core/controls';
import { arrowSquareOutIcon, linkBreakIcon, pencilSimpleIcon } from '../../core/icons';
import { useDismiss } from '../../core/ui';
import { Float } from './Float';
import { useCaretRect, useEditorTick } from './hooks';
import { applyLink, linkAt, removeLink } from './links';
import { uiOf } from './ui';

export function LinkEditor({ editor, root }: { editor: Editor; root: HTMLElement | null }) {
  const initial = useMemo(() => {
    const at = linkAt(editor);
    const sel = editor.state.selection;
    return {
      href: at?.href ?? '',
      text: at ? at.text : sel.empty ? '' : editor.state.doc.textBetween(sel.from, sel.to, ' '),
      hasLink: at !== null,
      // With text selected the link takes it; the text is only asked for when there is none.
      askText: at !== null || sel.empty
    };
  }, [editor]);
  const [href, setHref] = useState(initial.href);
  const [text, setText] = useState(initial.text);
  const [error, setError] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const rect = useCaretRect(editor, true, linkAt(editor)?.from);

  const close = () => {
    uiOf(editor).set({ link: false });
    editor.commands.focus();
  };
  useDismiss(true, panel, close);

  const apply = () => {
    if (!applyLink(editor, href, initial.askText ? text : undefined)) {
      setError('Enter a web or email address.');
      return;
    }
    close();
  };

  return (
    <Float root={root} rect={rect} open role="dialog" label="Link" className="oa-linked">
      <div ref={panel}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          {initial.askText && <TextField label="Text" size="sm" value={text} placeholder="Text to show" onChange={(e) => setText(e.target.value)} />}
          <TextField
            label="Address"
            size="sm"
            autoFocus
            value={href}
            placeholder="Paste or type an address"
            error={error || undefined}
            onChange={(e) => {
              setHref(e.target.value);
              setError('');
            }}
          />
          <div className="oa-linked-actions">
            {initial.hasLink && (
              <Button
                size="sm"
                variant="ghost"
                icon={linkBreakIcon}
                onClick={() => {
                  removeLink(editor);
                  uiOf(editor).set({ link: false });
                }}
              >
                Remove link
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit">
              Apply
            </Button>
          </div>
        </form>
      </div>
    </Float>
  );
}

/** The card under a link the caret is in. */
export function LinkCard({ editor, root }: { editor: Editor; root: HTMLElement | null }) {
  // A move of the caret or a change of focus, never the text: the card is out of the way of typing.
  const [, again] = useState(0);
  useEditorTick(editor, true, { docs: 'never' });
  // Typing hides the card until the caret moves again. It is a ref, not state, so that a
  // keystroke with no card on screen is not a render.
  const typing = useRef(false);
  const shown = useRef(false);

  useEffect(() => {
    const onTx = ({ transaction }: { transaction: { docChanged: boolean; selectionSet: boolean } }) => {
      if (transaction.docChanged) {
        if (!typing.current) {
          typing.current = true;
          if (shown.current) again((n) => n + 1);
        }
      } else if (transaction.selectionSet) typing.current = false;
    };
    editor.on('transaction', onTx);
    return () => void editor.off('transaction', onTx);
  }, [editor]);

  const at = !typing.current && editor.isEditable && editor.isFocused && editor.state.selection.empty ? linkAt(editor) : null;
  shown.current = at !== null;
  const rect = useCaretRect(editor, at !== null, at?.from);
  if (!at) return null;

  return (
    <Float root={root} rect={rect} open role="group" label="Link" className="oa-linkcard">
      <span className="oa-linkcard-url" title={at.href}>
        {at.href}
      </span>
      <IconButton icon={arrowSquareOutIcon} label="Open link" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => window.open(at.href, '_blank', 'noopener,noreferrer')} />
      <IconButton icon={pencilSimpleIcon} label="Edit link" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => uiOf(editor).set({ link: true })} />
      <IconButton icon={linkBreakIcon} label="Remove link" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => removeLink(editor)} />
    </Float>
  );
}
