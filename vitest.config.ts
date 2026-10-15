/**
 * One project, in Node: the editors' logic, the converters and their corpus, the
 * Sheets engine and model, and the desktop layer. DOM tests opt in with a
 * `@vitest-environment happy-dom` comment at the top of the file.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@web': path('./web/src'), '@shared': path('./shared') } },
  test: {
    name: 'node',
    environment: 'node',
    include: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx', 'shared/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30_000
  }
});
