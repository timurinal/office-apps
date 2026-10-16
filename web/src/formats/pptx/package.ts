/**
 * The Open Packaging layer of a pptx: which parts there are and what each points at.
 *
 * The same shape as `docx/package.ts` and for the same reasons: nothing is inflated before the
 * directory has been counted, an external target is data and never something to open, and a
 * relationship that climbs out of the package stays inside it. What differs is what is worth
 * inflating. A presentation carries video, audio, embedded workbooks and fonts that run to
 * hundreds of megabytes; none is read, so none is inflated. Pictures are inflated whatever they
 * are called, because a picture is what its bytes say it is.
 */

import { FormatError } from '../errors';
import { openZip, type Zip } from '../zip';
import { elements, type XNode } from '../xml';
import { resolveTarget, type Rel } from '../docx/package';
import { parsePart } from './part';

export { resolveTarget, type Rel };

/** What is not read: embedded objects and fonts, custom XML, ink, printer settings, and anything that is plainly media. */
const SKIPPED =
  /^(?:ppt\/(?:embeddings|fonts|activeX|ink|printerSettings|tags|revisionInfo|comments|authors)\b|customXml\/|docProps\/thumbnail)|\.(?:bin|odttf|fntdata|ttf|otf|mp4|m4v|mov|wmv|avi|mpg|mpeg|webm|mkv|mp3|m4a|wav|wma|ogg|oga|aac|flac|vbaProject)$/i;

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export class PptxPackage {
  private readonly parsed = new Map<string, XNode | null>();

  private constructor(private readonly zip: Zip) {}

  /**
   * Throws `zip_limit` past the limits, `unsupported` for a compound file (a binary .ppt, or a presentation with a
   * password, which Office keeps in one) and `not_pptx` when the bytes are not a zip at all.
   */
  static open(bytes: Uint8Array): PptxPackage {
    if (bytes.length > 8 && OLE.every((v, i) => bytes[i] === v)) throw new FormatError('unsupported', 'a compound file');
    try {
      return new PptxPackage(openZip(bytes, (name) => !SKIPPED.test(name)));
    } catch (e) {
      if (e instanceof FormatError && e.code === 'not_docx') throw new FormatError('not_pptx', e.detail);
      throw e;
    }
  }

  get names(): string[] {
    return this.zip.names;
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
    const node = raw ? parsePart(raw) : null;
    this.parsed.set(path, node);
    return node;
  }

  /** The part, or null when it is missing or cannot be parsed. A refused file (DOCTYPE, limits) still throws. */
  tryXml(path: string): XNode | null {
    try {
      return this.xml(path);
    } catch (e) {
      if (e instanceof FormatError && e.code === 'xml_invalid') {
        this.parsed.set(path, null);
        return null;
      }
      throw e;
    }
  }

  /** The relationships of a part, by id. */
  rels(part: string): Map<string, Rel> {
    const slash = part.lastIndexOf('/');
    const dir = slash < 0 ? '' : part.slice(0, slash + 1);
    return this.relsAt(`${dir}_rels/${part.slice(slash + 1)}.rels`);
  }

  private relsAt(path: string): Map<string, Rel> {
    const out = new Map<string, Rel>();
    const root = this.tryXml(path);
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

  /** The presentation part: `_rels/.rels` names it, and `ppt/presentation.xml` is where it always is. */
  mainPart(): string {
    const rels = this.relsAt('_rels/.rels');
    const main = [...rels.values()].find((r) => r.type === 'officeDocument' && !r.external);
    const path = main ? resolveTarget('', main.target) : 'ppt/presentation.xml';
    if (!this.zip.has(path)) throw new FormatError('not_pptx', `no presentation at ${path}`);
    return path;
  }

  /** `dc:title` from the document properties. */
  coreTitle(): string | null {
    const core = this.tryXml('docProps/core.xml');
    if (!core) return null;
    for (const c of elements(core)) {
      if (c.name !== 'dc:title') continue;
      const v = c.children.find((x): x is string => typeof x === 'string')?.trim();
      return v ? v : null;
    }
    return null;
  }
}
