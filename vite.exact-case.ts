/**
 * Relative imports, resolved by their exact case.
 *
 * `web/src/docs/core/` has both `Picker.tsx` and `picker.ts`. Vite tries `.ts` before `.tsx`, so on a
 * case-insensitive disk (a Mac's) `import './Picker'` finds `picker.ts` and the build fails. This
 * plugin answers an extensionless relative import from the folder's real listing, so the file named
 * exactly as imported wins on every disk. Anything else (a folder's index, a package, `?raw`) is
 * left to Vite.
 */

import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];

export function exactCase(): Plugin {
  return {
    name: 'office-exact-case',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !(source.startsWith('./') || source.startsWith('../'))) return null;
      if (source.includes('?') || /\.[A-Za-z0-9]+$/.test(source.slice(source.lastIndexOf('/') + 1))) return null;
      const target = resolve(dirname(importer.split('?')[0]!), source);
      const folder = dirname(target);
      const name = target.slice(folder.length + 1);
      let entries: string[];
      try {
        entries = readdirSync(folder);
      } catch {
        return null;
      }
      for (const ext of EXTENSIONS) if (entries.includes(name + ext)) return join(folder, name + ext);
      return null;
    }
  };
}
