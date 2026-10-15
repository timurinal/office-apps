/**
 * A host for a plain browser: `npm run dev`, `npm run preview` and the e2e walk.
 *
 * Its "disk" is IndexedDB, under `/Documents`. Opening a file from the computer copies it in;
 * exporting is the browser's own download. A window is the tab: opening a document navigates the
 * tab to it, and closing goes back to Start. Save as asks for a name with `prompt`.
 *
 * The app never uses this inside the shell, which has the real thing (`qtHost.ts`).
 */

import { HostError, type Host, type HostCommand, type OpenRequest, type RecentFile, type SaveResult, type WindowInfo } from './host';
import { classify, ENABLED_KINDS, KINDS, type Kind } from './kinds';

interface StoredFile {
  path: string;
  name: string;
  bytes: Uint8Array;
  mtime: number;
}

const DB = 'office-fake-disk';
const STORE = 'files';
const RECENTS = 'office.fake.recents';
const WINDOW = 'office.fake.window.';
const FOLDER = '/Documents';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const readFile = (path: string) => tx<StoredFile | undefined>('readonly', (s) => s.get(path) as IDBRequest<StoredFile | undefined>);
const writeFile = (f: StoredFile) => tx('readwrite', (s) => s.put(f));
const removeFile = (path: string) => tx('readwrite', (s) => s.delete(path));

function readRecents(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS) ?? '[]') as RecentFile[];
  } catch {
    return [];
  }
}

function noteRecent(path: string, name: string, kind: Kind): void {
  const next = [{ path, name, kind, openedAt: Date.now(), exists: true }, ...readRecents().filter((r) => r.path !== path)].slice(0, 20);
  try {
    localStorage.setItem(RECENTS, JSON.stringify(next));
  } catch {
    // A full or blocked store costs only the list.
  }
}

function go(kind: Kind | null, open: OpenRequest | null): void {
  if (!kind || !open) {
    window.location.assign('/');
    return;
  }
  const id = Math.random().toString(36).slice(2, 10);
  try {
    localStorage.setItem(WINDOW + id, JSON.stringify(open));
  } catch {
    // Without storage the window opens blank.
  }
  window.location.assign(`/${kind}?w=${id}`);
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ENABLED_KINDS.flatMap((k) => [KINDS[k].extension, ...KINDS[k].imports]).map((e) => `.${e}`).join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function fakeHost(): Host {
  const windowId = new URLSearchParams(window.location.search).get('w') ?? '';
  let open: OpenRequest | null = null;
  try {
    open = windowId ? (JSON.parse(localStorage.getItem(WINDOW + windowId) ?? 'null') as OpenRequest | null) : null;
  } catch {
    open = null;
  }
  let path: string | null = open?.source === 'file' ? open.path : null;
  let mtime = 0;
  const listeners = new Set<(name: HostCommand, args: Record<string, unknown>) => void>();
  const kind: Kind | null = open?.kind ?? null;

  const write = async (target: string, bytes: Uint8Array): Promise<SaveResult> => {
    const name = target.slice(target.lastIndexOf('/') + 1);
    const f: StoredFile = { path: target, name, bytes, mtime: Date.now() };
    await writeFile(f);
    path = target;
    mtime = f.mtime;
    if (kind) noteRecent(target, name, kind);
    return { path: target, name, mtime: f.mtime };
  };

  return {
    async hello(): Promise<WindowInfo> {
      return { windowId, platform: 'web', appName: 'Office', version: '0.1.0', selfTest: false, open };
    },

    async readOpened() {
      if (!open || (open.source !== 'file' && open.source !== 'import')) throw new HostError('bad_request', 'Nothing to read.');
      const f = await readFile(open.path);
      if (!f) throw new HostError('not_found', 'That file is not there any more.');
      if (open.source === 'file') {
        mtime = f.mtime;
        noteRecent(f.path, f.name, open.kind);
      } else await removeFile(f.path);
      return f.bytes;
    },

    setState(s) {
      document.title = `${s.dirty ? '• ' : ''}${s.title}`;
    },

    async save(bytes, opts) {
      if (!path) throw new HostError('bad_request', 'This document has no file yet.');
      const now = await readFile(path);
      if (now && now.mtime !== mtime && !opts?.force) throw new HostError('stale', 'This file was changed by another app.');
      return write(path, bytes);
    },

    async saveAs(bytes, suggestedName) {
      const ext = kind ? KINDS[kind].extension : '';
      const answer = window.prompt('Save as', suggestedName);
      if (answer === null || !answer.trim()) return null;
      const base = answer.trim().replace(/[\\/]/g, ' ');
      const name = ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
      return write(`${FOLDER}/${name}`, bytes);
    },

    async rename(name) {
      if (!path || !kind) throw new HostError('bad_request', 'This document has no file yet.');
      const target = `${FOLDER}/${name.replace(/[\\/]/g, ' ').trim()}.${KINDS[kind].extension}`;
      if (target === path) return { path, name: target.slice(FOLDER.length + 1), mtime };
      if (await readFile(target)) throw new HostError('exists', 'There is already a file with that name.');
      const f = await readFile(path);
      if (!f) throw new HostError('not_found', 'That file is not there any more.');
      await removeFile(path);
      localStorage.setItem(RECENTS, JSON.stringify(readRecents().filter((r) => r.path !== path)));
      return write(target, f.bytes);
    },

    newDocument(k, templateId) {
      go(k, templateId ? { kind: k, source: 'template', templateId } : { kind: k, source: 'new' });
    },

    open() {
      void pickFile().then(async (file) => {
        if (!file) return;
        const what = classify(file.name);
        if (!what) {
          window.alert('That kind of file cannot be opened here.');
          return;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const target = what.native ? `${FOLDER}/${file.name}` : `/Imports/${file.name}`;
        await writeFile({ path: target, name: file.name, bytes, mtime: Date.now() });
        go(what.kind, { kind: what.kind, source: what.native ? 'file' : 'import', path: target, name: file.name });
      });
    },

    openRecent(p) {
      const r = readRecents().find((x) => x.path === p);
      if (r) go(r.kind, { kind: r.kind, source: 'file', path: r.path, name: r.name });
    },

    forgetRecent(p) {
      localStorage.setItem(RECENTS, JSON.stringify(readRecents().filter((r) => r.path !== p)));
      for (const l of listeners) l('recentsChanged', {});
    },

    reveal(p) {
      console.info(`reveal ${p}`);
    },

    async recents() {
      const list = readRecents();
      return Promise.all(list.map(async (r) => ({ ...r, exists: Boolean(await readFile(r.path)) })));
    },

    showStart: () => go(null, null),
    openExternal: (url) => void window.open(url, '_blank', 'noopener'),
    close: () => go(null, null),
    log: (level, message) => console[level](message),

    onCommand(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }
  };
}
