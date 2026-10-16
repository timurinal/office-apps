/**
 * Who is here, from the room's awareness states.
 *
 * A person with two tabs open is two awareness clients and should be one avatar.
 * The room writes the name and the profile picture into every state itself
 * (`stampName` in the DocumentRoom), so both are trustworthy; the colour and anything else in the
 * state is whatever the sender claimed and is only ever used to paint. People
 * are therefore merged on name and colour together: the same person's tabs agree
 * on both, since the colour is a hash of their id (color.ts), and nobody can
 * hide another person's avatar by claiming it.
 */

import { avatarSrc } from '../theme';
import { colorFor } from './color';

export interface Peer {
  /** The first awareness client id seen for this person. */
  clientId: number;
  name: string;
  color: string;
  /** Their profile picture, or null for the initials. */
  avatar: string | null;
  /** This browser's own person, whichever of its tabs. */
  self: boolean;
  /** How many awareness clients are this person. */
  tabs: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 64;

/** The name, colour and picture in one awareness state, or null when it has none (a
 *  client that has not announced itself, or one that left). */
export function readUser(state: unknown): { name: string; color: string; avatar: string | null } | null {
  if (typeof state !== 'object' || state === null) return null;
  const user = (state as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null) return null;
  const { name, color, avatar } = user as { name?: unknown; color?: unknown; avatar?: unknown };
  const clean = (typeof name === 'string' ? name.trim() : '').slice(0, NAME_MAX) || 'Someone';
  return { name: clean, color: typeof color === 'string' && HEX.test(color) ? color : colorFor(clean), avatar: avatarSrc(avatar) };
}

export function peersFrom(states: ReadonlyMap<number, unknown>, selfClientId: number): Peer[] {
  const byKey = new Map<string, Peer>();
  for (const [clientId, state] of [...states.entries()].sort(([a], [b]) => a - b)) {
    const user = readUser(state);
    if (!user) continue;
    const key = `${user.name}\u0000${user.color}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.tabs += 1;
      seen.avatar ??= user.avatar;
      if (clientId === selfClientId) seen.self = true;
    } else {
      byKey.set(key, { clientId, ...user, self: clientId === selfClientId, tabs: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.self !== b.self) return a.self ? -1 : 1;
    return a.name.localeCompare(b.name) || a.clientId - b.clientId;
  });
}

/**
 * Whether two lists are the same people. A caret moving is an awareness change but not a
 * change of who is here, and the list is read by the header and so by the whole editor: a
 * new array for every keystroke re-renders the shell once per key, for nobody's benefit.
 */
export function samePeers(a: readonly Peer[], b: readonly Peer[]): boolean {
  return a.length === b.length && a.every((p, i) => p.clientId === b[i]!.clientId && p.name === b[i]!.name && p.color === b[i]!.color && p.avatar === b[i]!.avatar && p.self === b[i]!.self && p.tabs === b[i]!.tabs);
}

/** The first `max` people, and how many more there are. */
export function splitVisible<T>(people: readonly T[], max: number): { shown: T[]; hidden: number } {
  if (people.length <= max) return { shown: [...people], hidden: 0 };
  return { shown: people.slice(0, max), hidden: people.length - max };
}
