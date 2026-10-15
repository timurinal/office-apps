/**
 * Saving a locked document: one writer, one revision at a time.
 *
 * A locked document has no room, so there is nothing that merges edits. Every
 * save quotes the revision it builds on in `If-Match`, and the server answers
 * 412 if that is no longer the current one. This class is the page's half of
 * that bargain:
 *
 *   · Edits are coalesced. `touch()` marks the content dirty and arms a timer;
 *     the content is read (`produce`) when the save actually starts, so a burst
 *     of typing is one request carrying the last state, not one per keystroke.
 *   · Saves never overlap. One that is already out finishes first, and an edit
 *     made meanwhile is saved straight after on the revision the first returned.
 *   · A 412 is final. Somebody else saved (another tab, usually the owner's
 *     own), and sending again would only fail the same way, or worse, win and
 *     discard their save. The queue stops and says `conflict`; the page tells
 *     the person to reload.
 *   · Any other failure retries with a growing wait and says `error` meanwhile,
 *     so a dropped connection costs nothing but a banner.
 */

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface SaveQueueOptions<P> {
  /** The revision the document was loaded at. */
  rev: number;
  /** Builds what to send, at the moment of sending, for the revision it will
   *  quote. Expensive work goes here. */
  produce: (rev: number) => Promise<P>;
  /** Sends it, quoting `rev`. Resolves with the new revision. */
  put: (rev: number, payload: P) => Promise<{ rev: number }>;
  /** Whether a failure is the server's "someone else saved". */
  isStale: (err: unknown) => boolean;
  onState: (state: SaveState, err?: unknown) => void;
  /** Quiet time after the last edit before saving. */
  delayMs?: number;
  /** Wait before retry number `failures`. */
  retryMs?: (failures: number) => number;
}

export const defaultRetryMs = (failures: number): number => Math.min(2000 * 2 ** (failures - 1), 30_000);

export class SaveQueue<P> {
  private _state: SaveState = 'saved';
  private _rev: number;
  private dirty = false;
  private failures = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly opts: SaveQueueOptions<P>) {
    this._rev = opts.rev;
  }

  get state(): SaveState {
    return this._state;
  }

  /** The revision the next save will quote. */
  get rev(): number {
    return this._rev;
  }

  /** The content changed. */
  touch(): void {
    if (this.stopped) return;
    this.dirty = true;
    // A save in progress picks this up when it finishes; a pending retry is
    // already coming and must not be postponed by typing.
    if (this.running || this._state === 'error') return;
    this.set('dirty');
    this.arm(this.opts.delayMs ?? 1500);
  }

  /** Save now, and resolve when nothing is left to save or the queue has stopped. */
  async flush(): Promise<SaveState> {
    this.disarm();
    if (this.dirty || this.running) await this.run();
    return this._state;
  }

  /** The page is going away. */
  dispose(): void {
    this.stopped = true;
    this.disarm();
  }

  private set(state: SaveState, err?: unknown): void {
    this._state = state;
    this.opts.onState(state, err);
  }

  private arm(ms: number): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private disarm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private run(): Promise<void> {
    if (!this.running) this.running = this.loop().finally(() => (this.running = null));
    return this.running;
  }

  private async loop(): Promise<void> {
    while (this.dirty && !this.stopped) {
      this.dirty = false;
      this.set('saving');
      try {
        const payload = await this.opts.produce(this._rev);
        const res = await this.opts.put(this._rev, payload);
        this._rev = res.rev;
        this.failures = 0;
      } catch (err) {
        if (this.opts.isStale(err)) {
          this.stopped = true;
          this.set('conflict', err);
          return;
        }
        this.dirty = true;
        this.failures += 1;
        this.set('error', err);
        if (!this.stopped) this.arm((this.opts.retryMs ?? defaultRetryMs)(this.failures));
        return;
      }
    }
    if (!this.stopped) this.set(this.dirty ? 'dirty' : 'saved');
  }
}
