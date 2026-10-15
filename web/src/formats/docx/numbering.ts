/**
 * Numbering: which list a paragraph is in, at what level, and how the level counts.
 *
 * `w:num` is a list instance and points at a `w:abstractNum` that defines nine levels.
 * Only what the editor can draw is kept: bullet or numbered, the numbering style of a
 * numbered level (1. a. i.), where the count starts, and whether the list is the legal
 * kind (1., 1.1., 1.1.1.). Indents, tab stops and the bullet glyph are the editor's.
 */

import { child, childrenNamed, type XNode } from '../xml';

export type NumFormat = 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';

export interface LevelInfo {
  bullet: boolean;
  format: NumFormat;
  start: number;
  /** The level's text mentions an outer level: `%1.%2`. */
  legal: boolean;
  /** Left indent, in twips, of the level's paragraphs. How far a list sits in is how deep it is. */
  indent: number;
}

const FORMATS: Record<string, NumFormat> = {
  decimal: 'decimal',
  decimalZero: 'decimal',
  lowerLetter: 'lowerLetter',
  upperLetter: 'upperLetter',
  lowerRoman: 'lowerRoman',
  upperRoman: 'upperRoman'
};

const DEFAULT_LEVEL: LevelInfo = { bullet: true, format: 'decimal', start: 1, legal: false, indent: 0 };

export class Numbering {
  private readonly abstract = new Map<string, Map<number, LevelInfo>>();
  private readonly nums = new Map<string, { abstractId: string; overrides: Map<number, LevelInfo> }>();

  constructor(root: XNode | null) {
    if (!root) return;
    for (const a of childrenNamed(root, 'w:abstractNum')) {
      const id = a.attrs['w:abstractNumId'];
      if (id === undefined) continue;
      const levels = new Map<number, LevelInfo>();
      for (const l of childrenNamed(a, 'w:lvl')) {
        const ilvl = Number(l.attrs['w:ilvl']);
        if (Number.isInteger(ilvl)) levels.set(ilvl, levelOf(l));
      }
      this.abstract.set(id, levels);
    }
    for (const n of childrenNamed(root, 'w:num')) {
      const numId = n.attrs['w:numId'];
      const abstractId = child(n, 'w:abstractNumId')?.attrs['w:val'];
      if (numId === undefined || abstractId === undefined) continue;
      const overrides = new Map<number, LevelInfo>();
      for (const o of childrenNamed(n, 'w:lvlOverride')) {
        const ilvl = Number(o.attrs['w:ilvl']);
        const start = child(o, 'w:startOverride')?.attrs['w:val'];
        const lvl = child(o, 'w:lvl');
        if (!Number.isInteger(ilvl)) continue;
        if (lvl) overrides.set(ilvl, levelOf(lvl));
        else if (start !== undefined) {
          const base = this.abstract.get(abstractId)?.get(ilvl) ?? DEFAULT_LEVEL;
          overrides.set(ilvl, { ...base, start: Number(start) || 1 });
        }
      }
      this.nums.set(numId, { abstractId, overrides });
    }
  }

  /** The level a paragraph with this `numId` and `ilvl` is at, or null if `numId` is not a list. */
  level(numId: string, ilvl: number): LevelInfo | null {
    if (numId === '0') return null;
    const n = this.nums.get(numId);
    if (!n) return null;
    return n.overrides.get(ilvl) ?? this.abstract.get(n.abstractId)?.get(ilvl) ?? DEFAULT_LEVEL;
  }
}

function levelOf(l: XNode): LevelInfo {
  const fmt = child(l, 'w:numFmt')?.attrs['w:val'] ?? 'decimal';
  const text = child(l, 'w:lvlText')?.attrs['w:val'] ?? '';
  const start = Number(child(l, 'w:start')?.attrs['w:val']);
  const bullet = fmt === 'bullet' || fmt === 'none';
  return {
    bullet,
    format: FORMATS[fmt] ?? 'decimal',
    start: Number.isInteger(start) && start >= 0 ? start : 1,
    legal: !bullet && /%\d.*%\d/.test(text),
    indent: Number(child(child(l, 'w:pPr'), 'w:ind')?.attrs['w:left'] ?? child(child(l, 'w:pPr'), 'w:ind')?.attrs['w:start']) || 0
  };
}
