/**
 * The Open Packaging layer of a docx: which part is the document, and what each part
 * points at.
 *
 * A docx is a zip of XML parts joined by relationships. `_rels/.rels` names the main part;
 * each part's own `_rels/<name>.rels` names its styles, numbering, images, headers and
 * links. Targets are paths relative to the part that holds the relationship, or absolute
 * from the zip root, or (for a link) an external address. An external target is only ever
 * data here: it is a hyperlink's href, to be checked, never a thing to open.
 */

import { FormatError } from '../errors';
import { openZip, type Zip } from '../zip';
import { child, elements, parseXml, type XNode } from '../xml';

export interface Rel {
  id: string;
  /** The last path segment of the relationship type: `image`, `hyperlink`, `styles`. */
  type: string;
  target: string;
  external: boolean;
}

/** What is worth inflating. Embedded fonts, objects and custom XML are not read. */
const WANTED = (name: string): boolean =>
  !/^word\/(?:embeddings|fonts|activeX)\//i.test(name) && !/^customXml\//i.test(name) && !/\.(?:bin|odttf|ttf|otf)$/i.test(name);

export class Package {
  private readonly parsed = new Map<string, XNode | null>();

  private constructor(private readonly zip: Zip) {}

  static open(bytes: Uint8Array): Package {
    return new Package(openZip(bytes, WANTED));
  }

  /** The main document part, normally `word/document.xml`. */
  mainPart(): string {
    const rels = this.relsOfPath('_rels/.rels');
    const main = [...rels.values()].find((r) => r.type === 'officeDocument' && !r.external);
    const path = main ? resolveTarget('', main.target) : 'word/document.xml';
    if (!this.zip.has(path)) throw new FormatError('not_docx', `no main part at ${path}`);
    return path;
  }

  has(path: string): boolean {
    return this.zip.has(path);
  }

  bytes(path: string): Uint8Array | null {
    return this.zip.read(path);
  }

  /** A part as XML, or null if it is not in the package. A part that is there and is not XML throws. */
  xml(path: string): XNode | null {
    if (this.parsed.has(path)) return this.parsed.get(path) ?? null;
    const raw = this.zip.read(path);
    const node = raw ? parseXml(raw) : null;
    this.parsed.set(path, node);
    return node;
  }

  /** The relationships of a part, by id. */
  rels(part: string): Map<string, Rel> {
    const slash = part.lastIndexOf('/');
    const dir = slash < 0 ? '' : part.slice(0, slash + 1);
    return this.relsOfPath(`${dir}_rels/${part.slice(slash + 1)}.rels`);
  }

  private relsOfPath(path: string): Map<string, Rel> {
    const out = new Map<string, Rel>();
    const root = this.xml(path);
    if (!root) return out;
    for (const r of elements(root)) {
      if (r.name !== 'rel:Relationship') continue;
      const id = r.attrs.Id;
      const target = r.attrs.Target;
      if (!id || target === undefined) continue;
      out.set(id, {
        id,
        type: (r.attrs.Type ?? '').split('/').pop() ?? '',
        target,
        external: r.attrs.TargetMode === 'External'
      });
    }
    return out;
  }

  /** The part a relationship in `part` points at, or null for an external one. */
  target(part: string, rel: Rel | undefined): string | null {
    if (!rel || rel.external) return null;
    const slash = part.lastIndexOf('/');
    return resolveTarget(slash < 0 ? '' : part.slice(0, slash + 1), rel.target);
  }

  /** Document properties: only the title is read. */
  coreTitle(): string | null {
    const core = this.xml('docProps/core.xml');
    const t = core ? child(core, 'dc:title') : null;
    const v = t?.children.find((c): c is string => typeof c === 'string')?.trim();
    return v ? v : null;
  }
}

/** `../media/a.png` from `word/` is `media/a.png` from the root. Never climbs above it. */
export function resolveTarget(dir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${dir}${target}`).replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}
