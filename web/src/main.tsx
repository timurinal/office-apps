import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api';
import { initAppearance } from './core/appearance';
import { AppKindProvider, ToastHost } from './core/ui';
import { DesktopApp } from './desktop/App';
import { installGuard } from './desktop/guard';
import { connectHost, HostProvider } from './desktop/host';
import { RouterProvider } from './router';
import { AppProvider } from './state';
import { KINDS, type Kind } from './desktop/kinds';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// public/theme-init.js settled light or dark before the first paint; this keeps it following the
// system, and the other windows when the person changes it in one.
initAppearance();

/** The editor this window is, by its address: a toast wears that editor's colour. */
const windowKind = (): Kind | null => (Object.keys(KINDS) as Kind[]).find((k) => window.location.pathname.startsWith(`/${k}`)) ?? null;

async function boot(root: HTMLElement): Promise<void> {
  const host = await connectHost();
  const info = await host.hello();
  installGuard(host);

  // The editors keep a few calls a site would make (a title for a linked document, the people
  // to mention). There is no server; each already handles its failure, so do not report it.
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason instanceof ApiError) e.preventDefault();
  });

  if (info.selfTest) (await import('./desktop/selftest')).installSelfTest(host);

  createRoot(root).render(
    <React.StrictMode>
      <RouterProvider>
        <HostProvider value={{ host, info }}>
          <AppProvider>
            <AppKindProvider value={windowKind()}>
              <ToastHost>
                <DesktopApp />
              </ToastHost>
            </AppKindProvider>
          </AppProvider>
        </HostProvider>
      </RouterProvider>
    </React.StrictMode>
  );
}

boot(container).catch((err: unknown) => {
  console.error(err);
  container.textContent = 'Office could not start.';
});
