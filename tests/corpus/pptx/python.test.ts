/**
 * A reader that is not ours opens what we export.
 *
 * Every deck of the corpus is read, written back out, and the pptx written to `out/` beside a
 * `<name>.check.json` saying what our reader found in the file that was exported. `generate/check_pptx.py`
 * then opens every one with python-pptx, a separate implementation of the format, and reports where
 * what it sees differs, where a relationship points at nothing, and where a part has no content type;
 * this test fails on anything it reports.
 *
 * It needs python-pptx, so it looks for an interpreter that has it:
 *
 *     CORPUS_PYTHON=/path/to/python    an interpreter with python-pptx installed, or
 *     tests/corpus/.venv               python3 -m venv tests/corpus/.venv
 *                                      tests/corpus/.venv/bin/pip install python-pptx
 *
 * Without either, the test says it was skipped and why. It never passes by not running.
 *
 * Neither PowerPoint nor LibreOffice is installed on the machine this was written on, so no file was
 * rendered: nothing here says what a slide looks like, only that the file is sound and says what it should.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AssetRef, ElementJSON } from '../../../web/src/slides/model/deck';
import { readPptx } from '../../../web/src/formats/pptx/read';
import { PAGE_EMU } from '../../../web/src/formats/pptx/units';
import { writePptx } from '../../../web/src/formats/pptx/write';
import { DIR, OUT_DIR, bytesOf, listDecks, plain, textOf } from './helpers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function interpreter(): string | null {
  const candidates = [process.env.CORPUS_PYTHON, join(ROOT, 'tests', 'corpus', '.venv', 'bin', 'python'), join(ROOT, 'tests', 'corpus', '.venv', 'Scripts', 'python.exe')];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const getAsset = async (ref: AssetRef) => (ref.data ? { bytes: decode(ref.data), mime: ref.mime ?? 'image/png' } : null);

interface Span {
  r: number;
  c: number;
  rs: number;
  cs: number;
  merged: boolean;
}

interface Check {
  kind: string;
  ph?: string;
  text: string | null;
  box: number[];
  rot?: number;
  children?: Check[];
  table?: { rows: number; cols: number; texts: string[][]; spans: Span[] };
  chart?: { chart: string; categories: string[]; series: { name: string; values: number[] }[] };
  image?: { mime: string; crop?: { l: number; t: number; r: number; b: number } };
}

function checkOf(e: ElementJSON, slide: number): Check {
  const text = textOf(e)?.replaceAll('‹#›', String(slide)) ?? null;
  const out: Check = { kind: e.type, text, box: [e.x, e.y, e.w, e.h] };
  if ('ph' in e && e.ph) out.ph = e.ph.type;
  if (e.rot) out.rot = e.rot;
  if (e.type === 'group') out.children = e.children.map((c) => checkOf(c, slide));
  if (e.type === 'table') {
    out.table = {
      rows: e.rows.length,
      cols: e.cols.length,
      texts: e.rows.map((r) => r.cells.map((c) => (c.merged ? '' : plain(c.text)))),
      spans: e.rows.flatMap((r, ri) => r.cells.flatMap((c, ci): Span[] => (c.merged ? [{ r: ri, c: ci, rs: 1, cs: 1, merged: true }] : c.rowSpan || c.colSpan ? [{ r: ri, c: ci, rs: c.rowSpan ?? 1, cs: c.colSpan ?? 1, merged: false }] : [])))
    };
  }
  if (e.type === 'chart') out.chart = { chart: e.chart, categories: e.categories, series: e.series.map((s) => ({ name: s.name, values: s.values })) };
  if (e.type === 'image') out.image = { mime: e.asset.mime ?? '', ...(e.crop ? { crop: e.crop } : {}) };
  return out;
}

describe('python-pptx opens everything we export', () => {
  it('opens every corpus deck after a round trip, and finds in it what our reader found', async (ctx) => {
    const python = interpreter();
    if (!python) return ctx.skip('skipped: no interpreter with python-pptx (set CORPUS_PYTHON, or make tests/corpus/.venv as the header of this file says)');

    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    const files = listDecks();
    for (const name of files) {
      const first = readPptx(bytesOf(join(DIR, name)));
      const bytes = await writePptx(first.deck, getAsset, { title: name });
      writeFileSync(join(OUT_DIR, name), bytes);
      // What our reader finds in the file we wrote: not what the original said, which another test compares.
      const again = readPptx(bytes).deck;
      const page = PAGE_EMU[again.size];
      const names = new Map(again.layouts.map((l) => [l.id, l.name]));
      const check = {
        emuPerPx: page.cx / 1920,
        size: page,
        layouts: again.layouts.map((l) => l.name),
        slides: again.slides.map((s, i) => ({
          layout: names.get(s.layout),
          hidden: s.hidden === true,
          notes: s.notes ? plain(s.notes) : null,
          elements: s.elements.map((e) => checkOf(e, i + 1))
        }))
      };
      writeFileSync(join(OUT_DIR, name.replace(/\.pptx$/, '.check.json')), JSON.stringify(check));
    }

    let stdout = '';
    try {
      stdout = execFileSync(python, ['-I', join(DIR, '..', 'generate', 'check_pptx.py'), OUT_DIR], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      // Exit status 1 is "some file has a problem", with the report on stdout.
      stdout = (e as { stdout?: string }).stdout ?? '';
      if (!stdout) throw e;
    }
    const report = JSON.parse(stdout) as { file: string; problems: string[] }[];
    expect(report.length).toBe(files.length);
    const bad = report.filter((r) => r.problems.length);
    expect(bad.map((r) => `${r.file}: ${r.problems.slice(0, 4).join('; ')}`)).toEqual([]);
  }, 300_000);
});
