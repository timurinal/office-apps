/**
 * What the presenter's window and the audience's window say to each other.
 *
 * A BroadcastChannel named for the document and the show (`channelName`), so two shows of one deck,
 * or two decks, never hear each other. Each window keeps a whole `ShowState` and sends it whenever
 * it changes it, and the other window takes it when it `wins` (state.ts): there is no leader, and
 * either window's keys drive both. A message is validated on arrival (`parseMessage`), because any
 * page of this origin can post to a channel.
 *
 *   hello    a window has opened and wants the state       → every window with one sends it
 *   state    the show changed                               → the other adopts it if it is later
 *   pointer  where the laser is, as fractions of the slide  → drawn as a dot in the other window
 *   end      the show was ended                             → the other window leaves too
 *   bye      this window is going away, the show goes on    → the presenter offers to open it again
 */

import type { Screen, ShowState } from './state';

export type ShowMessage =
  | { t: 'hello'; from: string }
  | { t: 'state'; from: string; state: ShowState }
  | { t: 'pointer'; from: string; at: { x: number; y: number } | null }
  | { t: 'end'; from: string }
  | { t: 'bye'; from: string };

/** A message as it is sent: the link adds `from`. */
export type Outgoing = ShowMessage extends infer M ? (M extends { from: string } ? Omit<M, 'from'> : never) : never;

export const channelName = (documentId: string, show: string): string => `oa.slides.show.${documentId}.${show}`;

/** The token that names one show, passed to the audience window in its address. */
export const SHOW_TOKEN = /^[A-Za-z0-9]{8,40}$/;

export function newShowToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
}

const SCREENS: ReadonlySet<string> = new Set<Screen>(['none', 'black', 'white', 'end']);
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const fraction = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);

function parseState(v: unknown): ShowState | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (!count(s.rev) || !text(s.by) || !count(s.index) || s.index > 100_000) return null;
  if (s.slide !== null && !text(s.slide)) return null;
  if (typeof s.screen !== 'string' || !SCREENS.has(s.screen) || typeof s.laser !== 'boolean') return null;
  return { rev: s.rev, by: s.by, slide: s.slide, index: s.index, screen: s.screen as Screen, laser: s.laser };
}

/** A message from the channel, or null for anything that is not one. */
export function parseMessage(data: unknown): ShowMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (!text(m.from)) return null;
  switch (m.t) {
    case 'hello':
    case 'end':
    case 'bye':
      return { t: m.t, from: m.from };
    case 'state': {
      const state = parseState(m.state);
      return state ? { t: 'state', from: m.from, state } : null;
    }
    case 'pointer': {
      if (m.at === null) return { t: 'pointer', from: m.from, at: null };
      if (typeof m.at !== 'object') return null;
      const at = m.at as Record<string, unknown>;
      const x = fraction(at.x);
      const y = fraction(at.y);
      return x === null || y === null ? null : { t: 'pointer', from: m.from, at: { x, y } };
    }
    default:
      return null;
  }
}

// ── the channel ─────────────────────────────────────────────────────────────

/** The part of a BroadcastChannel the show uses, so a test can put its own between two windows. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type ChannelFactory = (name: string) => ChannelLike | null;

export const browserChannel: ChannelFactory = (name) => (typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(name) as ChannelLike));

/** One window's end of the channel. `listen` hears every window but this one. */
export class ShowLink {
  private channel: ChannelLike | null;
  private listeners = new Set<(m: ShowMessage) => void>();

  constructor(
    name: string,
    readonly id: string,
    factory: ChannelFactory = browserChannel
  ) {
    this.channel = factory(name);
    if (this.channel) {
      this.channel.onmessage = (e) => {
        const m = parseMessage(e.data);
        if (!m || m.from === this.id) return;
        for (const l of [...this.listeners]) l(m);
      };
    }
  }

  /** False where the browser has no BroadcastChannel: the show runs in one window. */
  get available(): boolean {
    return this.channel !== null;
  }

  send(m: Outgoing): void {
    this.channel?.postMessage({ ...m, from: this.id });
  }

  listen(fn: (m: ShowMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    if (!this.channel) return;
    this.channel.onmessage = null;
    this.channel.close();
    this.channel = null;
    this.listeners.clear();
  }
}
