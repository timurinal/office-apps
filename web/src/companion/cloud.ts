/**
 * The cloud page's side of the desktop app: what the web app does differently inside it, and the
 * one thing it offers outside it.
 *
 *   · "Open in the desktop app", a File menu row in each editor, opens `office-companion://open/…`.
 *     It is not offered inside the app, on a touch screen, or to a link's visitor, whose grant is a
 *     cookie in this browser and not in the app.
 *   · Inside the app the page tells the shell its theme, so the title bar and the tab strip match,
 *     and opens a document "in a new tab" as one of the app's tabs.
 *   · Home takes a file Upload to Office left for it (`/?import=<nonce>`) and imports it as a
 *     dropped file is.
 *
 * Loaded by the editors, and by Home only inside the app.
 */

import desktopRaw from '@phosphor-icons/core/assets/regular/desktop.svg?raw';
import type { DocKind, DocumentMeta } from '@shared/api';
import { capsFor } from '../core/caps';
import { ph } from '../core/icons';
import { coarsePointer } from '../core/pointer';
import type { FileItem } from '../core/shell/types';
import { cloudClient, waitForBridge, type CloudClient, type ImportFile } from './bridge';
import { isDesktopUA } from './detect';
import { followTheme } from './theme';

const desktopIcon = ph(desktopRaw);

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The app's address for a document, or null for an id it would ignore (docs/desktop-bridge.md). */
export const desktopUrl = (kind: DocKind, id: string): string | null => (ID.test(id) ? `office-companion://open/${kind}/${id}` : null);

const openUrl = (url: string): void => {
  window.location.href = url;
};

/** The File menu's row. `go` opens the address; a test replaces it. */
export function openInDesktopRow(kind: DocKind, meta: Pick<DocumentMeta, 'id' | 'role' | 'principal' | 'canDownload' | 'trashedAt' | 'locked'>, go: (url: string) => void = openUrl): FileItem<unknown> {
  const url = desktopUrl(kind, meta.id);
  const guest = capsFor(meta).guest;
  return {
    id: 'file.desktop',
    label: 'Open in the desktop app',
    icon: desktopIcon,
    section: 'Document',
    order: 210,
    visible: () => url !== null && !guest && !isDesktopUA() && !coarsePointer(),
    run: () => {
      if (url) go(url);
    }
  };
}

// ── inside the app ──────────────────────────────────────────────────────────

let pending: Promise<CloudClient | null> | null = null;
let current: CloudClient | null = null;

/** The shell's cloud object, once: null on the web, and in the app when it never came. */
export function cloudBridge(): Promise<CloudClient | null> {
  return (pending ??= waitForBridge().then((raw) => (current = cloudClient(raw))));
}

/** What the page does when it starts in the app: find the bridge, then follow the theme. */
export async function attachCloud(): Promise<void> {
  const client = await cloudBridge();
  if (client) followTheme(client);
}

/** A document in a new tab: the app's, inside the app; the browser's otherwise. */
export function openInNewTab(path: string, client: CloudClient | null = current): void {
  if (client) client.openTab(path);
  else window.open(path, '_blank', 'noopener,noreferrer');
}

const LOCAL_EXTENSION = /\.(?:docx|md|markdown|xlsx|csv|pptx)$/i;

/**
 * An upload as a `File`, named so that Home knows what it is. The shell names it after the tab, and a
 * tab's file may be a .csv or a .md that the page uploads as the workbook or document it became.
 */
export function importedFile(upload: ImportFile): File {
  const ext = `.${upload.format}`;
  const lower = upload.name.toLowerCase();
  const named = lower.endsWith(ext) || (upload.format === 'md' && lower.endsWith('.markdown'));
  const name = named ? upload.name : `${upload.name.replace(LOCAL_EXTENSION, '')}${ext}`;
  return new File([upload.data as BlobPart], name);
}

const NONCE = /^[A-Za-z0-9_-]{1,128}$/;
const taken = new Set<string>();

/**
 * The file Upload to Office left for `/?import=<nonce>`, or null. Asked once per nonce: the shell
 * answers a nonce once, and React asks twice in development.
 */
export async function takeImportFile(nonce: string): Promise<File | null | 'asked'> {
  if (!NONCE.test(nonce)) return null;
  if (taken.has(nonce)) return 'asked';
  taken.add(nonce);
  const client = await cloudBridge();
  const upload = client ? await client.takeImport(nonce) : null;
  return upload ? importedFile(upload) : null;
}
