/**
 * What a predefined Docs template is.
 *
 * `body` is the document, as ProseMirror JSON in the editor's schema. `header` and `footer`
 * are the page's own fragments (pagination/headerFooter.ts) in the smaller schema a header
 * has, and `page` is the page setup as the document stores it (pagination/setup.ts), in
 * millimetres. The paper size is left out on purpose: the editor writes A4, or Letter where
 * the browser says en-US, on the first edit, and a template that named one would take that
 * choice from the reader.
 *
 * Type-only imports, so that Home, which draws the cards from these, does not load the page
 * view.
 */

import type { JSONContent } from '@tiptap/core';
import type { SetupPatch } from '../pagination/setup';

export interface DocsTemplate {
  /** The part after `predefined:`. Nothing stores it, but a card's id is built from it, so it does not change. */
  slug: string;
  /** The card's title, and the new document's. */
  title: string;
  /** One line, for the card's tooltip. */
  description: string;
  body: JSONContent[];
  /** The page setup, without a paper size. */
  page?: Omit<SetupPatch, 'size' | 'paged'>;
  header?: JSONContent[];
  footer?: JSONContent[];
}
