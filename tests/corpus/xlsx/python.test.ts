/**
 * A reader that is not ours opens what we export.
 *
 * Every importable file of the corpus is read, written back out, and the xlsx written to `out/` beside a
 * `<name>.check.json` saying what our reader found in the file that was exported. `generate/check_xlsx.py` then opens every
 * one with openpyxl, a separate implementation of the format, and reports where what it sees differs; this test fails
 * on anything it reports.
 *
 * It needs openpyxl, so it looks for an interpreter that has it:
 *
 *     CORPUS_PYTHON=/path/to/python    an interpreter with openpyxl installed, or
 *     tests/corpus/.venv               python3 -m venv tests/corpus/.venv
 *                                      tests/corpus/.venv/bin/pip install openpyxl
 *
 * Without either, the test says it was skipped and why. It never passes by not running.
 *
 * LibreOffice is not installed on the machine this was written on, so no file was rendered: nothing here says what a sheet
 * looks like in Excel or LibreOffice, only that the file is sound and says what it should.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readXlsx } from '../../../web/src/formats/xlsx/read';
import { dumpWorkbook } from '../../../web/src/formats/xlsx/testing';
import { writeXlsx } from '../../../web/src/formats/xlsx/write';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..', '..', '..');
const OUT = join(DIR, 'out');

function interpreter(): string | null {
  const candidates = [process.env.CORPUS_PYTHON, join(ROOT, 'tests', 'corpus', '.venv', 'bin', 'python'), join(ROOT, 'tests', 'corpus', 'xlsx', '.venv', 'bin', 'python')];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

const MANIFEST = JSON.parse(readFileSync(join(DIR, 'real', 'manifest.json'), 'utf8')) as { files: { file: string }[] };

describe('openpyxl opens everything we export', () => {
  it('opens every corpus file after a round trip, and finds in it what our reader found', async (ctx) => {
    const python = interpreter();
    if (!python) return ctx.skip('skipped: no interpreter with openpyxl (set CORPUS_PYTHON, or make tests/corpus/.venv as the header of this file says)');

    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const files = [
      ...readdirSync(DIR)
        .filter((f) => f.endsWith('.xlsx'))
        .sort()
        .map((f) => ({ path: join(DIR, f), name: f.replace(/\.xlsx$/, '') })),
      ...MANIFEST.files.map((f) => ({ path: join(DIR, 'real', f.file), name: `real-${f.file.replace(/\.xlsx$/, '')}` }))
    ];
    for (const { path, name } of files) {
      const first = await readXlsx(new Uint8Array(readFileSync(path)));
      const written = await writeXlsx(first.seed, { title: name });
      writeFileSync(join(OUT, `${name}.xlsx`), written.bytes);
      // What our reader finds in the file we wrote: not what the original said, which a different test compares.
      const dump = dumpWorkbook((await readXlsx(written.bytes)).seed);
      const check = {
        names: dump.names,
        sheets: dump.sheets.map((s) => ({
          name: s.name,
          hidden: s.hidden,
          tab: s.tab,
          frozen: s.frozen,
          merges: s.merges,
          widths: s.widths,
          hiddenCols: s.hiddenCols,
          heights: s.heights,
          hiddenRows: s.hiddenRows,
          cf: s.cf.length,
          validations: s.validations.length,
          filter: s.filter,
          // The first cells of the sheet, which is enough to say that values and formulas came across, and quick to compare.
          cells: Object.fromEntries(
            Object.entries(s.cells)
              .filter(([, c]) => !(c.f && /\b(?:NOW|TODAY|RAND|RANDBETWEEN)\(/.test(c.f)) && !(typeof c.v === 'string' && c.v.length > 5000))
              .slice(0, 1500)
          )
        }))
      };
      writeFileSync(join(OUT, `${name}.check.json`), JSON.stringify(check));
    }

    let stdout = '';
    try {
      stdout = execFileSync(python, ['-I', join(DIR, 'generate', 'check_xlsx.py'), OUT], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      stdout = (e as { stdout?: string }).stdout ?? '';
      if (!stdout) throw e;
    }
    const report = JSON.parse(stdout) as { file: string; problems: string[] }[];
    expect(report.length).toBe(files.length);
    const bad = report.filter((r) => r.problems.length);
    expect(bad.map((r) => `${r.file}: ${r.problems.slice(0, 3).join('; ')}`)).toEqual([]);
  }, 300_000);
});
