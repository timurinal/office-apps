/**
 * The `docx`-package half of the corpus: what python-docx has no API for.
 *
 *     node tests/corpus/generate/make_docx_package.mjs
 *
 * Links (including the ones a reader must refuse), footnotes, tracked changes, numbering
 * definitions, threaded comments, and a table of contents with its fields.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  InternalHyperlink,
  InsertedTextRun,
  LevelFormat,
  Packer,
  Paragraph,
  SimpleField,
  TextRun,
  TableOfContents
} from 'docx';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docx');
const DATE = '2026-03-04T10:00:00Z';

const save = async (name, doc) => {
  writeFileSync(join(OUT, name), await Packer.toBuffer(doc));
  console.log('wrote', name);
};

const p = (...children) => new Paragraph({ children });
const t = (text, o = {}) => new TextRun({ text, ...o });

// ── 11 ───────────────────────────────────────────────────────────────────────
await save(
  '11-links-footnotes.docx',
  new Document({
    footnotes: {
      1: { children: [p(t('The first note, with some detail.'))] },
      2: { children: [p(t('A second note.'))] },
      3: { children: [p(t('The third note, at the end of the paragraph.'))] }
    },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Links and notes')] }),
          p(
            t('A web link: '),
            new ExternalHyperlink({ link: 'https://example.com/office?from=corpus', children: [t('Office', { style: 'Hyperlink' })] }),
            t(', a mail link: '),
            new ExternalHyperlink({ link: 'mailto:hello@example.com', children: [t('hello@example.com', { style: 'Hyperlink' })] }),
            t('.')
          ),
          p(
            t('A link a reader must refuse: '),
            new ExternalHyperlink({ link: 'javascript:alert(document.cookie)', children: [t('click for a prize', { style: 'Hyperlink' })] }),
            t(', and a data link: '),
            new ExternalHyperlink({ link: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', children: [t('inline page', { style: 'Hyperlink' })] }),
            t('.')
          ),
          p(t('A place in this document: '), new InternalHyperlink({ anchor: 'nowhere', children: [t('jump', { style: 'Hyperlink' })] }), t('.')),
          p(t('Text with a note'), new FootnoteReferenceRun(1), t(' in the middle and another'), new FootnoteReferenceRun(2), t(' after it.')),
          p(t('A note at the end.'), new FootnoteReferenceRun(3))
        ]
      }
    ]
  })
);

// ── 12 ───────────────────────────────────────────────────────────────────────
await save(
  '12-tracked-changes.docx',
  new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Tracked changes')] }),
          p(
            t('The meeting is on '),
            new DeletedTextRun({ text: 'Tuesday', id: 1, author: 'Ben Okoro', date: DATE }),
            new InsertedTextRun({ text: 'Thursday', id: 2, author: 'Ben Okoro', date: DATE }),
            t(' at noon.')
          ),
          p(t('Plain text, then '), new InsertedTextRun({ text: 'an addition by Ada', id: 3, author: 'Ada Rowe', date: '2026-03-05T09:30:00Z' }), t(', then '), new DeletedTextRun({ text: 'a removal by Ada', id: 4, author: 'Ada Rowe', date: '2026-03-05T09:31:00Z' }), t('.')),
          p(t('Untouched paragraph.'))
        ]
      }
    ]
  })
);

// ── 13 ───────────────────────────────────────────────────────────────────────
const levels = (fmt, text, start = 1) => [
  { level: 0, format: fmt, text, alignment: AlignmentType.START, start },
  { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.START },
  { level: 2, format: LevelFormat.LOWER_ROMAN, text: '%3.', alignment: AlignmentType.START }
];
await save(
  '13-numbering.docx',
  new Document({
    numbering: {
      config: [
        {
          reference: 'legal',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2.', alignment: AlignmentType.START, isLegalNumberingStyle: true },
            { level: 2, format: LevelFormat.DECIMAL, text: '%1.%2.%3.', alignment: AlignmentType.START, isLegalNumberingStyle: true }
          ]
        },
        { reference: 'roman', levels: levels(LevelFormat.UPPER_ROMAN, '%1.') },
        { reference: 'start-five', levels: levels(LevelFormat.DECIMAL, '%1.', 5) },
        { reference: 'letters', levels: levels(LevelFormat.UPPER_LETTER, '%1.') },
        { reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START }, { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.START }] }
      ]
    },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Numbering')] }),
          p(t('Legal numbering:')),
          new Paragraph({ numbering: { reference: 'legal', level: 0 }, children: [t('Definitions')] }),
          new Paragraph({ numbering: { reference: 'legal', level: 1 }, children: [t('Interpretation')] }),
          new Paragraph({ numbering: { reference: 'legal', level: 1 }, children: [t('Scope')] }),
          new Paragraph({ numbering: { reference: 'legal', level: 2 }, children: [t('Included')] }),
          new Paragraph({ numbering: { reference: 'legal', level: 0 }, children: [t('Obligations')] }),
          p(t('Roman numerals:')),
          new Paragraph({ numbering: { reference: 'roman', level: 0 }, children: [t('Introduction')] }),
          new Paragraph({ numbering: { reference: 'roman', level: 0 }, children: [t('Method')] }),
          new Paragraph({ numbering: { reference: 'roman', level: 1 }, children: [t('Sampling')] }),
          p(t('Starting at five:')),
          new Paragraph({ numbering: { reference: 'start-five', level: 0 }, children: [t('Fifth')] }),
          new Paragraph({ numbering: { reference: 'start-five', level: 0 }, children: [t('Sixth')] }),
          p(t('Capital letters, interrupted:')),
          new Paragraph({ numbering: { reference: 'letters', level: 0 }, children: [t('Alpha')] }),
          new Paragraph({ numbering: { reference: 'letters', level: 0 }, children: [t('Bravo')] }),
          p(t('A paragraph in between.')),
          new Paragraph({ numbering: { reference: 'letters', level: 0 }, children: [t('Charlie, continuing')] }),
          p(t('Bullets with children:')),
          new Paragraph({ numbering: { reference: 'dots', level: 0 }, children: [t('Parent')] }),
          new Paragraph({ numbering: { reference: 'dots', level: 1 }, children: [t('Child')] }),
          new Paragraph({ numbering: { reference: 'dots', level: 0 }, children: [t('Sibling')] })
        ]
      }
    ]
  })
);

// ── 14 ───────────────────────────────────────────────────────────────────────
await save(
  '14-threaded-comments.docx',
  new Document({
    comments: {
      children: [
        { id: 1, author: 'Ben Okoro', initials: 'BO', date: new Date(DATE), children: [p(t('Should this say "ship" instead?'))] },
        { id: 2, author: 'Ada Rowe', initials: 'AR', date: new Date('2026-03-04T11:00:00Z'), parentId: 1, children: [p(t('Yes, changed.'))] },
        { id: 3, author: 'Ben Okoro', initials: 'BO', date: new Date('2026-03-04T11:05:00Z'), parentId: 1, children: [p(t('Thanks.'))] },
        { id: 4, author: 'Ada Rowe', initials: 'AR', date: new Date('2026-03-04T12:00:00Z'), resolved: true, children: [p(t('Resolved already.'))] }
      ]
    },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Threaded comments')] }),
          p(
            t('We will '),
            new CommentRangeStart(1),
            new CommentRangeStart(2),
            new CommentRangeStart(3),
            t('deliver the release'),
            new CommentRangeEnd(1),
            new CommentReference(1),
            new CommentRangeEnd(2),
            new CommentReference(2),
            new CommentRangeEnd(3),
            new CommentReference(3),
            t(' on time and '),
            new CommentRangeStart(4),
            t('under budget'),
            new CommentRangeEnd(4),
            new CommentReference(4),
            t('.')
          )
        ]
      }
    ]
  })
);

// ── 15 ───────────────────────────────────────────────────────────────────────
await save(
  '15-toc-fields.docx',
  new Document({
    features: { updateFields: false },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [t('Contents and fields')] }),
          new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [t('First chapter')] }),
          p(t('Body of the first chapter. Today is '), new SimpleField('DATE \\@ "d MMMM yyyy"', '4 March 2026'), t('.')),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t('A subsection')] }),
          p(t('Text of the subsection.')),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Second chapter')] }),
          p(t('Body of the second chapter.'))
        ]
      }
    ]
  })
);
