/**
 * The speaker notes as the presenter's window reads them: lines with their emphasis and their
 * bullets, as text, because the speaker needs the words and not the slide's type. Pure, over the
 * `TextDoc` the model hands back (a notes fragment is the same schema as a shape's text).
 */

import type { TextDoc, TextNode } from '../model/deck';

export interface NoteRun {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
}

export interface NoteLine {
  runs: NoteRun[];
  /** What is drawn before the text: a bullet character or a number. */
  bullet: string | null;
  /** 0 to 8. */
  level: number;
}

const MAX_LEVEL = 8;

function runsOf(nodes: readonly TextNode[] | undefined): NoteRun[] {
  const out: NoteRun[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push({ text: '\n' });
      continue;
    }
    if (typeof n.text !== 'string' || !n.text) continue;
    const run: NoteRun = { text: n.text };
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') run.bold = true;
      else if (m.type === 'italic') run.italic = true;
      else if (m.type === 'underline') run.underline = true;
      else if (m.type === 'strike') run.strike = true;
    }
    out.push(run);
  }
  return out;
}

const levelOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(MAX_LEVEL, Math.round(v))) : 0);

/** The lines of a notes body, the way they are read aloud. A paragraph with no text is a blank line. */
export function noteLines(doc: TextDoc | null | undefined): NoteLine[] {
  const counters: (number | null)[] = [];
  const lines: NoteLine[] = [];
  for (const p of doc?.content ?? []) {
    if (p.type !== 'paragraph') continue;
    const level = levelOf(p.attrs?.level);
    counters.length = Math.min(counters.length, level + 1);
    const runs = runsOf(p.content);
    const empty = runs.every((r) => !r.text.trim());
    const b = p.attrs?.bullet as { kind?: unknown; char?: unknown } | null | undefined;
    let bullet: string | null = null;
    if (!empty && b && typeof b === 'object') {
      if (b.kind === 'char' && typeof b.char === 'string' && b.char) {
        bullet = b.char.slice(0, 4);
        counters[level] = null;
      } else if (b.kind === 'number') {
        const n = (counters[level] ?? 0) + 1;
        counters[level] = n;
        bullet = `${n}.`;
      } else counters[level] = null;
    } else if (!empty) counters[level] = null;
    lines.push({ runs, bullet, level });
  }
  while (lines.length && lines[lines.length - 1]!.runs.every((r) => !r.text.trim())) lines.pop();
  return lines;
}
