import { bold, contents, field, h2, h3, line, numbered, p, pageBreak, para, subtitle, title } from '../build';
import type { DocsTemplate } from '../types';

/** What the table of contents is made from. Sections are Heading 2, as in every template: Heading 1 is the size of a title. */
const chapters = [
  h2('Summary'),
  p('The finding and what to do about it, in a paragraph.'),
  h2('Background'),
  p('What led to this report, and what it set out to answer.'),
  h2('Findings'),
  h3('First finding'),
  p('What was found, and the evidence for it.'),
  h3('Second finding'),
  p('What was found, and the evidence for it.'),
  h2('Recommendations'),
  numbered('What to do first', 'What to do next'),
  p()
];

export const report: DocsTemplate = {
  slug: 'report',
  title: 'Report',
  description: 'A cover, contents, numbered pages and the usual sections.',
  body: [
    title('Report title', { spaceBefore: 170 }),
    subtitle('One line on what this report covers'),
    line(bold('Author  '), 'Your name'),
    line(bold('Date  '), 'Add the date'),
    pageBreak(),
    // The table draws its own "Contents" heading.
    contents(chapters),
    pageBreak(),
    ...chapters
  ],
  // The cover has no header or footer: its own fragments are left empty.
  page: { differentFirst: true },
  header: [para({ textAlign: 'right' }, field('title'))],
  footer: [para({ textAlign: 'center' }, 'Page ', field('page'), ' of ', field('pages'))]
};
