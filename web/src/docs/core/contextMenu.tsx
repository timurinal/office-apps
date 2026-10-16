/**
 * The right-click menu of a document: over a link, a picture or a table, and nowhere else.
 *
 * On plain text the browser's menu stays. It has the spelling suggestions, which a page cannot read, so a
 * menu of ours over words would hide the one thing a person right-clicks a word for; that waits for the
 * spelling work of Phase 10. And so it stays when Shift is held, and for a person who can do nothing here
 * (a reader over a table): when no module has a row for what was clicked, nothing is drawn and nothing
 * is prevented.
 *
 * This is the page's half: it hears `contextmenu` on the editor's own element, works out what is under the
 * pointer from the DOM (a link is an `a[href]`, a table cell a `td` or `th`, a picture a node whose view
 * holds the target), puts the selection where the click was so the rows act on it, and asks the modules'
 * `contextItems` (modules/menus.tsx) for the rows. The picture's alt text dialog is here too, because a row
 * only asks for it.
 */

import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type React from 'react';
import { Button, TextField } from '../../core/controls';
import { useContextMenu } from '../../core/contextHost';
import type { ContextHook } from '../../core/ContextMenu';
import { Modal, useModalClose } from '../../core/ui';
import type { DocsContext, DocsMenuTarget } from '../modules/types';
import { useMountedEditor, viewOf } from './hooks';

// ── what was clicked ────────────────────────────────────────────────────────

/** The position of the picture whose view holds `el`, or null. */
function pictureAt(editor: Editor, el: Element): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== 'image') return true;
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof Node && dom.contains(el)) found = pos;
    return false;
  });
  return found;
}

/** What is under the click: a link, a picture, a table, in any mix; null for plain text and the page. */
export function menuTargetAt(editor: Editor, el: Element): DocsMenuTarget | null {
  const target: DocsMenuTarget = {};
  const image = pictureAt(editor, el);
  if (image !== null) target.image = { pos: image };
  const link = el.closest('a[href]');
  if (link) target.link = { href: link.getAttribute('href') ?? '' };
  if (el.closest('td, th')) target.table = true;
  return Object.keys(target).length ? target : null;
}

/**
 * Put the selection where the click was, so the rows act on it: the picture is selected, and the caret is
 * put in the link or the cell, unless the click is inside a selection already (a run of cells, a range).
 */
export function selectUnder(editor: Editor, el: Element, at: { x: number; y: number }, target: DocsMenuTarget): void {
  const { view, state } = editor;
  if (target.image) {
    const { selection } = state;
    if (!(selection instanceof NodeSelection && selection.from === target.image.pos)) editor.commands.setNodeSelection(target.image.pos);
    return;
  }
  const anchor = el.closest('a[href]') ?? el.closest('td, th');
  let pos: number | null = null;
  try {
    pos = view.posAtCoords({ left: at.x, top: at.y })?.pos ?? null;
  } catch {
    pos = null;
  }
  if (pos === null && anchor) pos = view.posAtDOM(anchor, 0);
  if (pos === null) return;
  const { selection } = state;
  const inside = selection instanceof CellSelection || !selection.empty ? pos >= selection.from && pos <= selection.to : false;
  if (inside) return;
  view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(Math.min(pos, state.doc.content.size)))));
}

// ── the picture's alt text ──────────────────────────────────────────────────

let altAt: { pos: number; seq: number } | null = null;
let altSeq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Ask for the alt text dialog for the picture at `pos`. */
export function openAltText(pos: number): void {
  altAt = { pos, seq: ++altSeq };
  emit();
}
export function closeAltText(of?: number): void {
  if (!altAt || (of !== undefined && altAt.seq !== of)) return;
  altAt = null;
  emit();
}
export const altTextNow = (): { pos: number; seq: number } | null => altAt;

function useAltAt() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => altAt,
    () => null
  );
}

/** What a picture says in place of itself: the `alt` of the picture node, one step in the document. */
export function setAltText(editor: Editor, pos: number, alt: string): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const node = state.doc.nodeAt(pos);
      if (node?.type.name !== 'image') return false;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: alt.trim() === '' ? null : alt.trim() });
      return true;
    })
    .run();
}

function AltTextDialog({ editor, at, onClose }: { editor: Editor; at: { pos: number; seq: number }; onClose: () => void }) {
  const node = editor.state.doc.nodeAt(at.pos);
  const [text, setText] = useState(() => String(node?.attrs.alt ?? ''));
  if (node?.type.name !== 'image') return null;
  return (
    <Modal
      title="Alt text"
      description="What a screen reader says in place of the picture."
      width={420}
      onClose={onClose}
      footer={<AltFooter apply={() => setAltText(editor, at.pos, text)} />}
    >
      <form id="oa-alt" onSubmit={(e) => e.preventDefault()}>
        <TextField label="Description" multiline rows={3} autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
      </form>
    </Modal>
  );
}

function AltFooter({ apply }: { apply: () => void }) {
  const close = useModalClose();
  return (
    <>
      <span style={{ flex: 1 }} />
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        type="submit"
        form="oa-alt"
        onClick={() => {
          apply();
          close();
        }}
      >
        Save
      </Button>
    </>
  );
}

// ── the host ────────────────────────────────────────────────────────────────

const labelOf = (t: DocsMenuTarget): string => (t.image ? 'Picture' : t.link ? 'Link' : 'Table');

/** Hears the right click on the page and draws the menu. Render the result once, anywhere in the editor. */
export function useDocsContextMenu(ctx: DocsContext, hooks: readonly ContextHook<DocsMenuTarget, DocsContext>[]): React.ReactNode {
  const editor = useMountedEditor(ctx.editor);
  const menu = useContextMenu<DocsMenuTarget, DocsContext>({ ctx, hooks, label: labelOf, returnFocus: () => ctx.actions.focusEditor() });
  const alt = useAltAt();
  const dom = editor ? (viewOf(editor)?.dom ?? null) : null;
  const { entries, open } = menu;

  useEffect(() => {
    if (!editor || !dom) return;
    const onMenu = (e: MouseEvent) => {
      // Shift asks for the browser's own menu.
      if (e.shiftKey || !(e.target instanceof Element)) return;
      const target = menuTargetAt(editor, e.target);
      if (!target || entries(target).length === 0) return;
      e.preventDefault();
      if (editor.isEditable) selectUnder(editor, e.target, { x: e.clientX, y: e.clientY }, target);
      open(target, { x: e.clientX, y: e.clientY }, dom);
    };
    dom.addEventListener('contextmenu', onMenu);
    return () => dom.removeEventListener('contextmenu', onMenu);
  }, [editor, dom, entries, open]);

  return (
    <>
      {menu.element}
      {editor && alt && ctx.can.edit && <AltTextDialog key={alt.seq} editor={editor} at={alt} onClose={() => closeAltText(alt.seq)} />}
    </>
  );
}
