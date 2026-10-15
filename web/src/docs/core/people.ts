/**
 * Who can be @mentioned: the people who can open this document, and nobody else.
 *
 * The list is the server's (`GET …/comments/people`, the one a comment's `@` uses): the
 * owner, the people the document is shared with, and the organisation's members when it is
 * open to the organisation, by the same rules the notification email follows, so the picker
 * never offers someone a mention could not reach. It is never a search over accounts: a
 * mention cannot be used to find out who exists, and a person cannot be pulled into a
 * document they have no way to open. The server answers at most eight, for `q`, and never
 * the caller.
 *
 * The first `@` needs the unfiltered list and everything after it filters that list here,
 * at once; what the server matches for the typed letters follows when it arrives and
 * replaces it, because a document can have more people than the first eight.
 *
 * Someone who is not signed in (a link guest) is refused by the server, so for them the list
 * is the owner, whose name the page already holds.
 */

import { PATHS, type MentionPeopleResponse } from '@shared/api';
import { get } from '../../api';
import type { DocsContext } from '../modules/types';

export interface Mentionable {
  id: string;
  name: string;
  handle: string | null;
}

const clean = (s: string): string => s.trim().toLowerCase().replace(/^@/, '');

/** Names and handles that start with what was typed first, then those that contain it. */
export function filterMentionables(list: readonly Mentionable[], query: string, limit = 6): Mentionable[] {
  const q = clean(query);
  if (!q) return list.slice(0, limit);
  const starts: Mentionable[] = [];
  const has: Mentionable[] = [];
  for (const p of list) {
    const parts = [p.name.toLowerCase(), ...p.name.toLowerCase().split(/\s+/), (p.handle ?? '').toLowerCase()];
    if (parts.some((x) => x.startsWith(q))) starts.push(p);
    else if (parts.some((x) => x.includes(q))) has.push(p);
  }
  return [...starts, ...has].slice(0, limit);
}

const TTL_MS = 60_000;
const held = new Map<string, { at: number; list: Promise<Mentionable[]> }>();

export function resetPeople(): void {
  held.clear();
}

/** The server's people for `query`, kept for a minute. A failure is not kept. */
export function fetchPeople(documentId: string, query: string): Promise<Mentionable[]> {
  const q = clean(query);
  const key = `${documentId}\u0000${q}`;
  const have = held.get(key);
  if (have && Date.now() - have.at < TTL_MS) return have.list;
  const list = get<MentionPeopleResponse>(`${PATHS.commentPeople(documentId)}?q=${encodeURIComponent(q)}`).then((r) =>
    r.people.map((p) => ({ id: p.userId, name: p.name, handle: p.handle }))
  );
  list.catch(() => held.delete(key));
  held.set(key, { at: Date.now(), list });
  return list;
}

/** Whether there is a server to ask: a local file and a locked document have no one else. */
export const hasPeople = (ctx: Pick<DocsContext, 'source'>): boolean => ctx.source.kind === 'cloud';

/** The unfiltered list, with the owner as the answer when the server will not say. */
export function loadMentionables(ctx: Pick<DocsContext, 'meta' | 'source'>): Promise<Mentionable[]> {
  if (!hasPeople(ctx)) return Promise.resolve([]);
  const owner: Mentionable[] = ctx.meta.ownerId ? [{ id: ctx.meta.ownerId, name: ctx.meta.ownerName || 'Owner', handle: null }] : [];
  return fetchPeople(ctx.meta.id, '').catch(() => owner);
}
