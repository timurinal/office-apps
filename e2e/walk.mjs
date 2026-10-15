// The app in a browser, on the fake host (web/src/desktop/fakeHost.ts), end to end:
//
//   npm run build && npm run e2e
//
// It serves dist/web with `vite preview`, drives Chromium through Start, Docs and Sheets, and
// fails on any request that leaves the page's origin or asks for /api, any console error, and any
// class or id from before the rename. Screenshots at 1440x900 land in dist/e2e/.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { strFromU8, unzipSync } from 'fflate';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const BASE = `http://localhost:${PORT}`;
const SHOTS = `${ROOT}dist/e2e`;
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(SHOTS, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // already gone
  }
};
process.on('exit', stopServer);

for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    // not yet
  }
  await sleep(200);
}

const executablePath = process.env.CHROMIUM ?? (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined);
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', acceptDownloads: true });
await context.addInitScript(() => localStorage.setItem('office.fake.selftest', '1'));
const page = await context.newPage();

const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
});
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.protocol === 'data:' || u.protocol === 'blob:') return;
  if (u.origin !== BASE) problems.push(`left the page: ${r.url()}`);
  else if (u.pathname.startsWith('/api/')) problems.push(`asked a server: ${u.pathname}`);
});
let promptAnswer = 'Walk note';
page.on('dialog', (d) => void d.accept(d.type() === 'prompt' ? promptAnswer : undefined));

let passed = 0;
let failed = 0;
async function step(name, fn) {
  try {
    const detail = (await fn()) ?? '';
    passed++;
    console.log(`  ok    ${name} ${detail}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
    await page.screenshot({ path: `${SHOTS}/fail-${passed + failed}.png` }).catch(() => undefined);
  }
}
function expect(ok, message) {
  if (!ok) throw new Error(message);
}
const st = (call) => page.evaluate(`window.__selftest ? window.__selftest.${call} : null`);
async function until(what, fn, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn().catch(() => undefined);
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}
const ready = () => until('the page to be ready', () => st('ready()'), 30000);
const saveState = () => page.locator('[data-desktop-save]').textContent({ timeout: 1000 });
async function openFile(menuText) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: menuText }).click();
}
async function noOldNames() {
  const old = await page.evaluate(() => {
    const hits = new Set();
    for (const el of document.querySelectorAll('*')) {
      for (const c of el.classList) if (/^mvc?-/.test(c)) hits.add(c);
      if (/^mvc?-/.test(el.id)) hits.add(el.id);
    }
    return [...hits];
  });
  expect(old.length === 0, `old names in the page: ${old.slice(0, 5).join(', ')}`);
}

console.log(`Office in a browser, against ${BASE}\n`);

await step('Start: the blanks and the templates', async () => {
  await page.goto(BASE);
  await ready();
  const cards = await page.locator('button.oa-tcard').count();
  expect(cards >= 9, `${cards} cards`);
  await noOldNames();
  await page.screenshot({ path: `${SHOTS}/start.png` });
  return `${cards} cards`;
});

await step('Docs: a new document, typed, saved, saved again by itself', async () => {
  await page.locator('button.oa-tcard[aria-label="Blank document"]').click();
  await ready();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Hello from the walk.');
  await until('Not saved', async () => (await saveState()) === 'Not saved');
  await page.keyboard.press('Control+s');
  await until('Saved', async () => (await saveState()) === 'Saved');
  expect((await page.title()) === 'Walk note', `title ${await page.title()}`);
  await page.keyboard.type(' Twice.');
  await until('Edited', async () => (await saveState()) === 'Edited');
  await until('saved by itself', async () => (await saveState()) === 'Saved', 10000);
  await noOldNames();
  await page.screenshot({ path: `${SHOTS}/docs.png` });
});

await step('Docs: renaming the title renames the file', async () => {
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.click();
  await title.fill('Walk renamed');
  await title.press('Enter');
  await until('the new name', async () => (await page.title()) === 'Walk renamed');
});

await step('Start: the file is in Recent, and opens again', async () => {
  await page.goto(BASE);
  await ready();
  const row = page.locator('.oa-recent-open', { hasText: 'Walk renamed.oadoc' });
  await row.click();
  await ready();
  const text = await st('docText()');
  expect(text?.includes('Hello from the walk. Twice.'), `text ${JSON.stringify(text)}`);
});

await step('Docs: a template', async () => {
  await page.goto(BASE);
  await ready();
  await page.locator('button.oa-tcard[aria-label="Meeting notes"]').click();
  await ready();
  const text = await st('docText()');
  expect(text && text.length > 20, `text ${JSON.stringify(text)}`);
});

await step('Docs: a Word file with pictures, opened and exported again', async () => {
  await page.goto(BASE);
  await ready();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open…' }).click();
  await (await chooser).setFiles(`${ROOT}tests/corpus/docx/04-images.docx`);
  await ready();
  const images = await until('the pictures', async () => {
    const list = await st('images()');
    return list?.length ? list : null;
  });
  expect(images.every((s) => s.startsWith('data:image/')), `pictures ${images}`);
  const download = page.waitForEvent('download');
  await openFile('Export as Word (.docx)');
  const file = await (await download).path();
  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  expect(strFromU8(zip['docProps/core.xml']).includes('<dc:creator>Office</dc:creator>'), 'creator is not Office');
  return `${images.length} pictures`;
});

await step('Sheets: a formula, saved, exported as CSV, opened again', async () => {
  await page.goto(BASE);
  await ready();
  await page.locator('button.oa-tcard[aria-label="Blank spreadsheet"]').click();
  await ready();
  await page.locator('[role="grid"]').click({ position: { x: 60, y: 14 } });
  await st("setCell('A1', '2')");
  await st("setCell('A2', '3')");
  await st("setCell('A3', '=SUM(A1:A2)')");
  await until('A3 to be 5', async () => (await st("cellText('A3')")) === '5');
  promptAnswer = 'Walk book';
  await page.keyboard.press('Control+s');
  await until('Saved', async () => (await saveState()) === 'Saved');
  const download = page.waitForEvent('download');
  await openFile('Export as CSV (.csv)');
  const csv = readFileSync(await (await download).path(), 'utf8');
  expect(csv.split(/\s+/).includes('5'), `csv ${JSON.stringify(csv)}`);
  await noOldNames();
  await page.screenshot({ path: `${SHOTS}/sheets.png` });
  await page.goto(BASE);
  await ready();
  await page.locator('.oa-recent-open', { hasText: 'Walk book.oasheet' }).click();
  await ready();
  await until('A3 after opening again', async () => (await st("cellText('A3')")) === '5');
});

await step('Nothing left the page, and the console is clean', async () => {
  expect(problems.length === 0, problems.slice(0, 5).join('; '));
});

await browser.close();
stopServer();
console.log(`\n${passed} of ${passed + failed} passed`);
process.exit(failed ? 1 : 0);
