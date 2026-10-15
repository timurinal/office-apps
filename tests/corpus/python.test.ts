/**
 * A reader that is not ours opens what we export.
 *
 * Every corpus file is imported, exported, and the docx written to tests/corpus/out/ beside a
 * `<name>.expect.json` saying what the first import found in it. `scripts/corpus-check.py`
 * then opens every one with python-docx, which is a separate implementation of the format, and
 * reports what it sees; this test fails on anything it reports.
 *
 * It needs python-docx, so it looks for an interpreter that has it:
 *
 *     CORPUS_PYTHON=/path/to/python   an interpreter with python-docx installed, or
 *     tests/corpus/.venv              python3 -m venv tests/corpus/.venv
 *                                     tests/corpus/.venv/bin/pip install python-docx
 *
 * Without either, the test says it was skipped and why. It never passes by not running.
 *
 * LibreOffice is not installed on the machine this was written on, so no file was rendered:
 * nothing here says what the pages look like, only that the file is sound and says what it should.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readDocx } from '../../web/src/formats/docx/read';
import { writeDocx } from '../../web/src/formats/docx/write';
import type { ExportComment, JSONContent } from '../../web/src/formats/types';
import { allText, bytesOf, CORPUS_DIR, listDocx, OUT_DIR } from './helpers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function interpreter(): string | null {
  const candidates = [process.env.CORPUS_PYTHON, join(ROOT, 'tests', 'corpus', '.venv', 'bin', 'python'), join(ROOT, 'tests', 'corpus', '.venv', 'Scripts', 'python.exe')];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

const find = (n: JSONContent, type: string): JSONContent[] => [...(n.type === type ? [n] : []), ...(n.content ?? []).flatMap((c) => find(c, type))];
const textNodes = (n: JSONContent): JSONContent[] => [...(n.type === 'text' ? [n] : []), ...(n.content ?? []).flatMap(textNodes)];

describe('python-docx opens everything we export', () => {
  it('opens every corpus file after a round trip, and finds in it what the importer found', async (ctx) => {
    const python = interpreter();
    if (!python) ctx.skip('skipped: no interpreter with python-docx (set CORPUS_PYTHON, or make tests/corpus/.venv as the header of this file says)');

    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });
    const files = [...listDocx(CORPUS_DIR), ...listDocx(join(CORPUS_DIR, 'real'))];
    for (const file of files) {
      const first = readDocx(bytesOf(file));
      const comments: ExportComment[] = [];
      const byId = new Map(first.comments.map((c) => [c.id, c]));
      for (const c of first.comments) {
        if (c.parent && byId.has(c.parent)) continue;
        comments.push({
          id: c.id,
          author: c.author,
          at: c.at,
          text: c.text,
          resolved: c.resolved,
          start: c.start,
          end: c.end,
          replies: first.comments.filter((r) => r.parent === c.id).map((r) => ({ author: r.author, at: r.at, text: r.text }))
        });
      }
      const { bytes } = await writeDocx(first.model, { title: 'Corpus', resolveImage: (src) => first.images.get(src) ?? null, comments });

      const body = first.model.body;
      const top = body.content ?? [];
      const marked = (type: 'insertion' | 'deletion', block: 'split' | 'join') =>
        textNodes(body).filter((t) => t.marks?.some((m) => m.type === type)).length +
        find(body, 'paragraph').filter((p) => (p.attrs?.suggest as { kind?: string } | null | undefined)?.kind === block).length;
      const first1 = (n: JSONContent | undefined): string => (n ? allText(n).trim().split(/\s+/)[0] ?? '' : '');
      const expectations: Record<string, unknown> = {
        headings: top.filter((n) => n.type === 'heading').map((h) => [h.attrs!.level, allText(h)]),
        tables: top.filter((n) => n.type === 'table').map((t) => [t.content!.length, (t.content![0]!.content ?? []).reduce((sum, c) => sum + (Number(c.attrs?.colspan) || 1), 0)]),
        images: find(body, 'image').length,
        comments: first.comments.length,
        footnotes: find(body, 'footnote').length,
        tracked: { inserted: marked('insertion', 'split'), deleted: marked('deletion', 'join') },
        ...(first.model.page ? { sections: [{ orientation: first.model.page.orientation, paper: first.model.page.size }] } : {}),
        ...(first.model.header.default ? { header: first1(first.model.header.default) } : {}),
        ...(first.model.footer.default ? { footer: first1(first.model.footer.default) } : {})
      };
      const name = `${file.includes('/real/') ? 'real-' : ''}${file.split('/').pop()}`;
      writeFileSync(join(OUT_DIR, name), bytes);
      writeFileSync(join(OUT_DIR, name.replace(/\.docx$/, '.expect.json')), JSON.stringify(expectations));
    }

    let output: string;
    try {
      output = execFileSync(python!, ['-I', join(ROOT, 'scripts', 'corpus-check.py'), OUT_DIR], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      // Exit status 1 is "some file has a problem", with the report on stdout.
      output = (e as { stdout?: string }).stdout ?? '';
      if (!output) throw e;
    }
    const reports = JSON.parse(output) as { file: string; problems: string[] }[];
    expect(reports.length).toBe(files.length);
    expect(reports.flatMap((r) => r.problems.map((p) => `${r.file}: ${p}`))).toEqual([]);
  }, 120_000);
});
