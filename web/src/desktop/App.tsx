/**
 * The desktop app's routes. A window is one of three things, and its URL says which:
 *
 *   /          Start
 *   /docs      a Docs window     (?w=<window id>; the host says what it opens)
 *   /sheets    a Sheets window
 *
 * Nothing navigates between them inside a window: a new document, a file opened, Start brought
 * forward, each is the host's to do (`guard.ts`).
 */

import { lazy, Suspense } from 'react';
import { AppKindProvider } from '../core/ui';
import { DocumentSkeleton } from '../pages/DocumentSkeleton';
import { useRouter } from '../router';
import { StartPage } from './StartPage';

// The same modules `core/prefetch.ts` loads, so a card that was pointed at opens at once.
const LocalDocsPage = lazy(() => import('./LocalDocsPage').then((m) => ({ default: m.LocalDocsPage })));
const LocalSheetsPage = lazy(() => import('./LocalSheetsPage').then((m) => ({ default: m.LocalSheetsPage })));

export function DesktopApp() {
  const { path } = useRouter();
  if (path.startsWith('/docs')) {
    return (
      <Suspense fallback={<DocumentSkeleton kind="docs" />}>
        <LocalDocsPage />
      </Suspense>
    );
  }
  if (path.startsWith('/sheets')) {
    return (
      <Suspense fallback={<DocumentSkeleton kind="sheets" />}>
        <LocalSheetsPage />
      </Suspense>
    );
  }
  return (
    <AppKindProvider value={null}>
      <StartPage />
    </AppKindProvider>
  );
}
