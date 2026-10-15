/**
 * Untrusted input. A file is a stranger's, and each of these is a promise about what a file
 * cannot make the converters do. They are written as attacks: the test builds the hostile
 * file and checks the refusal, so a regression is a test that fails and not a review that
 * misses it.
 */

import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFormatError } from './errors';
import { importDocument, readFile } from './import';
import { MAX_ZIP_ENTRIES, MAX_UNZIPPED_BYTES, MAX_XML_DEPTH } from './limits';
import { makeDocx, p, r } from './testing';
import { buildState } from './ydoc';
import { listZip } from './zip';
import { parseXml } from './xml';
import { readDocx } from './docx/read';
import { readHtml } from './html/read';
import { readMarkdown } from './markdown/read';
import { writeHtml } from './html/write';
import { writeMarkdown } from './markdown/write';
import { assetMimeOf } from './images';
import type { JSONContent } from './types';
import { MAX_RAW_CELLS } from './xlsx/limits';
import { readXlsx } from './xlsx/read';
import { readCsv } from './csv/read';
import { fieldText } from './csv/write';
import { makeXlsx, rawXlsx, sheetXml, STYLES } from './xlsx/testing';
import { dumpWorkbook } from './xlsx/testing';

// ExcelJS is the one dependency that reads what a stranger sent without our limits in front of it. These
// count the times it is asked for, so a test can say that a file was refused before it ever got there.
const excel = vi.hoisted(() => ({ loads: 0 }));
vi.mock('./xlsx/exceljs', async (importActual) => {
  const actual = await importActual<typeof import('./xlsx/exceljs')>();
  return {
    loadExcel: () => {
      excel.loads++;
      return actual.loadExcel();
    }
  };
});

afterEach(() => vi.restoreAllMocks());

function refusal(fn: () => unknown): { code?: string; message?: string } {
  try {
    fn();
  } catch (e) {
    if (isFormatError(e)) return { code: e.code, message: e.message };
    throw e;
  }
  return {};
}

const marksOf = (body: JSONContent, type: string): JSONContent[] => {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    for (const m of n.marks ?? []) if (m.type === type) out.push(m);
    (n.content ?? []).forEach(walk);
  };
  walk(body);
  return out;
};

describe('a zip bomb', () => {
  it('is refused on what its directory says, before anything is inflated', () => {
    // 65 MiB of zeros compresses to about 65 KiB: a file anyone can attach to an email.
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(MAX_UNZIPPED_BYTES + 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200_000);
    const refused = refusal(() => listZip(bomb));
    expect(refused.code).toBe('zip_limit');
    expect(refusal(() => readDocx(bomb)).code).toBe('zip_limit');
  });

  it('is refused when the size is spread over many entries', () => {
    const files: Record<string, Uint8Array> = {};
    const each = new Uint8Array(8 * 1024 * 1024);
    for (let i = 0; i < 9; i++) files[`word/media/${i}.bin`] = each;
    expect(refusal(() => readDocx(zipSync(files))).code).toBe('zip_limit');
  });

  it('is refused for having more entries than a document has', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`word/media/${i}.png`] = new Uint8Array(1);
    expect(refusal(() => listZip(zipSync(files))).code).toBe('zip_limit');
  });

  it('is told in plain words', () => {
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(MAX_UNZIPPED_BYTES + 1) });
    expect(refusal(() => readFile('big.docx', bomb)).message).toBe('That file is too large to open.');
  });

  it('is not a docx when it is not a zip, or has no document in it', () => {
    expect(refusal(() => readDocx(strToU8('plain text pretending to be a docx, long enough to pass a length test'))).code).toBe('not_docx');
    expect(refusal(() => readDocx(zipSync({ 'hello.txt': strToU8('hi') }))).code).toBe('not_docx');
  });

  it('reads an ordinary file at the same limits', () => {
    expect(readDocx(makeDocx({ body: p(r('fine')) })).model.body.content).toHaveLength(1);
  });
});

describe('XML that declares things', () => {
  const doctype = (inner: string) => `<?xml version="1.0"?><!DOCTYPE d [${inner}]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;

  it('refuses a DOCTYPE', () => {
    expect(refusal(() => parseXml('<!DOCTYPE x><a/>')).code).toBe('xml_unsafe');
  });

  it('refuses the billion laughs', () => {
    const laughs =
      '<!ENTITY a "ha">' +
      '<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">' +
      '<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">' +
      '<!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">';
    expect(refusal(() => parseXml(doctype(laughs))).code).toBe('xml_unsafe');
  });

  it('refuses an external entity, and never reads the file it names', () => {
    const xxe = doctype('<!ENTITY x SYSTEM "file:///etc/passwd">');
    expect(refusal(() => parseXml(xxe)).code).toBe('xml_unsafe');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(refusal(() => parseXml(xxe)).code).toBe('xml_unsafe');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an entity declaration with no doctype around it', () => {
    expect(refusal(() => parseXml('<a><!ENTITY x "y"></a>')).code).toBe('xml_unsafe');
  });

  it('does not expand a reference to an entity it was not given', () => {
    // No DTD, so `&x;` is an error, not a lookup.
    expect(refusal(() => parseXml('<a>&x;</a>')).code).toBe('xml_invalid');
  });

  it('refuses a document nested past the bound, rather than recursing into it', () => {
    const deep = '<a>'.repeat(MAX_XML_DEPTH + 10) + '</a>'.repeat(MAX_XML_DEPTH + 10);
    expect(refusal(() => parseXml(deep)).code).toBe('zip_limit');
  });

  it('refuses a docx whose document has a doctype', () => {
    const bytes = zipSync({
      '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://x/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': strToU8(doctype('<!ENTITY x "y">'))
    });
    expect(refusal(() => readDocx(bytes)).code).toBe('xml_unsafe');
  });

  it('refuses a docx whose styles part has a doctype, not only the document', () => {
    const bytes = makeDocx({ body: p(r('x')), styles: '<!DOCTYPE s [<!ENTITY e "boom">]><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>' });
    expect(refusal(() => readDocx(bytes)).code).toBe('xml_unsafe');
  });
});

describe('nothing is fetched', () => {
  it('a docx that links a picture and a hyperlink to the web makes no request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhr);
    const drawing =
      '<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:link="rLink"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const bytes = makeDocx({
      body: p(drawing + '<w:hyperlink r:id="rHref">' + r('click') + '</w:hyperlink>'),
      rels: [
        { id: 'rLink', type: 'image', target: 'https://tracker.example/pixel.png', external: true },
        { id: 'rHref', type: 'hyperlink', target: 'https://example.com/', external: true }
      ]
    });
    const out = readDocx(bytes);
    expect(out.images.size).toBe(0);
    expect(out.warnings.map((w) => w.code)).toContain('external-image');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('HTML with remote pictures, stylesheets and frames makes no request and keeps no picture', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = readHtml(
      '<link rel="stylesheet" href="https://evil.example/a.css"><style>@import url(https://evil.example/b.css)</style>' +
        '<img src="https://evil.example/pixel.gif"><iframe src="https://evil.example/"></iframe><p style="background:url(https://evil.example/c.png)">text</p>'
    );
    expect(out.images.size).toBe(0);
    expect(JSON.stringify(out.model.body)).not.toContain('evil.example');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Markdown with a remote picture keeps no picture and makes no request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = readMarkdown('![x](https://evil.example/pixel.png)\n\n<img src="https://evil.example/p.png">\n\ntext');
    expect(out.images.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('links keep to http, https and mailto', () => {
  const BAD = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.com/', 'tel:+4712345678', '//evil.example/x', '/relative', 'java\tscript:alert(1)'];

  it('in a docx, a hyperlink to anything else is left as text', () => {
    for (const target of BAD) {
      const out = readDocx(makeDocx({ body: p('<w:hyperlink r:id="h">' + r('go') + '</w:hyperlink>'), rels: [{ id: 'h', type: 'hyperlink', target, external: true }] }));
      expect(marksOf(out.model.body, 'link'), target).toHaveLength(0);
      expect(JSON.stringify(out.model.body)).toContain('"go"');
    }
  });

  it('in a docx, http, https and mailto are kept', () => {
    for (const target of ['http://example.com/', 'https://example.com/a?b=c#d', 'mailto:ada@office.test']) {
      const out = readDocx(makeDocx({ body: p('<w:hyperlink r:id="h">' + r('go') + '</w:hyperlink>'), rels: [{ id: 'h', type: 'hyperlink', target, external: true }] }));
      expect(marksOf(out.model.body, 'link')[0]?.attrs?.href, target).toBe(target);
    }
  });

  it('in a docx, a HYPERLINK field is held to the same rule', () => {
    const field = (url: string) =>
      p(
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          `<w:r><w:instrText xml:space="preserve"> HYPERLINK "${url}" </w:instrText></w:r>` +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          r('visible') +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
      );
    expect(marksOf(readDocx(makeDocx({ body: field('javascript:alert(1)') })).model.body, 'link')).toHaveLength(0);
    expect(marksOf(readDocx(makeDocx({ body: field('https://example.com/') })).model.body, 'link')).toHaveLength(1);
  });

  it('in Markdown', () => {
    for (const target of BAD.filter((b) => !/\s/.test(b))) {
      const out = readMarkdown(`[x](${target.replace(/ /g, '%20')}) and <${target}>`);
      expect(marksOf(out.model.body, 'link').filter((m) => m.attrs?.href === target), target).toHaveLength(0);
    }
    expect(marksOf(readMarkdown('[x](https://example.com/)').model.body, 'link')).toHaveLength(1);
    expect(marksOf(readMarkdown('[x](mailto:a@b.co)').model.body, 'link')).toHaveLength(1);
  });

  it('in HTML', () => {
    for (const target of BAD) {
      const out = readHtml(`<a href="${target}">x</a>`);
      expect(marksOf(out.model.body, 'link'), target).toHaveLength(0);
    }
    expect(marksOf(readHtml('<a href="https://example.com/">x</a>').model.body, 'link')).toHaveLength(1);
  });

  it('on the way out, a link that got into a model by another road is not written', () => {
    const model = { body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }, page: null, header: {}, footer: {} };
    expect(writeHtml(model, { title: 't' }).html).not.toContain('javascript:');
    expect(writeMarkdown(model, { title: 't' }).markdown).not.toContain('javascript:');
  });
});

describe('imported HTML is rebuilt from an allowlist', () => {
  const HOSTILE =
    '<html><head><script>alert(1)</script><style>body{background:url(javascript:alert(2))}</style></head><body onload="alert(3)">' +
    '<h1 onclick="alert(4)">Title</h1>' +
    '<p style="color:red;background:url(javascript:alert(5));font-family:evil}x{" onmouseover="alert(6)">Hello <b>bold</b><script>alert(7)</script><svg onload="alert(8)"><circle/></svg></p>' +
    '<a href="javascript:alert(9)" onfocus="alert(10)">a</a><iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">' +
    '<img src="javascript:alert(11)" onerror="alert(12)"><img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxMyk8L3NjcmlwdD4=">' +
    '<form action="https://evil.example"><input name="x" value="stolen"><textarea>secret</textarea></form>' +
    '<math><mi>x</mi></math><noscript><p>noscript</p></noscript><template><p>templated</p></template>' +
    '<div data-onclick="alert(14)" class="x">kept text</div></body></html>';

  it('keeps the text, and nothing that runs', () => {
    const out = readHtml(HOSTILE);
    const json = JSON.stringify(out.model.body);
    expect(json).not.toMatch(/alert|javascript|onload|onclick|onerror|onfocus|onmouseover|evil\.example|<script|<svg|<iframe|stolen|templated|noscript/i);
    expect(json).toContain('Title');
    expect(json).toContain('kept text');
    expect(out.images.size).toBe(0);
  });

  it('only writes attributes the editor writes, with values it checks', () => {
    const out = readHtml('<p style="color:red;background:url(javascript:alert(1));font-size:expression(alert(2))">x</p><p style="color: #c0392b; font-family: Georgia, serif; font-size: 14pt">y</p>');
    const styles = marksOf(out.model.body, 'textStyle').map((m) => m.attrs);
    for (const attrs of styles) {
      for (const [k, v] of Object.entries(attrs ?? {})) {
        expect(['fontFamily', 'fontSize', 'color']).toContain(k);
        expect(String(v)).toMatch(/^(#[0-9a-f]{3,8}|[\p{L}\p{N} ._-]+|\d+(\.\d+)?pt)$/iu);
      }
    }
    expect(styles).toContainEqual({ color: '#c0392b', fontFamily: 'Georgia', fontSize: '14pt' });
  });

  it('keeps a data: URL picture only when the bytes are a raster picture', () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0));
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const out = readHtml(`<img src="data:image/png;base64,${png}"><img src="data:image/svg+xml;base64,${svg}"><img src="data:image/png;base64,${svg}">`);
    // The third claims to be a PNG and is not: the bytes decide.
    expect(out.images.size).toBe(1);
    expect([...out.images.values()][0]?.mime).toBe('image/png');
  });
});

describe('only four kinds of picture are taken', () => {
  const sig = (...b: number[]) => Uint8Array.from([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const PNG = sig(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const JPG = sig(0xff, 0xd8, 0xff, 0xe0);
  const GIF = sig(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
  const SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const BMP = sig(0x42, 0x4d);
  const TIFF = sig(0x49, 0x49, 0x2a, 0x00);
  const EMF = sig(0x01, 0x00, 0x00, 0x00);

  it('sniffs by bytes', () => {
    expect([PNG, JPG, GIF, WEBP].map(assetMimeOf)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    for (const other of [SVG, BMP, TIFF, EMF]) expect(assetMimeOf(other)).toBeNull();
  });

  const docWith = (bytes: Uint8Array, ext = 'png') => {
    const drawing = '<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    return makeDocx({ body: p(drawing), rels: [{ id: 'rImg', type: 'image', target: `media/image1.${ext}` }], files: { [`word/media/image1.${ext}`]: bytes } });
  };

  it('keeps PNG, JPEG, GIF and WebP from a docx', () => {
    for (const [bytes, mime] of [[PNG, 'image/png'], [JPG, 'image/jpeg'], [GIF, 'image/gif'], [WEBP, 'image/webp']] as const) {
      const out = readDocx(docWith(bytes));
      expect([...out.images.values()].map((i) => i.mime), mime).toEqual([mime]);
    }
  });

  it('leaves out SVG, BMP, TIFF and EMF, whatever the file is called', () => {
    for (const bytes of [SVG, BMP, TIFF, EMF]) {
      for (const ext of ['png', 'svg', 'emf']) {
        const out = readDocx(docWith(bytes, ext));
        expect(out.images.size, ext).toBe(0);
        expect(out.warnings.map((w) => w.code)).toContain('image-format');
      }
    }
  });
});

describe('a document too big for the room', () => {
  const big = (): JSONContent => {
    // Random text does not compress and Yjs does not try: this is 4 MiB of state.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const para = () => ({ type: 'paragraph', content: [{ type: 'text', text: Array.from({ length: 2000 }, () => String.fromCharCode(97 + (rnd() % 26))).join('') }] });
    return { type: 'doc', content: Array.from({ length: 2200 }, para) };
  };

  it('is refused, in plain words', () => {
    const refused = refusal(() => buildState({ body: big(), page: null, header: {}, footer: {} }));
    expect(refused.code).toBe('document_too_large');
    expect(refused.message).toBe('That document is too large.');
  });

  it('is refused the same way from a file', () => {
    const md = new TextEncoder().encode(big().content!.map((c) => c.content![0]!.text).join('\n\n'));
    expect(refusal(() => importDocument('huge.md', md)).code).toBe('document_too_large');
  });
});

describe('the converters do not need a page', () => {
  it('ran above without one: the test environment is Node, with no document, window or DOMParser', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe('undefined');
  });
});

// ── a spreadsheet ───────────────────────────────────────────────────────────

async function xlsxRefusal(bytes: Uint8Array): Promise<{ code?: string; message?: string }> {
  try {
    await readXlsx(bytes);
  } catch (e) {
    if (isFormatError(e)) return { code: e.code, message: e.message };
    throw e;
  }
  return {};
}

describe('an xlsx zip bomb', () => {
  it('is refused on what its directory says, before ExcelJS has seen a byte', async () => {
    const before = excel.loads;
    // 65 MiB of zeros in a sheet, which is a few dozen KiB to mail.
    const bomb = rawXlsx({ Sheet1: sheetXml('') }, { parts: { 'xl/worksheets/sheet1.xml': new Uint8Array(MAX_UNZIPPED_BYTES + 1024 * 1024) } });
    expect(bomb.length).toBeLessThan(200_000);
    expect((await xlsxRefusal(bomb)).code).toBe('zip_limit');
    expect(excel.loads).toBe(before);
  });

  it('is refused when the size is spread over parts nobody reads, and over more entries than a workbook has', async () => {
    const before = excel.loads;
    const spread: Record<string, Uint8Array> = {};
    for (let i = 0; i < 9; i++) spread[`xl/media/${i}.bin`] = new Uint8Array(8 * 1024 * 1024);
    expect((await xlsxRefusal(rawXlsx({ Sheet1: sheetXml('') }, { parts: spread }))).code).toBe('zip_limit');
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) many[`xl/media/${i}.png`] = new Uint8Array(1);
    expect((await xlsxRefusal(rawXlsx({ Sheet1: sheetXml('') }, { parts: many }))).code).toBe('zip_limit');
    expect(excel.loads).toBe(before);
  });

  it('is told in plain words', async () => {
    const bomb = rawXlsx({ Sheet1: sheetXml('') }, { parts: { 'xl/worksheets/sheet1.xml': new Uint8Array(MAX_UNZIPPED_BYTES + 1) } });
    expect((await xlsxRefusal(bomb)).message).toBe('That file is too large to open.');
  });

  it('is a workbook of more cells than the room can ever hold, claimed in a few KiB, and is refused before they are made', async () => {
    const before = excel.loads;
    const cells = '<c r="A1"/>'.repeat(MAX_RAW_CELLS + 1);
    const bytes = rawXlsx({ Sheet1: sheetXml(`<row r="1">${cells}</row>`) });
    expect(bytes.length).toBeLessThan(200_000);
    expect((await xlsxRefusal(bytes)).code).toBe('sheet_too_large');
    const rows = rawXlsx({ Sheet1: sheetXml('<row/>'.repeat(MAX_RAW_CELLS + 1)) });
    expect((await xlsxRefusal(rows)).code).toBe('sheet_too_large');
    expect(excel.loads).toBe(before);
  });

  it('is a workbook that asks for more rows than the structure document can hold, refused before a million ids are made', async () => {
    const bytes = rawXlsx({ Sheet1: sheetXml('<row r="600000"><c r="A600000"><v>1</v></c></row>') });
    expect((await xlsxRefusal(bytes)).code).toBe('sheet_too_large');
  });
});

describe('an xlsx that declares things', () => {
  const doctype = '<!DOCTYPE d [<!ENTITY a "ha"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>';

  it('is refused for a DOCTYPE or an entity in any part that is read, before ExcelJS has seen it', async () => {
    const before = excel.loads;
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const cases: [string, Uint8Array][] = [
      ['a sheet', rawXlsx({ Sheet1: `<?xml version="1.0"?>${doctype}<worksheet ${NS}><sheetData/></worksheet>` })],
      ['the workbook', rawXlsx({ Sheet1: sheetXml('') }, { workbook: `<?xml version="1.0"?>${doctype}<workbook ${NS}><sheets/></workbook>` })],
      ['the shared strings', rawXlsx({ Sheet1: sheetXml('') }, { parts: { 'xl/sharedStrings.xml': `<?xml version="1.0"?>${doctype}<sst ${NS}><si><t>&b;</t></si></sst>` } })],
      ['the styles', rawXlsx({ Sheet1: sheetXml('') }, { parts: { 'xl/styles.xml': STYLES.replace('<styleSheet', `${doctype}<styleSheet`) } })],
      ['the theme', rawXlsx({ Sheet1: sheetXml('') }, { parts: { 'xl/theme/theme1.xml': `<?xml version="1.0"?>${doctype}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>` } })],
      ['the relationships', rawXlsx({ Sheet1: sheetXml('') }, { parts: { 'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?>${doctype}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` } })],
      ['an entity with no doctype around it', rawXlsx({ Sheet1: `<worksheet ${NS}><sheetData><!ENTITY x "y"></sheetData></worksheet>` })]
    ];
    for (const [where, bytes] of cases) expect((await xlsxRefusal(bytes)).code, where).toBe('xml_unsafe');
    expect(excel.loads).toBe(before);
  });

  it('is refused for an external entity, and the file it names is never read', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const xxe = '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>';
    const bytes = rawXlsx({ Sheet1: `<?xml version="1.0"?>${xxe}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&x;</t></is></c></row></sheetData></worksheet>` });
    expect((await xlsxRefusal(bytes)).code).toBe('xml_unsafe');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('an xlsx that is valid and hostile', () => {
  const quick = async (bytes: Uint8Array, ms = 3000) => {
    const started = performance.now();
    const out = await readXlsx(bytes);
    expect(performance.now() - started, 'time').toBeLessThan(ms);
    return { out, dump: dumpWorkbook(out.seed) };
  };

  it('has a validation over every cell there is, and it is held to the sheet without a cell of it being made', async () => {
    const { dump } = await quick(
      rawXlsx({ Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>', { after: '<dataValidations count="1"><dataValidation type="list" sqref="A1:XFD1048576"><formula1>"a,b"</formula1></dataValidation></dataValidations>' }) })
    );
    expect(dump.sheets[0]!.validations).toHaveLength(1);
    expect(dump.sheets[0]!.validations[0]!.ranges).toEqual(['A1:Z1000']);
  });

  it('has a merge over the whole sheet', async () => {
    const { dump } = await quick(rawXlsx({ Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>', { after: '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>' }) }));
    expect(dump.sheets[0]!.merges).toEqual(['A1:Z1000']);
  });

  it('has columns from the first to the 2,000,000,000th, and a column that begins outside the sheet', async () => {
    const { dump } = await quick(
      rawXlsx({ Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>', { before: '<cols><col min="1" max="2000000000" width="20" customWidth="1"/><col min="20000" max="30000" width="30" customWidth="1"/></cols>' }) })
    );
    // The first holds for every column the sheet has; the second is nowhere.
    expect(Object.keys(dump.sheets[0]!.widths)).toHaveLength(26);
    expect(Object.values(dump.sheets[0]!.widths).every((w) => w === 140)).toBe(true);
  });

  it('has numbers ExcelJS would read as billions where this reader sees text, and rows and cells beyond the sheet', async () => {
    const dump = async (cols: string) =>
      (await quick(rawXlsx({ Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>', { before: `<cols>${cols}</cols>` }) }))).dump.sheets[0]!;
    expect(Object.keys((await dump('<col min="1" max="2000000000x" width="20" customWidth="1"/>')).widths)).toHaveLength(26);
    expect(Object.keys((await dump('<col min="  1" max="4000000000" width="20" customWidth="1"/>')).widths)).toHaveLength(26);
    expect((await xlsxRefusal(rawXlsx({ Sheet1: sheetXml('<row r="4000000000"><c r="A1"><v>1</v></c></row>') }))).code).toBe('xml_invalid');
    expect((await xlsxRefusal(rawXlsx({ Sheet1: sheetXml('<row r="1"><c r="ZZZ1"><v>1</v></c></row>') }))).code).toBe('xml_invalid');
  });

  it('has a size no sheet could have, and a shared formula and an array formula that cover every cell', async () => {
    const { dump } = await quick(
      rawXlsx({
        Sheet1: sheetXml(
          '<row r="1" ht="1e300" customHeight="1"><c r="A1"><f t="shared" ref="A1:XFD1048576" si="0">1+1</f><v>2</v></c><c r="B1"><f t="array" ref="B1:XFD1048576">2+2</f><v>4</v></c></row>' +
            '<row r="2"><c r="A2"><f t="shared" si="0"/><v>2</v></c></row><row r="3" ht="Infinity"><c r="A3"><v>1</v></c></row>',
          { before: '<cols><col min="1" max="1" width="9999" customWidth="1"/><col min="2" max="2" width="-5" customWidth="1"/><col min="3" max="3" width="1e999" customWidth="1"/></cols>' }
        )
      })
    );
    const s = dump.sheets[0]!;
    expect(s.cells.A2!.f).toBe('=1+1');
    // Excel's tallest row and widest column, and no row or column of no size.
    expect(s.heights[0]).toBe(546);
    expect(s.heights[2]).toBeUndefined();
    expect(s.widths[0]).toBe(1785);
    expect(s.widths[1]).toBeUndefined();
    expect(s.widths[2]).toBeUndefined();
  });

  it('has a name that is every cell there is, and a formula that reaches the last row', async () => {
    const { dump, out } = await quick(
      rawXlsx(
        { Sheet1: sheetXml('<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>SUM(A1:A1048576)</f><v>1</v></c><c r="C1"><f>SUM(A2:A1048576)</f><v>7</v></c></row>') },
        { workbookExtra: '<definedNames><definedName name="Everything">Sheet1!$A$1:$XFD$1048576</definedName><definedName name="Column">Sheet1!$A$1:$A$1048576</definedName></definedNames>' }
      )
    );
    expect(dump.sheets[0]!.cells.B1!.f).toBe('=SUM(A:A)');
    // A formula that would have the sheet grow to a million rows keeps its value instead.
    expect(dump.sheets[0]!.cells.C1).toEqual({ v: 7 });
    expect(out.warnings.map((w) => w.code)).toContain('far');
    // Said as Excel says them, a name that is every cell is whole columns, which grow nothing.
    expect(dump.names).toEqual([
      { name: 'Column', scope: null, text: 'Sheet1!$A:$A' },
      { name: 'Everything', scope: null, text: 'Sheet1!$A:$XFD' }
    ]);
  });

  it('has links to places a person should never be sent, and none of them reaches the workbook', async () => {
    const { out } = await quick(
      rawXlsx(
        {
          Sheet1: sheetXml('<row r="1"><c r="A1" t="inlineStr"><is><t>click</t></is></c></row>', {
            after: '<hyperlinks><hyperlink ref="A1" r:id="rId1"/><hyperlink ref="A2" r:id="rId2"/><hyperlink ref="A3" r:id="rId3"/></hyperlinks>'
          })
        },
        {
          parts: {
            'xl/worksheets/_rels/sheet1.xml.rels':
              '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rId1" Type="x/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>' +
              '<Relationship Id="rId2" Type="x/hyperlink" Target="file:///etc/passwd" TargetMode="External"/>' +
              '<Relationship Id="rId3" Type="x/hyperlink" Target="data:text/html;base64,PHNjcmlwdD4=" TargetMode="External"/></Relationships>'
          }
        }
      )
    );
    const everything = JSON.stringify([...out.seed.cells]) + new TextDecoder('latin1').decode(out.seed.state);
    expect(everything).not.toMatch(/javascript|file:|data:text|etc\/passwd/i);
    expect(out.warnings.map((w) => w.message)).toContain('Links in 3 cells were left out.');
  });

  it('has a formula that fetches, and the engine makes no request while it is read', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = await readXlsx(
      await makeXlsx((wb) => {
        const ws = wb.addWorksheet('Sheet1');
        ws.getCell('A1').value = { formula: 'WEBSERVICE("http://evil.example/")', result: 'x' };
        ws.getCell('A2').value = { formula: 'HYPERLINK("javascript:alert(1)","go")', result: 'go' };
      })
    );
    expect(out.seed.cells.length).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('a csv', () => {
  it('is never a formula, whatever its fields begin with', () => {
    const dump = dumpWorkbook(readCsv(strToU8('=cmd|\' /C calc\'!A0,+1+1,@SUM(1),-2+3\n')).seed);
    for (const cell of Object.values(dump.sheets[0]!.cells)) expect(cell.f).toBeUndefined();
  });

  it('is written so that no field can be one when a spreadsheet opens it', () => {
    for (const hostile of ['=cmd|calc', '+cmd', '@cmd', '-cmd', '\tcmd', '\rcmd']) expect(fieldText(hostile, undefined).startsWith("'"), hostile).toBe(true);
  });

  it('stops at the rows, columns and cells a sheet can have', () => {
    expect(() => readCsv(strToU8('a,'.repeat(20_000)))).toThrowError(expect.objectContaining({ code: 'sheet_too_large' }));
    expect(() => readCsv(strToU8('x\n'.repeat(1_100_000)))).toThrowError(expect.objectContaining({ code: 'sheet_too_large' }));
  });
});

// ── a pptx ──────────────────────────────────────────────────────────────────

describe('a pptx', () => {
  const pptx = async () => ({ ...(await import('./pptx/read')), ...(await import('./pptx/testing')) });
  const refused = async (bytes: Uint8Array) => {
    const { readPptx } = await import('./pptx/read');
    return refusal(() => readPptx(bytes));
  };

  it('that is a zip bomb is refused on what its directory says, before anything is inflated', async () => {
    const bomb = zipSync({ 'ppt/slides/slide1.xml': new Uint8Array(MAX_UNZIPPED_BYTES + 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200_000);
    expect(await refused(bomb)).toMatchObject({ code: 'zip_limit', message: 'That file is too large to open.' });
  });

  it('that is not a presentation is told so in plain words', async () => {
    expect(await refused(strToU8('plain text pretending to be a presentation, long enough to pass a length test'))).toMatchObject({ code: 'not_pptx', message: 'That is not a presentation.' });
    expect(await refused(makeDocx({ body: p(r('a Word document')) }))).toMatchObject({ code: 'not_pptx' });
  });

  it('with a DOCTYPE anywhere is refused, and the file it names is never read', async () => {
    const { makePptx } = await pptx();
    const xxe = '<?xml version="1.0"?><!DOCTYPE s [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">&xxe;</p:sld>';
    const readSpy = vi.spyOn(globalThis, 'fetch');
    expect((await refused(makePptx({ slides: [''], files: { 'ppt/slides/slide1.xml': xxe } }))).code).toBe('xml_unsafe');
    const laughs = '<!ENTITY a "ha"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">';
    expect((await refused(makePptx({ slides: [''], files: { 'ppt/presentation.xml': `<!DOCTYPE p [${laughs}]><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">&c;</p:presentation>` } }))).code).toBe('xml_unsafe');
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('nested past anything a slide has is refused', async () => {
    const { makePptx } = await pptx();
    const deep = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${'<p:x>'.repeat(MAX_XML_DEPTH + 10)}${'</p:x>'.repeat(MAX_XML_DEPTH + 10)}</p:sld>`;
    expect((await refused(makePptx({ slides: [''], files: { 'ppt/slides/slide1.xml': deep } }))).code).toBe('zip_limit');
  });

  it('with too many parts is refused', async () => {
    const { makePptx } = await pptx();
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`ppt/media/${i}.png`] = new Uint8Array(1);
    expect((await refused(makePptx({ slides: [''], files }))).code).toBe('zip_limit');
  });

  it('with links to places a person should never be sent keeps none of them', async () => {
    const { makePptx, sp, readPptx } = await pptx();
    const targets = ['javascript:alert(1)', ' javascript:alert(2)', 'JAVASCRIPT:x', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.com', 'blob:https://example.com/x', 'about:blank', 'http://example.com/ok'];
    const body = targets.map((_, i) => `<a:p><a:r><a:rPr><a:hlinkClick r:id="rId${i + 5}"/></a:rPr><a:t>l${i}</a:t></a:r></a:p>`).join('');
    const out = readPptx(makePptx({ slides: [sp({ body })], slideRels: { 1: targets.map((target, i) => ({ id: `rId${i + 5}`, type: 'hyperlink', target, external: true })) } }));
    const all = JSON.stringify(out.deck);
    expect(all).not.toMatch(/javascript|vbscript|data:|file:|ftp:|blob:|about:/i);
    expect(all).toContain('http://example.com/ok');
    expect(out.warnings.join(' ')).toMatch(/9 links to places other than web and mail addresses were left out/);
  });

  it('with a relationship that points outside the file follows none of them', async () => {
    const { makePptx, readPptx } = await pptx();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const pic = (id: string) => `<p:pic><p:nvPicPr><p:cNvPr id="2" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${id}"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr></p:pic>`;
    const out = readPptx(
      makePptx({
        slides: [pic('rId5') + pic('rId6') + pic('rId7')],
        slideRels: { 1: [{ id: 'rId5', type: 'image', target: 'http://169.254.169.254/latest', external: true }, { id: 'rId6', type: 'image', target: '../../../../../../etc/passwd' }, { id: 'rId7', type: 'image', target: '/etc/shadow' }] }
      })
    );
    expect(out.deck.slides[0]!.elements).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with a picture that lies about its type: it is its bytes', async () => {
    const { makePptx, readPptx } = await pptx();
    const { PNG_1PX } = await import('./testing');
    const pic = (n: number) => `<p:pic><p:nvPicPr><p:cNvPr id="${n + 1}" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${n + 4}"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr></p:pic>`;
    const files = {
      'ppt/media/a.png': strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'ppt/media/b.png': strToU8('<html><script>alert(2)</script></html>'),
      'ppt/media/c.png': Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]),
      'ppt/media/d.svg': PNG_1PX
    };
    const out = readPptx(makePptx({ slides: [[1, 2, 3, 4].map(pic).join('')], slideRels: { 1: ['a.png', 'b.png', 'c.png', 'd.svg'].map((f, i) => ({ id: `rId${i + 5}`, type: 'image', target: `../media/${f}` })) }, files }));
    // Three are not pictures. The fourth is a PNG with a name that says otherwise, and is one.
    expect(out.deck.slides[0]!.elements.map((e) => (e as { asset: { mime: string } }).asset.mime)).toEqual(['image/png']);
    expect(JSON.stringify(out.deck)).not.toMatch(/script|alert/);
  });

  it('with dimensions that are not dimensions reads in no time, with numbers a slide can hold', async () => {
    const { makePptx, readPptx } = await pptx();
    const cols = Array.from({ length: 6000 }, () => '<a:gridCol w="9000000000000000"/>').join('');
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${cols}</a:tblGrid><a:tr h="9000000000000000"><a:tc gridSpan="2147483647"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const t0 = performance.now();
    const out = readPptx(makePptx({ slides: [table], size: { cx: 51206400, cy: 51206400 } }));
    expect(performance.now() - t0).toBeLessThan(2000);
    const el = out.deck.slides[0]!.elements[0] as { cols: number[]; rows: { h: number; cells: { colSpan?: number }[] }[]; w: number; h: number };
    expect(el.cols.length).toBeLessThanOrEqual(2500);
    expect(el.w).toBeLessThanOrEqual(2500 * 20000);
    expect(el.rows[0]!.h).toBeLessThanOrEqual(20000);
    expect(el.rows[0]!.cells[0]!.colSpan).toBeLessThanOrEqual(el.cols.length);
  });

  it('with fifty thousand shapes on a slide reads in under two seconds and keeps four hundred', async () => {
    const { makePptx, readPptx, sp } = await pptx();
    const shapes = Array.from({ length: 50_000 }, (_, i) => sp({ id: i + 2 })).join('');
    const t0 = performance.now();
    const out = readPptx(makePptx({ slides: [shapes] }));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(out.deck.slides[0]!.elements).toHaveLength(400);
  });

  it('with more text than a deck holds is refused, rather than made into a document the room would refuse', async () => {
    const { makePptx, sp, para } = await pptx();
    const slides = Array.from({ length: 5 }, () => sp({ body: para('x'.repeat(1_000_000)) }));
    expect((await refused(makePptx({ slides }))).code).toBe('deck_too_large');
  });

  it('as we write it, holds no link but a web or mail address and no character XML forbids', async () => {
    const { readPptx } = await pptx();
    const { writePptx } = await import('./pptx/write');
    const { unzipSync, strFromU8 } = await import('fflate');
    const text = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x\u0000y\u0008z', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] };
    const deck = {
      v: 1 as const,
      size: '16:9' as const,
      theme: { id: 't', name: 'T', colors: { dk1: '#000000', lt1: '#ffffff', dk2: '#000000', lt2: '#ffffff', accent1: '#000000', accent2: '#000000', accent3: '#000000', accent4: '#000000', accent5: '#000000', accent6: '#000000', hlink: '#000000' }, fonts: { major: 'Arial', minor: 'Arial' } },
      master: { elements: [], styles: { title: {}, body: [], other: {} } },
      layouts: [{ id: 'l', name: 'L', elements: [] }],
      slides: [{ layout: 'l', elements: [{ type: 'shape' as const, shape: 'rect' as const, x: 0, y: 0, w: 10, h: 10, text }] }]
    };
    const bytes = await writePptx(deck, async () => null);
    const all = Object.values(unzipSync(bytes)).map((v) => strFromU8(v)).join('');
    expect(all).not.toMatch(/javascript/);
    expect(JSON.stringify(readPptx(bytes).deck)).toContain('xyz');
  });
});
