/**
 * The page's end of the desktop bridge. `docs/desktop-bridge.md` is the contract; this is its
 * types, and a client for each of the two objects the shell hands a page.
 *
 *     const client = cloudClient(await waitForBridge());   // the Office origin
 *     const client = localClient(await waitForBridge());   // office-local://editors
 *
 * Both are null when the object is not there or is not the one the contract describes, and the page
 * then carries on as the web. Everything the shell answers is text, parsed and checked here: a
 * malformed answer is treated as no answer (no recent files, no file, a failed save), never trusted
 * part way. A quick answer that does not come in 10 s is no answer too; a save is waited for as long
 * as the person keeps the Save dialog open.
 */

import { fromBase64, toBase64 } from '../crypto/primitives';
import { isDesktopUA } from './detect';

export type LocalKind = 'docs' | 'sheets' | 'slides';
export type LocalFormat = 'docx' | 'xlsx' | 'pptx' | 'csv' | 'md';
export type Theme = 'light' | 'dark';

/** The editor that opens each format (the contract's table of extensions). */
export const KIND_OF_FORMAT: Record<LocalFormat, LocalKind> = { docx: 'docs', md: 'docs', xlsx: 'sheets', csv: 'sheets', pptx: 'slides' };
/** What each editor saves, its own format first. */
export const FORMATS_OF_KIND: Record<LocalKind, readonly LocalFormat[]> = { docs: ['docx', 'md'], sheets: ['xlsx', 'csv'], slides: ['pptx'] };

const isFormat = (v: unknown): v is LocalFormat => typeof v === 'string' && Object.prototype.hasOwnProperty.call(KIND_OF_FORMAT, v);
const isKind = (v: unknown): v is LocalKind => v === 'docs' || v === 'sheets' || v === 'slides';

export interface RecentFile {
  /** Opaque: passed back to `openRecent`, never parsed. */
  key: string;
  name: string;
  /** For display only. */
  folder: string;
  format: LocalFormat;
  /** ms since the epoch. */
  modified: number;
}

export interface LocalFile {
  kind: LocalKind;
  name: string;
  /** null for a new tab. */
  format: LocalFormat | null;
  /** null for a new tab. */
  data: Uint8Array | null;
  readOnly: boolean;
  /** The recovery state, when it is newer than the file. */
  draft: Uint8Array | null;
}

export type SaveError = 'cancelled' | 'denied' | 'failed' | 'too_large';
export type SaveResult = { ok: true; name: string; format: LocalFormat } | { ok: false; error: SaveError };

/** A file Upload to Office left for the cloud page. */
export interface ImportFile {
  name: string;
  format: LocalFormat;
  data: Uint8Array;
}

// ── parsing what the shell sends ────────────────────────────────────────────

const MAX_RECENT = 20;
const SAVE_ERRORS: ReadonlySet<string> = new Set<SaveError>(['cancelled', 'denied', 'failed', 'too_large']);

function json(text: unknown): unknown {
  if (typeof text !== 'string' || text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function bytes(v: unknown): Uint8Array | null {
  if (typeof v !== 'string') return null;
  try {
    return fromBase64(v);
  } catch {
    return null;
  }
}

export function parseRecentFiles(answer: unknown): RecentFile[] {
  const list = json(answer);
  if (!Array.isArray(list)) return [];
  const out: RecentFile[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const { key, name, folder, format, modified } = r;
    if (!text(key, 4096) || !text(name, 1024) || typeof folder !== 'string' || folder.length > 4096 || !isFormat(format)) continue;
    if (typeof modified !== 'number' || !Number.isFinite(modified) || modified < 0) continue;
    out.push({ key, name, folder, format, modified });
    if (out.length === MAX_RECENT) break;
  }
  return out;
}

export function parseLocalFile(answer: unknown): LocalFile | null {
  const f = json(answer);
  if (!isRecord(f)) return null;
  const { kind, name, format, data, readOnly, draft } = f;
  if (!isKind(kind) || !text(name, 1024) || typeof readOnly !== 'boolean') return null;
  // A file has both a format and bytes; a new tab has neither.
  if (format === null && data === null) {
    // a new tab
  } else if (!isFormat(format) || KIND_OF_FORMAT[format] !== kind || typeof data !== 'string') return null;
  const body = data === null ? null : bytes(data);
  if (data !== null && !body) return null;
  if (draft !== null && typeof draft !== 'string') return null;
  // "" is a draft the page dropped (`discardDraft`), kept by a shell that did not know to.
  const recovered = draft === null || draft === '' ? null : bytes(draft);
  if (draft !== null && draft !== '' && !recovered) return null;
  return { kind, name, format: format as LocalFormat | null, data: body, readOnly, draft: recovered };
}

export function parseSaveResult(answer: unknown): SaveResult {
  const r = json(answer);
  if (isRecord(r)) {
    if (r.ok === true && text(r.name, 1024) && isFormat(r.format)) return { ok: true, name: r.name, format: r.format };
    if (r.ok === false && typeof r.error === 'string' && SAVE_ERRORS.has(r.error)) return { ok: false, error: r.error as SaveError };
  }
  return { ok: false, error: 'failed' };
}

export function parseImport(answer: unknown): ImportFile | null {
  const r = json(answer);
  if (!isRecord(r) || !text(r.name, 1024) || !isFormat(r.format) || !text(r.data, Number.MAX_SAFE_INTEGER)) return null;
  const data = bytes(r.data);
  return data ? { name: r.name, format: r.format, data } : null;
}

// ── finding the object ──────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

/**
 * The shell's object, or null. On the web (no `OfficeCompanion/` in the user agent) at once; in the
 * app, when the channel is up, or null after `ms`.
 */
export function waitForBridge(win: Window = window, ms = 3000): Promise<Raw | null> {
  if (!isDesktopUA(win.navigator?.userAgent ?? '')) return Promise.resolve(null);
  const now = (): Raw | null => {
    const o = (win as unknown as { officeDesktop?: unknown }).officeDesktop;
    return isRecord(o) ? o : null;
  };
  const there = now();
  if (there) return Promise.resolve(there);
  return new Promise((resolve) => {
    const done = (v: Raw | null) => {
      win.removeEventListener('officedesktop', onReady);
      clearTimeout(timer);
      resolve(v);
    };
    const onReady = () => {
      const o = now();
      if (o) done(o);
    };
    const timer = setTimeout(() => done(null), ms);
    win.addEventListener('officedesktop', onReady);
  });
}

// ── calling it ──────────────────────────────────────────────────────────────

const QUICK_MS = 10_000;

const hasMembers = (raw: Raw, names: readonly string[]): boolean => names.every((n) => typeof raw[n] === 'function');

/** An invokable's answer, which QWebChannel gives to a callback passed last. undefined when it throws or, with a limit, is late. */
function ask(raw: Raw, name: string, args: unknown[], limitMs: number | null): Promise<unknown> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(v);
    };
    const timer = limitMs === null ? null : setTimeout(() => finish(undefined), limitMs);
    try {
      (raw[name] as (...a: unknown[]) => unknown)(...args, finish);
    } catch {
      finish(undefined);
    }
  });
}

/** An invokable whose answer nobody needs. */
function tell(raw: Raw, name: string, ...args: unknown[]): void {
  try {
    (raw[name] as (...a: unknown[]) => unknown)(...args);
  } catch {
    // The shell went away; there is nobody to tell.
  }
}

export interface DesktopClient {
  version: string;
  setTheme(theme: Theme): void;
  recentFiles(): Promise<RecentFile[]>;
  /** The native Open dialog: each file chosen opens in a new local tab. */
  openFile(): void;
  /** `missing` when the file has gone, which also takes it off the list. */
  openRecent(key: string): Promise<'opened' | 'missing'>;
  newLocal(kind: LocalKind): void;
}

export interface CloudClient extends DesktopClient {
  /** `/`, `/docs/<id>`, `/sheets/<id>`, `/slides/<id>` or `/l/<token>` in a new cloud tab. Anything else is not sent. */
  openTab(path: string): void;
  takeImport(nonce: string): Promise<ImportFile | null>;
}

export interface LocalClient extends DesktopClient {
  file(): Promise<LocalFile | null>;
  save(data: Uint8Array): Promise<SaveResult>;
  saveAs(data: Uint8Array, format: LocalFormat): Promise<SaveResult>;
  setDirty(dirty: boolean): void;
  draft(state: Uint8Array): void;
  /** Drop the recovery state the shell keeps: the person discarded it. */
  discardDraft(): void;
  upload(data: Uint8Array, format: LocalFormat): void;
  /** The shell's Ctrl+S, and Save in its close prompt. Answers a function that stops listening. */
  onSaveRequested(listener: () => void): () => void;
}

const COMMON = ['setTheme', 'recentFiles', 'openFile', 'openRecent', 'newLocal'] as const;

/** The paths a cloud tab may be opened at. Ids as the URL scheme takes them. */
export const TAB_PATH = /^\/(?:(?:docs|sheets|slides|l)\/[A-Za-z0-9_-]{1,128})?$/;

function common(raw: Raw): DesktopClient {
  return {
    version: typeof raw.version === 'string' ? raw.version : '',
    setTheme: (theme) => {
      if (theme === 'light' || theme === 'dark') tell(raw, 'setTheme', theme);
    },
    recentFiles: async () => parseRecentFiles(await ask(raw, 'recentFiles', [], QUICK_MS)),
    openFile: () => tell(raw, 'openFile'),
    openRecent: async (key) => ((await ask(raw, 'openRecent', [key], QUICK_MS)) === 'missing' ? 'missing' : 'opened'),
    newLocal: (kind) => {
      if (isKind(kind)) tell(raw, 'newLocal', kind);
    }
  };
}

export function cloudClient(raw: unknown): CloudClient | null {
  if (!isRecord(raw) || !hasMembers(raw, [...COMMON, 'openTab', 'takeImport'])) return null;
  return {
    ...common(raw),
    openTab: (path) => {
      if (TAB_PATH.test(path)) tell(raw, 'openTab', path);
    },
    takeImport: async (nonce) => parseImport(await ask(raw, 'takeImport', [nonce], QUICK_MS))
  };
}

export function localClient(raw: unknown): LocalClient | null {
  if (!isRecord(raw) || !hasMembers(raw, [...COMMON, 'file', 'save', 'saveAs', 'setDirty', 'draft', 'upload'])) return null;
  const signal = raw.saveRequested;
  if (!isRecord(signal) || typeof signal.connect !== 'function' || typeof signal.disconnect !== 'function') return null;
  return {
    ...common(raw),
    file: async () => parseLocalFile(await ask(raw, 'file', [], QUICK_MS)),
    save: async (data) => parseSaveResult(await ask(raw, 'save', [toBase64(data)], null)),
    saveAs: async (data, format) => parseSaveResult(await ask(raw, 'saveAs', [toBase64(data), format], null)),
    setDirty: (dirty) => tell(raw, 'setDirty', dirty),
    draft: (state) => tell(raw, 'draft', toBase64(state)),
    discardDraft: () => tell(raw, 'draft', ''),
    upload: (data, format) => tell(raw, 'upload', toBase64(data), format),
    onSaveRequested: (listener) => {
      const fn = () => listener();
      try {
        (signal.connect as (f: () => void) => void)(fn);
      } catch {
        return () => undefined;
      }
      return () => {
        try {
          (signal.disconnect as (f: () => void) => void)(fn);
        } catch {
          // Gone with the shell.
        }
      };
    }
  };
}
