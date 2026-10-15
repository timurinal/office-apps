/**
 * One window's document: whether it has changed since it was last on disk, and getting it there.
 *
 * A document with a file saves itself: an edit arms `SaveQueue` (core/savequeue.ts), which writes
 * 1.5 s after the last one, never two writes at once, and again straight after if more came in
 * meanwhile. A new document has no file until Save asks where; until then it is only "not saved",
 * and the shell asks before its window closes.
 *
 * Changes are counted, not compared. A revision goes up on every edit after the document is
 * *armed*: once the editor has drawn it (an editor writes a few things of its own as it opens a
 * document, which are not the person's), or at the first key, paste, drop or press, whichever is
 * first. A save records the revision it wrote; the document is dirty while the two differ.
 */

import { SaveQueue, type SaveState } from '../core/savequeue';
import { fileNameOf } from '../formats/browser/saveFile';
import { isHostError, type Host, type SaveResult, type WindowState } from './host';
import { baseName, KINDS, type Kind } from './kinds';

export type SessionState = 'saved' | 'edited' | 'saving' | 'error' | 'conflict';

interface Payload {
  bytes: Uint8Array;
  revision: number;
}

export interface SessionInit {
  host: Host;
  kind: Kind;
  id: string;
  title: string;
  path: string | null;
  /** Autosave's quiet time. */
  delayMs?: number;
}

export class Session {
  readonly host: Host;
  readonly kind: Kind;
  readonly id: string;
  title: string;
  path: string | null;
  /** The editor's context (`DocsContext` or `SheetsContext`), as the desktop module last saw it. */
  ctx: unknown = null;
  /** Builds the file, now. Set by the page once the document is open. */
  serialize: (() => Uint8Array) | null = null;
  /** The last write's failure, for a message. */
  lastError: unknown = null;

  private revision = 0;
  private savedRevision = 0;
  private armed = false;
  private queue: SaveQueue<Payload> | null = null;
  private queueState: SaveState = 'saved';
  private readonly delayMs: number;
  private readonly listeners = new Set<() => void>();
  private lastSent = '';

  constructor(init: SessionInit) {
    this.host = init.host;
    this.kind = init.kind;
    this.id = init.id;
    this.title = init.title;
    this.path = init.path;
    this.delayMs = init.delayMs ?? 1500;
    if (this.path) this.queue = this.makeQueue();
  }

  // ── reading ───────────────────────────────────────────────────────────────

  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  get state(): SessionState {
    if (this.queueState === 'conflict') return 'conflict';
    if (this.queueState === 'error') return 'error';
    if (this.queueState === 'saving') return 'saving';
    return this.dirty ? 'edited' : 'saved';
  }

  windowState(): WindowState {
    return { title: this.title, dirty: this.dirty, hasPath: this.path !== null, saving: this.state === 'saving' };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A version number for `useSyncExternalStore`: changes whenever anything shown changes. */
  snapshot = (): string => `${this.state}|${this.dirty}|${this.title}|${this.path ?? ''}`;

  // ── edits ─────────────────────────────────────────────────────────────────

  /** From here on, a change to the document is the person's. */
  arm(): void {
    this.armed = true;
  }

  /** The document changed. */
  touch(): void {
    if (!this.armed) return;
    this.revision += 1;
    this.queue?.touch();
    this.emit();
  }

  // ── saving ────────────────────────────────────────────────────────────────

  /** ⌘S: write it where it lives, or ask where. Resolves whether it is on disk now. */
  async save(): Promise<boolean> {
    if (!this.path) return this.saveAs();
    if (this.queueState === 'conflict') return false;
    return this.flush();
  }

  /** Write anything pending. True when nothing is left unsaved. */
  async flush(): Promise<boolean> {
    if (!this.queue) return !this.dirty;
    await this.queue.flush();
    return !this.dirty && this.queueState === 'saved';
  }

  async saveAs(): Promise<boolean> {
    const payload = this.produce();
    const done = await this.host.saveAs(payload.bytes, fileNameOf(this.title, KINDS[this.kind].extension));
    if (!done) return false;
    this.adopt(done, payload.revision);
    return true;
  }

  /** After a conflict: write this version over whatever is on disk. */
  async overwrite(): Promise<boolean> {
    if (!this.path) return this.saveAs();
    const payload = this.produce();
    const done = await this.host.save(payload.bytes, { force: true });
    this.adopt(done, payload.revision);
    return true;
  }

  /** The title changed on screen. A document with a file renames the file. Resolves with the title that stuck. */
  async rename(title: string): Promise<string> {
    const next = title.trim() || this.title;
    if (!this.path) {
      this.title = next;
      this.emit();
      return next;
    }
    const done = await this.host.rename(next);
    this.path = done.path;
    this.title = baseName(done.name);
    this.emit();
    return this.title;
  }

  dispose(): void {
    this.queue?.dispose();
    this.listeners.clear();
  }

  // ── inside ────────────────────────────────────────────────────────────────

  private produce(): Payload {
    if (!this.serialize) throw new Error('The document is still opening.');
    return { bytes: this.serialize(), revision: this.revision };
  }

  private adopt(done: SaveResult, revision: number): void {
    this.path = done.path;
    this.title = baseName(done.name);
    this.savedRevision = Math.max(this.savedRevision, revision);
    this.queue?.dispose();
    this.queueState = 'saved';
    this.queue = this.makeQueue();
    if (this.dirty) this.queue.touch();
    this.emit();
  }

  private makeQueue(): SaveQueue<Payload> {
    return new SaveQueue<Payload>({
      rev: 0,
      delayMs: this.delayMs,
      produce: async () => this.produce(),
      put: async (rev, payload) => {
        await this.host.save(payload.bytes);
        this.savedRevision = Math.max(this.savedRevision, payload.revision);
        this.lastError = null;
        return { rev: rev + 1 };
      },
      isStale: (err) => isHostError(err, 'stale'),
      onState: (state, err) => {
        this.queueState = state;
        if (err) this.lastError = err;
        this.emit();
      }
    });
  }

  private emit(): void {
    const ws = this.windowState();
    const key = JSON.stringify(ws);
    if (key !== this.lastSent) {
      this.lastSent = key;
      this.host.setState(ws);
    }
    for (const l of this.listeners) l();
  }
}

// ── the window's one session ────────────────────────────────────────────────

let current: Session | null = null;
const currentListeners = new Set<() => void>();

export function currentSession(): Session | null {
  return current;
}

export function setCurrentSession(s: Session | null): void {
  current = s;
  for (const l of currentListeners) l();
}

export function onCurrentSession(listener: () => void): () => void {
  currentListeners.add(listener);
  return () => currentListeners.delete(listener);
}
