/**
 * The pptx converters in a real Web Worker, in a real browser.
 *
 *     node tests/corpus/pptx/worker-check.mjs
 *
 * `readPptx` and `writePptx` are bundled with esbuild into the same kind of module worker the page uses
 * for docx and xlsx (`formats/browser/importWorker.ts`), started from a Blob in headless Chromium, and
 * given the corpus. It says how long a 120-slide deck takes in the worker (the parse alone, and the whole
 * trip with the bytes moved in and the deck moved out), and that an export reads back. Nothing in it
 * touches the Worker, the network or the local stack, so it needs only Chromium.
 */

import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CHROMIUM = process.env.CHROMIUM ?? '/usr/bin/chromium';

const entry = `
import { readPptx, writePptx } from ${JSON.stringify(join(ROOT, 'web/src/formats/pptx/index.ts'))};
import { isFormatError } from ${JSON.stringify(join(ROOT, 'web/src/formats/errors.ts'))};
const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
self.onmessage = async (e) => {
  const { id, mode } = e.data;
  try {
    const t0 = performance.now();
    if (mode === 'import') {
      const out = readPptx(e.data.bytes);
      self.postMessage({ id, ok: true, workerMs: performance.now() - t0, deck: out.deck, warnings: out.warnings });
    } else {
      const file = await writePptx(e.data.deck, async (ref) => (ref.data ? { bytes: decode(ref.data), mime: ref.mime ?? 'image/png' } : null));
      self.postMessage({ id, ok: true, workerMs: performance.now() - t0, bytes: file }, [file.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, code: isFormatError(err) ? err.code : 'failed', message: String((err && err.message) || err) });
  }
};
`;

const built = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'worker-entry.ts' },
  bundle: true,
  write: false,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  tsconfig: join(ROOT, 'tsconfig.json'),
  minify: true,
  logLevel: 'error'
});
const script = built.outputFiles[0].text;
console.log(`worker bundle: ${(script.length / 1024).toFixed(0)} KB`);

// A page and a script from a real origin: a module worker cannot start from a page that has none.
const server = createServer((req, res) => {
  if (req.url === '/worker.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(script);
  } else {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>pptx</title>');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// With arguments, those files; without, the corpus.
const given = process.argv.slice(2);
const files = given.length > 0 ? given : readdirSync(HERE).filter((f) => f.endsWith('.pptx')).sort();
const browser = await puppeteer.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.goto(origin);
  const results = await page.evaluate(
    async (items) => {
      const call = (message, transfer) =>
        new Promise((resolve) => {
          const worker = new Worker('/worker.js', { type: 'module' });
          const t0 = performance.now();
          worker.onmessage = (e) => {
            worker.terminate();
            resolve({ ...e.data, trip: performance.now() - t0 });
          };
          worker.onerror = (e) => {
            worker.terminate();
            resolve({ ok: false, message: `${e.message} ${e.filename}:${e.lineno}`, trip: performance.now() - t0 });
          };
          worker.postMessage(message, transfer);
        });
      const run = async (name, b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        // Import: the bytes move to the worker, the deck comes back to the page.
        const imported = await call({ id: 1, mode: 'import', bytes }, [bytes.buffer]);
        if (!imported.ok) return { name, ok: false, message: imported.message };
        // Export: the deck goes to the worker, the file comes back.
        const exported = await call({ id: 2, mode: 'export', deck: imported.deck });
        if (!exported.ok) return { name, ok: false, message: `export: ${exported.message}` };
        const bytes2 = exported.bytes;
        const exportKB = bytes2.length / 1024;
        const again = await call({ id: 3, mode: 'import', bytes: bytes2 }, [bytes2.buffer]);
        return {
          name,
          ok: true,
          slides: imported.deck.slides.length,
          again: again.ok ? again.deck.slides.length : -1,
          importTrip: imported.trip,
          importWorker: imported.workerMs,
          exportTrip: exported.trip,
          exportWorker: exported.workerMs,
          exportKB
        };
      };
      const out = [];
      for (const [name, b64] of items) out.push(await run(name, b64));
      // The heaviest again, in a fresh worker as the app starts one per file.
      const big = items.find(([n]) => n.startsWith('22-') || n.startsWith('stress'));
      if (big) out.push(await run(`${big[0]} (second run)`, big[1]));
      return out;
    },
    files.map((f) => [given.length > 0 ? f.split('/').pop() : f, readFileSync(given.length > 0 ? f : join(HERE, f)).toString('base64')])
  );
  let bad = 0;
  for (const r of results) {
    if (!r.ok) {
      bad++;
      console.log(`FAIL  ${r.name}: ${r.message}`);
      continue;
    }
    console.log(
      `${r.name.padEnd(36)} ${String(r.slides).padStart(3)} slides  import ${r.importWorker.toFixed(0).padStart(4)} ms in the worker, ${r.importTrip.toFixed(0).padStart(4)} ms to the page  export ${r.exportWorker.toFixed(0).padStart(4)} ms, ${r.exportTrip.toFixed(0).padStart(4)} ms ${r.exportKB.toFixed(0).padStart(5)} KB  re-read ${r.again}`
    );
    if (r.again !== r.slides) bad++;
  }
  const heavy = results.filter((r) => r.name.startsWith('22-') || r.name.startsWith('stress'));
  for (const r of heavy) if (r.ok) console.log(`\n${r.name}: ${r.slides} slides imported in ${r.importWorker.toFixed(0)} ms in the worker and ${r.importTrip.toFixed(0)} ms from postMessage to the deck on the page`);
  const budget = heavy.every((r) => r.ok && r.importTrip < 2000);
  console.log(budget ? 'inside the 2 s budget' : 'OVER the 2 s budget');
  process.exitCode = bad || !budget ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
