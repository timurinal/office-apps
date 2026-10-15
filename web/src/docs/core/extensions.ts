/**
 * Everything the core module adds to the editor, as one list.
 *
 * Pure Tiptap and ProseMirror, no React: the same list builds the schema in a Web
 * Worker (`docs/seed.ts`), so a converter that has no page can still make a document this
 * editor opens. `modules/core.tsx` puts it in `extensions`.
 *
 * What is not here, because the base list (docs/extensions.ts) has it: paragraphs, headings,
 * quote, code block, rule, bold, italic, underline, strike, link, bulleted and numbered
 * lists, and the collaboration binding.
 */

import type { AnyExtension } from '@tiptap/core';
import Typography from '@tiptap/extension-typography';
import { chipHost, dateChip, docLink, mentionNode } from './chips';
import { coreEnv } from './env';
import { findExtension } from './find';
import { imageIntake, imageNode } from './images';
import { shortcuts } from './keys';
import { listKit } from './lists';
import { paragraphFormat } from './paragraph';
import { tableNodes } from './tables';
import { formatPainter, textMarks } from './text';

/** Typing `(c)`, `->` and `--` as Word does. The fraction and multiplication rules are
 *  off: `1/2` and `3x4` are a date and a size at least as often as they are arithmetic. */
const autocorrect = Typography.configure({ oneHalf: false, oneQuarter: false, threeQuarters: false, multiplication: false });

export const coreExtensions: AnyExtension[] = [
  coreEnv,
  chipHost,
  paragraphFormat,
  ...textMarks,
  ...listKit,
  ...tableNodes,
  imageNode,
  imageIntake,
  mentionNode,
  dateChip,
  docLink,
  findExtension,
  formatPainter,
  shortcuts,
  autocorrect
];
