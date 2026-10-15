/**
 * Building small files for tests: a docx from a few strings, a schema-checked document.
 * Imported by tests only.
 */

import { strToU8, zipSync } from 'fflate';

export const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

export interface FixtureParts {
  /** The inside of `<w:body>`. */
  body: string;
  styles?: string;
  numbering?: string;
  footnotes?: string;
  comments?: string;
  commentsExtended?: string;
  headers?: Record<string, string>;
  footers?: Record<string, string>;
  /** Extra relationships on the document: `{ id, type, target, external? }`. */
  rels?: { id: string; type: string; target: string; external?: boolean }[];
  /** Extra files by path (media). */
  files?: Record<string, Uint8Array>;
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

export function makeDocx(parts: FixtureParts): Uint8Array {
  const rels: { id: string; type: string; target: string; external?: boolean }[] = [...(parts.rels ?? [])];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`
    )
  };
  const add = (name: string, type: string, xml: string | undefined, target: string) => {
    if (xml === undefined) return;
    files[`word/${target}`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>${xml}`);
    rels.push({ id: `rid-${name}`, type, target });
  };
  add('styles', 'styles', parts.styles, 'styles.xml');
  add('numbering', 'numbering', parts.numbering, 'numbering.xml');
  add('footnotes', 'footnotes', parts.footnotes, 'footnotes.xml');
  add('comments', 'comments', parts.comments, 'comments.xml');
  add('commentsExtended', 'commentsExtended', parts.commentsExtended, 'commentsExtended.xml');
  for (const [id, xml] of Object.entries(parts.headers ?? {})) add(id, 'header', xml, `${id}.xml`);
  for (const [id, xml] of Object.entries(parts.footers ?? {})) add(id, 'footer', xml, `${id}.xml`);
  for (const [path, data] of Object.entries(parts.files ?? {})) files[path] = data;

  files['word/document.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${parts.body}</w:body></w:document>`
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${r.type.startsWith('http') ? r.type : REL + r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ''}/>`
      )
      .join('')}</Relationships>`
  );
  return zipSync(files);
}

export const p = (inner: string, ppr = ''): string => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
export const r = (t: string, rpr = ''): string => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;

/** A 1x1 PNG, a 1x1 GIF and a 2x2 JPEG-signed blob: enough for the sniffer and the importer. */
export const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
    .split('')
    .map((c) => c.charCodeAt(0))
);
