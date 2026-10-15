/**
 * An XML part of a pptx, parsed with `../xml.ts` and its element names made readable.
 *
 * `parseXml` knows the prefixes of Word, the shared drawing namespace and the package's own.
 * PresentationML, charts, diagrams and Microsoft's extensions it leaves as `{uri}local`, which no
 * one can write a reader against. `parsePart` renames them to the usual prefixes (`p`, `c`,
 * `dgm`, `p14`) once, after the parse, so a reader says `child(sp, 'p:spPr')` and a file in the
 * strict namespaces reads the same as one in the transitional ones. Nothing here relaxes
 * `parseXml`'s refusals: the DOCTYPE, the entity, the depth and the element caps are its own.
 *
 * The SmartArt drawing part (`dsp:`) is renamed to `p:` as well. Its shapes (`dsp:sp`,
 * `dsp:spPr`, `dsp:txBody`) are twins of PresentationML's, so the same reader draws both.
 */

import { parseXml, type XNode } from '../xml';

const NAMESPACES: Record<string, string> = {
  'http://schemas.openxmlformats.org/presentationml/2006/main': 'p',
  'http://purl.oclc.org/ooxml/presentationml/main': 'p',
  'http://schemas.openxmlformats.org/drawingml/2006/chart': 'c',
  'http://purl.oclc.org/ooxml/drawingml/chart': 'c',
  'http://schemas.openxmlformats.org/drawingml/2006/diagram': 'dgm',
  'http://purl.oclc.org/ooxml/drawingml/diagram': 'dgm',
  'http://schemas.microsoft.com/office/drawing/2008/diagram': 'p',
  'http://schemas.microsoft.com/office/powerpoint/2010/main': 'p14',
  'http://schemas.microsoft.com/office/powerpoint/2012/main': 'p15',
  'http://schemas.microsoft.com/office/drawing/2010/main': 'a14',
  'http://schemas.microsoft.com/office/drawing/2016/SVG/main': 'asvg',
  'http://schemas.openxmlformats.org/drawingml/2006/chartDrawing': 'cdr',
  'http://schemas.microsoft.com/office/drawing/2014/chartex': 'cx'
};

const QUALIFIED = /^\{([^}]*)\}(.*)$/;
const renamed = new Map<string, string>();

/** A name `parseXml` could not give a prefix to, as `p:sp`. Names it did are left alone, at the cost of a character test. */
function rename(name: string): string {
  if (name.charCodeAt(0) !== 123 /* { */) return name;
  let out = renamed.get(name);
  if (out === undefined) {
    const m = QUALIFIED.exec(name);
    const prefix = m ? NAMESPACES[m[1]!] : undefined;
    out = m && prefix ? `${prefix}:${m[2]}` : name;
    if (renamed.size < 4096) renamed.set(name, out);
  }
  return out;
}

function renameTree(n: XNode): void {
  n.name = rename(n.name);
  let dirty = false;
  for (const key in n.attrs) {
    if (key.charCodeAt(0) === 123 /* { */) {
      dirty = true;
      break;
    }
  }
  if (dirty) {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.attrs)) next[rename(k)] = v;
    n.attrs = next;
  }
  for (const c of n.children) if (typeof c !== 'string') renameTree(c);
}

/** The part as a tree. Throws `FormatError` as `parseXml` does. */
export function parsePart(source: Uint8Array | string): XNode {
  const root = parseXml(source);
  renameTree(root);
  return root;
}

// ── reading values ──────────────────────────────────────────────────────────

export const attr = (n: XNode | null | undefined, name: string): string | undefined => n?.attrs[name];

/** An integer attribute, or `fallback`. Floats are cut, anything that is not a finite number is the fallback. */
export function int(n: XNode | null | undefined, name: string, fallback: number): number {
  const v = n?.attrs[name];
  if (v === undefined || v === '') return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

/** OOXML booleans: `1`, `true`, `0`, `false`. `undefined` when the attribute is absent. */
export function flag(n: XNode | null | undefined, name: string): boolean | undefined {
  const v = n?.attrs[name];
  if (v === undefined) return undefined;
  return v === '1' || v === 'true' || v === 'on';
}

/** A table lookup that finds only the table's own keys: a file's `constructor` or `__proto__` is not one. */
export function pick<V>(table: Readonly<Record<string, V>>, key: string | undefined): V | undefined {
  return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}
