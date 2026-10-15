/**
 * Headers and footers: four `Y.XmlFragment`s in the document's own `Y.Doc`, beside the body.
 *
 *   header-default  footer-default   every page
 *   header-first    footer-first     page 1, when the page setup says "different first page"
 *
 * They are separate fragments rather than nodes in the body so a header cannot be pasted
 * into the text, and so the body's undo is not the header's. They share the room, the
 * persistence and version restore with the body. Each has a small schema of its own:
 * paragraphs, bold, italic, underline, alignment, and the four fields.
 *
 * Pages show static copies, drawn from the fragment and refilled per page. Editing is as
 * in Word: a double-click in the top or bottom margin mounts one live editor in place of
 * that page's copy, and every other page redraws as it changes. There is never an editor
 * per page.
 */

import { Editor, getSchema, type AnyExtension } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import TextAlign from '@tiptap/extension-text-align';
import StarterKit from '@tiptap/starter-kit';
import { DOMSerializer, type Schema } from '@tiptap/pm/model';
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import { PageField, type FieldKind } from './nodes';

export type HFKind = 'header' | 'footer';
export type HFVariant = 'default' | 'first';

export const fragmentName = (kind: HFKind, variant: HFVariant): string => `${kind}-${variant}`;
export const HF_FRAGMENTS = ['header-default', 'header-first', 'footer-default', 'footer-first'] as const;

export function hfExtensions(resolve?: (kind: FieldKind) => string): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      undoRedo: false,
      trailingNode: false,
      link: false,
      strike: false
    }),
    TextAlign.configure({ types: ['paragraph'] }),
    resolve ? PageField.configure({ resolve }) : PageField
  ];
}

let schema: Schema | null = null;
export const hfSchema = (): Schema => (schema ??= getSchema(hfExtensions()));

/** One fragment as DOM, with its fields still to be filled. Null when it is empty. */
export function renderFragment(fragment: Y.XmlFragment): DocumentFragment | null {
  if (fragment.length === 0) return null;
  const s = hfSchema();
  let node;
  try {
    node = yXmlFragmentToProseMirrorRootNode(fragment, s);
  } catch {
    return null;
  }
  if (!node.textContent.trim() && !hasField(node)) return null;
  return DOMSerializer.fromSchema(s).serializeFragment(node.content) as DocumentFragment;
}

function hasField(node: import('@tiptap/pm/model').Node): boolean {
  let found = false;
  node.descendants((n) => {
    if (n.type.name === 'pageField') found = true;
    return !found;
  });
  return found;
}

export interface FieldValues {
  page: number;
  pages: number;
  title: string;
  date: string;
}

export const todayText = (): string => new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date());

export function fieldText(kind: FieldKind, v: FieldValues): string {
  switch (kind) {
    case 'page':
      return String(v.page);
    case 'pages':
      return String(v.pages);
    case 'date':
      return v.date;
    case 'title':
      return v.title;
  }
}

/** A copy of a rendered fragment with its fields filled for one page. */
export function filled(template: DocumentFragment, v: FieldValues): DocumentFragment {
  const copy = template.cloneNode(true) as DocumentFragment;
  copy.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => {
    el.textContent = fieldText(el.dataset.field as FieldKind, v);
  });
  return copy;
}

// ── editing in place ────────────────────────────────────────────────────────

export interface HFSessionOptions {
  doc: Y.Doc;
  kind: HFKind;
  variant: HFVariant;
  /** Where the live editor goes: the page's header or footer box. */
  mount: HTMLElement;
  values: () => FieldValues;
}

/** One live header or footer editor, bound to its fragment. */
export function createHFEditor(o: HFSessionOptions): Editor {
  const values = o.values;
  return new Editor({
    element: o.mount,
    extensions: [
      ...hfExtensions((kind) => fieldText(kind, values())),
      Collaboration.configure({ fragment: o.doc.getXmlFragment(fragmentName(o.kind, o.variant)) })
    ],
    editorProps: {
      attributes: { class: 'pg-hf-body', 'aria-label': o.kind === 'header' ? 'Header' : 'Footer', role: 'textbox' }
    },
    autofocus: 'end'
  });
}
