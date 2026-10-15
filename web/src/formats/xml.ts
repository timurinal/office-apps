/**
 * XML, read safely, into a small tree.
 *
 * Office's XML is plain and well-formed, so the parser is `saxes` (a conformant SAX parser,
 * ISC) and the tree is what the readers walk. What is refused is as much the point as what
 * is read:
 *
 *   · A DOCTYPE, of any kind. Entities are declared in a DTD, so with no DTD there is no
 *     entity to expand (billion laughs) and no external one to fetch (XXE). Word writes
 *     neither; a file that has one is not Word's. The check runs on the text before the
 *     parser sees it, and again on the parser's own event, because the first is a shortcut
 *     and the second is the guarantee.
 *   · Entity references other than the five predefined and numeric ones. saxes reports
 *     them as errors; they are not looked up anywhere.
 *   · Depth and element counts past a bound: the tree is walked recursively and held in
 *     memory.
 *
 * Nothing here fetches anything. A relationship that names an external target is data for
 * the reader to look at and drop.
 *
 * Namespaces are resolved, then renamed to the usual prefixes (`w`, `r`, `wp`, `a`, `pic`)
 * so a file that binds `w:` to another prefix, or uses the strict namespaces, reads the same.
 */

import { SaxesParser } from 'saxes';
import { FormatError } from './errors';
import { MAX_XML_BYTES, MAX_XML_DEPTH, MAX_XML_ELEMENTS } from './limits';

export interface XNode {
  /** `w:p`: the canonical prefix and the local name. An element in no namespace is its local name. */
  name: string;
  /** Attributes by the same naming: `w:val`, `r:id`, `xml:space`, `Target`. */
  attrs: Record<string, string>;
  /** Child elements, and text where an element's text matters. */
  children: (XNode | string)[];
  parent: XNode | null;
}

/** Namespace URI to the prefix this code uses. Anything not listed keeps its URI. */
const PREFIXES: Record<string, string> = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'rel',
  'http://schemas.openxmlformats.org/package/2006/content-types': 'ct',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'pic',
  'http://purl.oclc.org/ooxml/drawingml/picture': 'pic',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'wp',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing': 'wp',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape': 'wps',
  'http://schemas.microsoft.com/office/word/2010/wordml': 'w14',
  'http://schemas.microsoft.com/office/word/2012/wordml': 'w15',
  'http://schemas.microsoft.com/office/word/2018/wordml': 'w16',
  'http://schemas.microsoft.com/office/word/2018/wordml/cex': 'w16cex',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'urn:schemas-microsoft-com:vml': 'v',
  'urn:schemas-microsoft-com:office:office': 'o',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/terms/': 'dcterms',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'cp',
  'http://www.w3.org/XML/1998/namespace': 'xml'
};

const KEEP_TEXT_IN = new Set(['w:t', 'w:delText', 'w:instrText', 'w:delInstrText', 'a:t', 'dc:title', 'dcterms:created', 'dcterms:modified', 'm:t', 'v:textpath']);

const DOCTYPE = /<!\s*(?:DOCTYPE|ENTITY)/i;

/** UTF-8, or UTF-16 where there is a byte order mark. A BOM is not text. */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseXml(source: string | Uint8Array): XNode {
  const bytes = typeof source === 'string' ? source.length : source.length;
  if (bytes > MAX_XML_BYTES) throw new FormatError('zip_limit', `xml part of ${bytes} bytes`);
  const input = typeof source === 'string' ? source : decodeXml(source);
  // The shortcut: no DTD, no entities. A false positive needs the literal `<!DOCTYPE` in a
  // comment or a CDATA section, and a document that has one there is refused too, harmlessly.
  if (DOCTYPE.test(input)) throw new FormatError('xml_unsafe', 'DOCTYPE or ENTITY declaration');

  const root: XNode = { name: '#document', attrs: {}, children: [], parent: null };
  let cur = root;
  let depth = 0;
  let count = 0;

  const parser = new SaxesParser({ xmlns: true, position: false });
  let failure: FormatError | null = null;
  const fail = (err: FormatError) => {
    failure ??= err;
  };

  const nameOf = (uri: string, local: string): string => {
    if (!uri) return local;
    const p = PREFIXES[uri];
    return p ? `${p}:${local}` : `{${uri}}${local}`;
  };

  parser.on('doctype', () => fail(new FormatError('xml_unsafe', 'DOCTYPE event')));
  parser.on('error', (e) => fail(new FormatError('xml_invalid', e.message)));
  parser.on('opentag', (tag) => {
    if (failure) return;
    if (++count > MAX_XML_ELEMENTS) return fail(new FormatError('zip_limit', 'too many elements'));
    if (++depth > MAX_XML_DEPTH) return fail(new FormatError('zip_limit', 'nested too deeply'));
    const attrs: Record<string, string> = {};
    for (const a of Object.values(tag.attributes)) {
      // Namespace declarations are not data.
      if (a.prefix === 'xmlns' || a.name === 'xmlns') continue;
      attrs[nameOf(a.uri, a.local)] = a.value;
    }
    const node: XNode = { name: nameOf(tag.uri, tag.local), attrs, children: [], parent: cur };
    cur.children.push(node);
    cur = node;
  });
  parser.on('closetag', () => {
    if (failure) return;
    depth--;
    if (cur.parent) cur = cur.parent;
  });
  const onText = (t: string) => {
    if (failure || cur === root) return;
    if (t.trim() === '' && !KEEP_TEXT_IN.has(cur.name)) return;
    const last = cur.children[cur.children.length - 1];
    if (typeof last === 'string') cur.children[cur.children.length - 1] = last + t;
    else cur.children.push(t);
  };
  parser.on('text', onText);
  parser.on('cdata', onText);

  try {
    parser.write(input).close();
  } catch (err) {
    fail(err instanceof FormatError ? err : new FormatError('xml_invalid', String(err)));
  }
  if (failure) throw failure;
  const top = root.children.find((c): c is XNode => typeof c !== 'string');
  if (!top) throw new FormatError('xml_invalid', 'no root element');
  return top;
}

// ── walking ─────────────────────────────────────────────────────────────────

export const elements = (n: XNode): XNode[] => n.children.filter((c): c is XNode => typeof c !== 'string');

/** The first child element with this name. */
export const child = (n: XNode | null | undefined, name: string): XNode | null =>
  n ? (elements(n).find((c) => c.name === name) ?? null) : null;

export const childrenNamed = (n: XNode | null | undefined, name: string): XNode[] => (n ? elements(n).filter((c) => c.name === name) : []);

/** The text directly inside an element. */
export const textContent = (n: XNode): string => n.children.filter((c): c is string => typeof c === 'string').join('');

/** Every descendant element with this name, in document order. */
export function descendants(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of elements(n)) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
