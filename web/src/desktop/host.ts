/**
 * The host: whatever owns the window this page is in, and the files on disk.
 *
 * In the app it is the Qt shell, over QWebChannel (`qtHost.ts`). In a plain browser (`npm run
 * dev`, the e2e walk) it is `fakeHost.ts`, which keeps its files in IndexedDB. The page never
 * sees a path it did not get from the host, and never writes a file except through `save`.
 *
 * One window holds one document, or the Start page. `hello()` says which: `open` is how the
 * window was asked for (a new blank, a template, a file, a file to import), null for Start.
 */

import { createContext, useContext } from 'react';
import type { Kind } from './kinds';

export type OpenRequest =
  | { kind: Kind; source: 'new' }
  | { kind: Kind; source: 'template'; templateId: string }
  | { kind: Kind; source: 'file'; path: string; name: string }
  | { kind: Kind; source: 'import'; path: string; name: string };

export interface WindowInfo {
  windowId: string;
  platform: 'mac' | 'linux' | 'windows' | 'web';
  appName: string;
  version: string;
  /** The shell is running its self-test; `window.__selftest` is wanted. */
  selfTest: boolean;
  open: OpenRequest | null;
}

export interface SaveResult {
  path: string;
  /** The file's name, with its extension. */
  name: string;
  /** Modification time after the write, in ms. */
  mtime: number;
}

export interface RecentFile {
  path: string;
  name: string;
  kind: Kind;
  /** When it was last opened or saved, unix ms. */
  openedAt: number;
  exists: boolean;
}

export type HostErrorCode = 'stale' | 'exists' | 'io' | 'not_found' | 'bad_request';

export class HostError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'HostError';
  }
}

export const isHostError = (e: unknown, code?: HostErrorCode): e is HostError =>
  e instanceof HostError && (code === undefined || e.code === code);

export interface WindowState {
  title: string;
  /** There is something not on disk. */
  dirty: boolean;
  /** The document has a file. */
  hasPath: boolean;
  saving: boolean;
}

/** What the shell asks of the page: its menu bar, its close button, its window going to the back. */
export type HostCommand =
  | 'save'
  | 'saveAs'
  | 'export'
  | 'print'
  | 'undo'
  | 'redo'
  | 'find'
  | 'close'
  | 'flush'
  | 'recentsChanged';

export interface Host {
  hello(): Promise<WindowInfo>;
  /** The bytes of the file this window was opened with (`open.source` is `file` or `import`). */
  readOpened(): Promise<Uint8Array>;
  setState(state: WindowState): void;
  /** Write the document's file. `stale` when the file changed on disk since it was read or written here. */
  save(bytes: Uint8Array, opts?: { force?: boolean }): Promise<SaveResult>;
  /** Ask where, and write it there. Null when the person cancels. */
  saveAs(bytes: Uint8Array, suggestedName: string): Promise<SaveResult | null>;
  /** Rename the document's file, in its folder. `name` has no extension. */
  rename(name: string): Promise<SaveResult>;
  newDocument(kind: Kind, templateId?: string): void;
  open(): void;
  openRecent(path: string): void;
  forgetRecent(path: string): void;
  reveal(path: string): void;
  recents(): Promise<RecentFile[]>;
  showStart(): void;
  openExternal(url: string): void;
  /** Close this window. Without `force` the shell may still ask about unsaved changes. */
  close(force: boolean): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  onCommand(cb: (name: HostCommand, args: Record<string, unknown>) => void): () => void;
}

declare global {
  interface Window {
    /** Set by the Qt shell before any script runs: resolves with the channel's `host` object. */
    __desktopHost?: Promise<unknown>;
  }
}

export async function connectHost(): Promise<Host> {
  if (window.__desktopHost) {
    const { qtHost } = await import('./qtHost');
    return qtHost(await window.__desktopHost);
  }
  const { fakeHost } = await import('./fakeHost');
  return fakeHost();
}

export interface HostValue {
  host: Host;
  info: WindowInfo;
}

const HostContext = createContext<HostValue | null>(null);
export const HostProvider = HostContext.Provider;

export function useHost(): HostValue {
  const v = useContext(HostContext);
  if (!v) throw new Error('useHost outside HostProvider');
  return v;
}

// ── bytes over JSON ─────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
