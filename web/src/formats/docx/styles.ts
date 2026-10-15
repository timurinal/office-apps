/**
 * Styles: the document's defaults and its named styles, resolved down their `basedOn` chains.
 *
 * The editor has a fixed set of paragraph styles (Normal, No spacing, Title, Subtitle,
 * Heading 1 to 6, Quote, Code), so a docx style is *classified* into one of them by
 * name, by what it is based on, or by its outline level. A style that is none of those
 * (a company's "Body text 2") is Normal that looks a certain way, and its look is baked
 * into the paragraphs that use it, because the editor has nowhere to keep a style
 * definition.
 */

import { child, childrenNamed, elements, type XNode } from '../xml';
import { merge, parsePPr, parseRPr, type ParaProps, type RunProps, type ThemeFonts } from './props';

export type BlockClass =
  | { kind: 'normal' }
  | { kind: 'title' }
  | { kind: 'subtitle' }
  | { kind: 'nospacing' }
  | { kind: 'quote' }
  | { kind: 'code' }
  | { kind: 'heading'; level: number };

interface RawStyle {
  id: string;
  name: string;
  type: string;
  basedOn: string | null;
  isDefault: boolean;
  pPr: ParaProps;
  rPr: RunProps;
  outline: number | undefined;
}

const KEY = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Names (with spaces and case stripped) that mean one of the editor's styles. */
function classifyName(raw: string): BlockClass | null {
  const k = KEY(raw);
  const heading = /^heading([1-9])$/.exec(k);
  if (heading) return { kind: 'heading', level: Math.min(6, Number(heading[1])) };
  switch (k) {
    case 'normal':
      return { kind: 'normal' };
    case 'title':
      return { kind: 'title' };
    case 'subtitle':
      return { kind: 'subtitle' };
    case 'nospacing':
      return { kind: 'nospacing' };
    case 'quote':
    case 'intensequote':
    case 'blocktext':
      return { kind: 'quote' };
    case 'code':
    case 'sourcecode':
    case 'htmlcode':
    case 'htmlpreformatted':
    case 'preformattedtext':
    case 'verbatim':
      return { kind: 'code' };
    default:
      return null;
  }
}

export class StyleSheet {
  readonly byId = new Map<string, RawStyle>();
  defaultPara: string | null = null;
  readonly docRun: RunProps;
  readonly docPara: ParaProps;

  constructor(
    root: XNode | null,
    theme: ThemeFonts
  ) {
    const defaults = root ? child(root, 'w:docDefaults') : null;
    this.docRun = parseRPr(child(child(defaults, 'w:rPrDefault'), 'w:rPr'), theme);
    this.docPara = parsePPr(child(child(defaults, 'w:pPrDefault'), 'w:pPr'));
    if (!root) return;
    for (const s of childrenNamed(root, 'w:style')) {
      const id = s.attrs['w:styleId'];
      if (!id) continue;
      const pPr = child(s, 'w:pPr');
      this.byId.set(id, {
        id,
        name: child(s, 'w:name')?.attrs['w:val'] ?? id,
        type: s.attrs['w:type'] ?? 'paragraph',
        basedOn: child(s, 'w:basedOn')?.attrs['w:val'] ?? null,
        isDefault: s.attrs['w:default'] === '1' || s.attrs['w:default'] === 'true',
        pPr: parsePPr(pPr),
        rPr: parseRPr(child(s, 'w:rPr'), theme),
        outline: parsePPr(pPr).outline
      });
      if ((s.attrs['w:type'] ?? 'paragraph') === 'paragraph' && (s.attrs['w:default'] === '1' || s.attrs['w:default'] === 'true')) {
        this.defaultPara = id;
      }
    }
  }

  /** A style and the styles it is based on, base first. A cycle ends where it closes. */
  chain(id: string | null | undefined): RawStyle[] {
    const out: RawStyle[] = [];
    const seen = new Set<string>();
    let cur = id ? this.byId.get(id) : undefined;
    while (cur && !seen.has(cur.id) && out.length < 32) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.basedOn ? this.byId.get(cur.basedOn) : undefined;
    }
    return out;
  }

  /** Which of the editor's styles a paragraph style is, going up the chain until one is recognised. */
  classify(styleId: string | null | undefined): BlockClass {
    const id = styleId ?? this.defaultPara;
    const chain = this.chain(id).reverse();
    for (const s of chain) {
      const byId = classifyName(s.id) ?? classifyName(s.name);
      if (byId) return byId;
    }
    // A custom style that carries an outline level is a heading to the navigation pane.
    for (const s of chain) {
      if (s.outline !== undefined && s.outline >= 0 && s.outline <= 5) return { kind: 'heading', level: s.outline + 1 };
    }
    return { kind: 'normal' };
  }

  /** Run properties of a paragraph style chain (not the document defaults). */
  paragraphRun(id: string | null | undefined): RunProps {
    return this.chain(id ?? this.defaultPara).reduce<RunProps>((acc, s) => merge(acc, s.rPr), {});
  }

  /** Paragraph properties of a paragraph style chain (not the document defaults). */
  paragraphProps(id: string | null | undefined): ParaProps {
    return this.chain(id ?? this.defaultPara).reduce<ParaProps>((acc, s) => merge(acc, s.pPr), {});
  }

  /** Run properties of a character style chain. */
  characterRun(id: string | null | undefined): RunProps {
    return this.chain(id).reduce<RunProps>((acc, s) => merge(acc, s.rPr), {});
  }

  /** The family of the Normal style: what plain text in this document is set in. */
  normalFont(): string | null {
    return merge(this.docRun, this.paragraphRun(null)).font ?? null;
  }
}

/** The theme's two font families, or nulls when there is no theme part. */
export function themeFonts(root: XNode | null): ThemeFonts {
  const out: ThemeFonts = { major: null, minor: null };
  if (!root) return out;
  const scheme = findDeep(root, 'a:fontScheme');
  if (!scheme) return out;
  const latin = (which: 'a:majorFont' | 'a:minorFont'): string | null => {
    const face = child(child(scheme, which), 'a:latin')?.attrs.typeface;
    return face ? face : null;
  };
  out.major = latin('a:majorFont');
  out.minor = latin('a:minorFont');
  return out;
}

function findDeep(n: XNode, name: string): XNode | null {
  if (n.name === name) return n;
  for (const c of elements(n)) {
    const f = findDeep(c, name);
    if (f) return f;
  }
  return null;
}
