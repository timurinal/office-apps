import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import license from 'rollup-plugin-license';
import { fileURLToPath, URL } from 'node:url';
import { exactCase } from './vite.exact-case';

/**
 * The page's policy, as a <meta> in the built index.html. Only at build time: the dev
 * server's React refresh preamble is an inline script and its HMR is a socket.
 *
 * Nothing here can reach a network: `connect-src 'self'` is the app's own scheme, and the
 * desktop shell refuses every other scheme anyway.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

function csp(): Plugin {
  return {
    name: 'office-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  };
}

/** The editors still carry code that would call a server; there is none, so say so fast. */
function noApi(): Plugin {
  const refuse = (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }, next: () => void) => {
    if (req.url?.startsWith('/api/')) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end('{"error":{"code":"offline","message":"There is no server."}}');
      return;
    }
    next();
  };
  return {
    name: 'office-no-api',
    configureServer: (server) => void server.middlewares.use(refuse),
    configurePreviewServer: (server) => void server.middlewares.use(refuse)
  };
}

export default defineConfig({
  root: 'web',
  plugins: [exactCase(), react(), csp(), noApi()],
  resolve: {
    alias: {
      '@web': fileURLToPath(new URL('./web/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  },
  // The import worker builds a document with the editor's own schema, and the module
  // list that schema comes from has lazy dialogs in it. A worker with code in more than
  // one chunk has to be an ES module.
  // Workers are bundled with their own plugins; the import worker reaches the same editor modules.
  worker: { format: 'es', plugins: () => [exactCase()] },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome130',
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      plugins: [
        license({
          thirdParty: {
            includePrivate: false,
            output: { file: fileURLToPath(new URL('./dist/web/THIRD_PARTY.txt', import.meta.url)) }
          }
        })
      ]
    }
  }
});
