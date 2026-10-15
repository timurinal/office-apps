/**
 * The core module's overlays: everything it draws that is not in the ribbon, a pane or the
 * footer's own place.
 *
 * A module has no slot for a panel that floats over the page, so this rides on a footer
 * item (`status.core-host` in modules/core.tsx), which is always mounted, receives the
 * current `DocsContext` on every render, and draws nothing where it sits: its panels are
 * portalled into the shell. What it does:
 *
 *   gives the editor its context     (env.ts), for the paste and drop handlers
 *   the link editor and its card     (LinkEditor.tsx)
 *   the @ picker                     (Picker.tsx)
 *   the date editor                  (Picker.tsx)
 *   the find bar                     (FindBar.tsx)
 *   the special characters dialog    (SpecialChars.tsx)
 *   the word count dialog            (WordCount.tsx)
 *   what a click on a chip does      here: a document opens, a date is edited
 */

import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { isDocKind } from '@shared/api';
import { docPath } from '../../home/home';
import { whenIdle } from '../../core/prefetch';
import { useRouter } from '../../router';
import type { DocsContext } from '../modules/types';
import { provideCtx } from './env';
import { hasPeople, loadMentionables } from './people';
import { FindBar } from './FindBar';
import { useMountedEditor, usePortalRoot, viewOf } from './hooks';
import { LinkCard, LinkEditor } from './LinkEditor';
import { DateEditor, PickerList } from './Picker';
import { SpecialChars } from './SpecialChars';
import { createUiStore, UI_CLOSED, uiOf, type UiState, type UiStore } from './ui';
import { WordCountDialog } from './WordCount';

const NO_STORE: UiStore = createUiStore();

function useUi(editor: Editor | null): UiState {
  const store = editor ? uiOf(editor) : NO_STORE;
  return useSyncExternalStore(store.subscribe, store.get, () => UI_CLOSED);
}

/** A chip was clicked. A document opens (a new tab for Ctrl, ⌘ or the middle button); a date is edited. */
function useChipClicks(editor: Editor | null, navigate: (to: string) => void): void {
  // A new view is a new element, and the listeners belong to the element.
  const dom = editor ? (viewOf(editor)?.dom ?? null) : null;
  useEffect(() => {
    if (!editor || !dom) return;
    const open = (e: MouseEvent, el: HTMLElement) => {
      const id = el.dataset.docId;
      const kind = el.dataset.kind;
      if (!id || !isDocKind(kind) || el.dataset.state === 'unavailable') return;
      const href = docPath(kind, id);
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.button === 1) window.open(href, '_blank', 'noopener,noreferrer');
      else navigate(href);
    };

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-chip]');
      if (!el || !dom.contains(el)) return;
      if (el.dataset.chip === 'doc') open(e, el);
      else if (el.dataset.chip === 'date' && editor.isEditable) {
        const at = editor.view.posAtDOM(el, 0);
        const pos = editor.state.doc.nodeAt(at)?.type.name === 'dateChip' ? at : at - 1;
        if (editor.state.doc.nodeAt(pos)?.type.name === 'dateChip') uiOf(editor).set({ dateAt: pos });
      }
    };
    // A selected link is opened with Enter, as a link is.
    const onKey = (e: KeyboardEvent) => {
      const sel = editor.state.selection;
      if (e.key !== 'Enter' || !(sel instanceof NodeSelection) || sel.node.type.name !== 'docLink') return;
      const id = String(sel.node.attrs.docId ?? '');
      // The chip knows where the document is now; the node only where it was.
      const live = (editor.view.nodeDOM(sel.from) as HTMLElement | null)?.dataset?.kind;
      const kind = isDocKind(live) ? live : sel.node.attrs.kind;
      if (id && isDocKind(kind)) {
        e.preventDefault();
        navigate(docPath(kind, id));
      }
    };
    dom.addEventListener('click', onClick);
    dom.addEventListener('keydown', onKey);
    return () => {
      dom.removeEventListener('click', onClick);
      dom.removeEventListener('keydown', onKey);
    };
  }, [editor, dom, navigate]);
}

export function CoreHost({ ctx }: { ctx: DocsContext }) {
  // Before the page has mounted the editor there is nothing to draw over.
  const editor = useMountedEditor(ctx.editor);
  const { navigate } = useRouter();
  const root = usePortalRoot(editor);
  const ui = useUi(editor);

  // Every render: the paste and drop handlers read it when they run.
  useLayoutEffect(() => {
    if (ctx.editor) provideCtx(ctx.editor, ctx);
  });
  useChipClicks(editor, navigate);

  // The people a mention can name are asked for once the page is quiet, so the first `@` has
  // them already. Nothing starts on the keystroke that could have started earlier.
  const { id: documentId } = ctx.meta;
  // Not for a link guest: the server refuses them the list, and the picker has the owner already.
  const mentions = ctx.can.edit && hasPeople(ctx) && !ctx.caps.guest;
  useEffect(() => {
    if (!mentions) return;
    return whenIdle(() => void loadMentionables(ctx), 1500);
    // The list is the document's: another document is another list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, mentions]);

  if (!editor) return null;
  return (
    <>
      {ctx.can.edit && !ui.link && <LinkCard editor={editor} root={root} />}
      {ui.link && ctx.can.edit && <LinkEditor editor={editor} root={root} />}
      <PickerList editor={editor} root={root} />
      {ui.dateAt !== null && ctx.can.edit && <DateEditor editor={editor} root={root} at={ui.dateAt} />}
      <FindBar editor={editor} root={root} canEdit={ctx.can.edit} />
      {ui.chars && <SpecialChars editor={editor} onClose={() => uiOf(editor).set({ chars: false })} />}
      {ui.count && <WordCountDialog editor={editor} onClose={() => uiOf(editor).set({ count: false })} />}
    </>
  );
}
