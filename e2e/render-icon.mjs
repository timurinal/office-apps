// Renders shell/packaging/icon.svg to the 1024 px PNG the macOS build makes its .icns from.
// Run once after changing the SVG: node e2e/render-icon.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = readFileSync(fileURLToPath(new URL('../shell/packaging/icon.svg', import.meta.url)), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: fileURLToPath(new URL('../shell/packaging/icon-1024.png', import.meta.url)), omitBackground: true });
await browser.close();
