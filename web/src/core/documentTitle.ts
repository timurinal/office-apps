/**
 * The tab's title: the document's name and the app it is open in, "Budget – Sheets", and
 * "Office" everywhere else (Home, a message, a page that is loading).
 *
 * `index.html` says "Office" and nothing else sets the title, so a reader with six
 * documents open could not tell their tabs apart.
 *
 * Several pages can be mounted at once for a moment, the one a route change is leaving and the
 * one it is arriving at, and React runs their cleanups in no order this file can rely on. So
 * the title is a stack: each hook is an entry, the tab shows the newest entry, and an entry
 * that leaves is simply taken out. Restoring "the title from before I mounted" would, after
 * the wrong order, put a document's name back on a page that is not that document.
 */

import { useEffect, useRef } from 'react';
import type { DocKind } from '@shared/api';

export const APP_TITLE = 'Office';

const KIND_LABEL: Record<DocKind, string> = { docs: 'Docs', sheets: 'Sheets', slides: 'Slides' };

/** What the tab reads for a document: `Budget – Sheets`. Anything else is the app's own name. */
export function documentTitle(title?: string | null, kind?: DocKind | null): string {
  const name = title?.trim();
  const app = kind ? KIND_LABEL[kind] : undefined;
  return name && app ? `${name} – ${app}` : APP_TITLE;
}

interface Entry {
  text: string;
}

const stack: Entry[] = [];
/** The title the page had before the first entry, which is what the last one leaves behind. */
let baseline = APP_TITLE;

function show(): void {
  if (typeof document === 'undefined') return;
  document.title = stack.length > 0 ? stack[stack.length - 1]!.text : baseline;
}

/** Name the tab for as long as the calling component is mounted, and follow the title if it changes. */
export function useDocumentTitle(title?: string | null, kind?: DocKind | null): void {
  const text = documentTitle(title, kind);
  const entry = useRef<Entry>({ text });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const mine = entry.current;
    if (stack.length === 0) baseline = document.title || APP_TITLE;
    stack.push(mine);
    show();
    return () => {
      const at = stack.indexOf(mine);
      if (at >= 0) stack.splice(at, 1);
      show();
    };
  }, []);

  useEffect(() => {
    entry.current.text = text;
    show();
  }, [text]);
}

/** The hook as an element, for a page that names its tab only in one of its states. */
export function DocumentTitle({ title, kind }: { title?: string | null; kind?: DocKind | null }): null {
  useDocumentTitle(title, kind);
  return null;
}
