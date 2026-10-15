import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api';
import { ToastHost } from './core/ui';
import { DesktopApp } from './desktop/App';
import { installGuard } from './desktop/guard';
import { connectHost, HostProvider } from './desktop/host';
import { RouterProvider } from './router';
import { AppProvider } from './state';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

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
            <ToastHost>
              <DesktopApp />
            </ToastHost>
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
