/**
 * The word count: the footer's figure and the dialog behind it.
 *
 * The footer says "1,284 words", or "12 of 1,284 words" while some text is selected, and
 * is a button that opens the dialog: words, characters with and without spaces, and
 * paragraphs, for the whole document and for the selection.
 *
 * The whole-document count waits for typing to pause (400 ms): it is a pass over the
 * document and not worth doing between keystrokes. The selection's is counted as the
 * selection moves, because it is only the selected text and a number that lags the
 * selection is a wrong one.
 */

import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { Button } from '../../core/controls';
import { Modal, useModalClose } from '../../core/ui';
import { countRange, formatCount, NO_COUNTS, type Counts } from './count';
import { openCount } from './ui';

export function useCounts(editor: Editor | null): { doc: Counts; selection: Counts | null } {
  const [doc, setDoc] = useState<Counts>(NO_COUNTS);
  const [selection, setSelection] = useState<Counts | null>(null);

  useEffect(() => {
    if (!editor) return;
    setDoc(countRange(editor.state.doc));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => !editor.isDestroyed && setDoc(countRange(editor.state.doc)), 400);
    };
    const moved = () => {
      const { from, to, empty } = editor.state.selection;
      setSelection(empty ? null : countRange(editor.state.doc, from, to));
    };
    editor.on('update', later);
    editor.on('selectionUpdate', moved);
    return () => {
      editor.off('update', later);
      editor.off('selectionUpdate', moved);
      clearTimeout(timer);
    };
  }, [editor]);

  return { doc, selection };
}

const words = (n: number): string => `${formatCount(n)} ${n === 1 ? 'word' : 'words'}`;

export function WordCountStatus({ editor }: { editor: Editor | null }) {
  const { doc, selection } = useCounts(editor);
  const picked = selection && selection.words > 0 ? selection : null;
  return (
    <button type="button" className="oa-status oa-wordbtn" title="Word count" onClick={() => editor && openCount(editor)}>
      {picked ? `${formatCount(picked.words)} of ${words(doc.words)}` : words(doc.words)}
    </button>
  );
}

function Close() {
  const close = useModalClose();
  return (
    <>
      <span style={{ flex: 1 }} />
      <Button variant="primary" onClick={close}>
        Close
      </Button>
    </>
  );
}

function Rows({ c }: { c: Counts }) {
  return (
    <>
      <dt>Words</dt>
      <dd>{formatCount(c.words)}</dd>
      <dt>Characters</dt>
      <dd>{formatCount(c.characters)}</dd>
      <dt>Characters without spaces</dt>
      <dd>{formatCount(c.charactersNoSpaces)}</dd>
      <dt>Paragraphs</dt>
      <dd>{formatCount(c.paragraphs)}</dd>
    </>
  );
}

export function WordCountDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  // Counted when it opens: a dialog is a moment, not a live readout.
  const [{ doc, selection }] = useState(() => {
    const { from, to, empty } = editor.state.selection;
    return { doc: countRange(editor.state.doc), selection: empty ? null : countRange(editor.state.doc, from, to) };
  });
  return (
    <Modal title="Word count" width={380} onClose={onClose} footer={<Close />}>
      <dl className="oa-counts">
        {selection && selection.words > 0 && (
          <>
            <div className="oa-counts-head">Selection</div>
            <Rows c={selection} />
            <div className="oa-counts-head">Document</div>
          </>
        )}
        <Rows c={doc} />
      </dl>
    </Modal>
  );
}
