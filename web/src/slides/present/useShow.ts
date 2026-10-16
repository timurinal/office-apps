/**
 * A show in one window: its state, what the keys do to it, and the other window.
 *
 * The state is `state.ts`'s. A key (or a click, or a button) becomes an action, the action becomes
 * the next state, and the next state is sent to the other window, which takes it if it is later
 * (`wins`). The other window's states arrive the same way, so either window's keys drive both and
 * neither is in charge. The deck under the show is live: when slides are added, moved or deleted
 * the state is repaired against the deck as it is now (`repair`).
 *
 * A window that cannot talk to another (no BroadcastChannel, or `channel` left out) is a show of
 * its own and works the same.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlideModel } from '../model/model';
import { useOrder } from '../useSlideModel';
import { onKey, type KeyLike } from './keys';
import { browserChannel, newShowToken, ShowLink, type ChannelFactory } from './protocol';
import { repair, startState, step, wins, type ShowAction, type ShowState } from './state';
import type { DeckView } from './stepping';

/** What the stepping reads of the deck, at the moment it is asked. */
export const viewOf = (m: SlideModel): DeckView => ({ ids: m.order(), hidden: (id) => m.slide(id)?.hidden === true });

/** `solo` is a show in one window; `presenter` and `audience` are the two ends of one show. */
export type Role = 'solo' | 'presenter' | 'audience';

export interface ShowOptions {
  model: SlideModel;
  /** The slide to start on, from 0. */
  from: number;
  role: Role;
  /** Where to talk to the other window. Left out for a show in one window. */
  channel?: { name: string; factory?: ChannelFactory };
  /** The show is over, here or in the other window. Called once. */
  onExit: () => void;
  /** F: the window should toggle full screen. */
  onFullscreen?: () => void;
}

export interface Pointer {
  x: number;
  y: number;
}

export interface ShowHandle {
  state: ShowState;
  /** Slides in the deck now. */
  count: number;
  /** Where the slide on screen is, from 0. */
  index: number;
  /** Digits typed towards a slide number. */
  digits: string;
  /** Where the other window's laser is. */
  remote: Pointer | null;
  /** Other windows on this show that are open now. */
  peers: number;
  /** Another window has been on this show at some point. */
  heard: boolean;
  act: (a: ShowAction) => void;
  /** Feed a key; true when the show took it and the page must not see it. */
  key: (e: KeyLike) => boolean;
  /** Tell the other window where this window's laser is, as fractions of the slide. */
  pointer: (at: Pointer | null) => void;
  /** Leave, and tell the other window to. */
  end: () => void;
  /** The state now, for a handler that runs later. */
  peek: () => ShowState;
}

/** Digits typed towards a slide number are forgotten after this long. */
export const DIGITS_MS = 3000;

export function useShow(o: ShowOptions): ShowHandle | null {
  const { model } = o;
  const latest = useRef(o);
  latest.current = o;

  const [id] = useState(() => newShowToken().slice(0, 12));
  const [state, setState] = useState<ShowState | null>(() => startState(viewOf(model), o.from, id, o.role === 'audience' ? 0 : 1));
  const stateRef = useRef(state);
  const commit = useCallback((next: ShowState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const [digits, setDigits] = useState('');
  const digitsRef = useRef('');
  const [remote, setRemote] = useState<Pointer | null>(null);
  const [peerIds, setPeerIds] = useState<ReadonlySet<string>>(() => new Set());
  const [heard, setHeard] = useState(false);
  const linkRef = useRef<ShowLink | null>(null);
  const ended = useRef(false);

  const finish = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    latest.current.onExit();
  }, []);

  const end = useCallback(() => {
    linkRef.current?.send({ t: 'end' });
    finish();
  }, [finish]);

  const act = useCallback(
    (a: ShowAction) => {
      const cur = stateRef.current;
      if (!cur || ended.current) return;
      const r = step(cur, a, viewOf(latest.current.model), id);
      if (r.fullscreen) {
        latest.current.onFullscreen?.();
        return;
      }
      if (r.exit) {
        end();
        return;
      }
      if (r.state !== cur) {
        commit(r.state);
        linkRef.current?.send({ t: 'state', state: r.state });
      }
    },
    [id, commit, end]
  );

  const key = useCallback(
    (e: KeyLike): boolean => {
      const out = onKey(e, digitsRef.current);
      if (out.digits !== digitsRef.current) {
        digitsRef.current = out.digits;
        setDigits(out.digits);
      }
      if (out.action) act(out.action);
      return out.handled;
    },
    [act]
  );

  // Typed digits that were never followed by Enter are let go.
  useEffect(() => {
    if (!digits) return;
    const t = setTimeout(() => {
      digitsRef.current = '';
      setDigits('');
    }, DIGITS_MS);
    return () => clearTimeout(t);
  }, [digits]);

  // The deck changed under the show.
  useEffect(() => {
    const sync = () => {
      const cur = stateRef.current;
      if (!cur) return;
      const next = repair(cur, viewOf(model));
      if (!next) end();
      else if (next !== cur) commit(next);
    };
    return model.subscribe((c) => c.order && sync());
  }, [model, commit, end]);

  // No slides at all: there is nothing to show.
  useEffect(() => {
    if (!state) finish();
  }, [state, finish]);

  // The other window.
  const channel = o.channel;
  const channelName = channel?.name;
  const factory = channel?.factory ?? browserChannel;
  useEffect(() => {
    if (!channelName) return;
    const link = new ShowLink(channelName, id, factory);
    linkRef.current = link;
    const peers = new Set<string>();
    const seen = (from: string) => {
      if (peers.has(from)) return;
      peers.add(from);
      setPeerIds(new Set(peers));
      setHeard(true);
    };
    const off = link.listen((m) => {
      if (m.t === 'bye') {
        if (peers.delete(m.from)) setPeerIds(new Set(peers));
        return;
      }
      if (m.t === 'end') {
        finish();
        return;
      }
      seen(m.from);
      const cur = stateRef.current;
      if (m.t === 'hello') {
        if (cur) link.send({ t: 'state', state: cur });
      } else if (m.t === 'state') {
        if (!cur || !wins(m.state, cur)) return;
        const next = repair(m.state, viewOf(latest.current.model));
        if (next) commit(next);
      } else if (m.t === 'pointer') {
        setRemote(m.at);
      }
    });
    link.send({ t: 'hello' });
    // This window going away: the audience's is a window closing, and the show goes on; the
    // presenter's is the show ending.
    const role = latest.current.role;
    const leaving = () => link.send(role === 'audience' ? { t: 'bye' } : { t: 'end' });
    window.addEventListener('pagehide', leaving);
    return () => {
      window.removeEventListener('pagehide', leaving);
      off();
      link.send({ t: 'bye' });
      link.close();
      if (linkRef.current === link) linkRef.current = null;
    };
  }, [channelName, factory, id, commit, finish]);

  const pointer = useCallback((at: Pointer | null) => linkRef.current?.send({ t: 'pointer', at }), []);
  const peek = useCallback(() => stateRef.current!, []);

  const order = useOrder(model);
  if (!state) return null;
  const at = state.slide ? order.indexOf(state.slide) : -1;
  return {
    state,
    count: order.length,
    index: at >= 0 ? at : Math.max(0, Math.min(order.length - 1, state.index)),
    digits,
    remote,
    peers: peerIds.size,
    heard,
    act,
    key,
    pointer,
    end,
    peek
  };
}
