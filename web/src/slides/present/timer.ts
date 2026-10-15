/**
 * The presenter's timer: starts with the show, pauses, resets. A class over a clock that can be
 * handed in, so a test moves time itself.
 */

export class Stopwatch {
  private since: number | null;
  private before = 0;

  constructor(
    private readonly now: () => number = () => performance.now(),
    running = true
  ) {
    this.since = running ? this.now() : null;
  }

  get running(): boolean {
    return this.since !== null;
  }

  /** Milliseconds counted so far. */
  elapsed(): number {
    return this.before + (this.since === null ? 0 : this.now() - this.since);
  }

  start(): void {
    if (this.since === null) this.since = this.now();
  }

  pause(): void {
    if (this.since === null) return;
    this.before += this.now() - this.since;
    this.since = null;
  }

  toggle(): void {
    if (this.running) this.pause();
    else this.start();
  }

  /** Back to nothing. A running timer keeps running from zero, a paused one stays paused. */
  reset(): void {
    this.before = 0;
    if (this.since !== null) this.since = this.now();
  }
}

/** `4:07`, and `1:02:03` past an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
