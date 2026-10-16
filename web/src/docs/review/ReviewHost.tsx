/**
 * Review's part of the page that is not the ribbon, a pane or the footer: the cards beside
 * the page, and the wiring between the page and the comments.
 *
 * Like CoreHost (docs/core/Host.tsx) it rides on a footer item (`status.review-host` in
 * modules/review.tsx), which is always mounted, gets the current `DocsContext` on every
 * render, and draws nothing where it sits. What it does:
 *
 *   tells the page who is suggesting   the mode and the author, into suggest.ts's plugin
 *   draws the comments in the page     the open threads and the active card, into highlights.ts
 *   reads the suggestions back out     once a frame after a change, into the store
 *   hears the room                     review/live.ts
 *   the margin                         the cards beside their text, when there is room for them
 *
 * The margin is a column portalled into the paper, at its right edge, and the paper moves
 * left to make room (a FLIP, so only a transform animates). Each card is placed with a
 * transform at the height of its text and slides when that text moves; cards that would
 * overlap are pushed apart, and the active one keeps its place and steps out by 12px, as
 * the DocsFocus board draws it. Placement is written to the DOM directly, once a frame,
 * so typing above a card re-renders nothing.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { CommentThread } from '@shared/api';
import { DUR } from '../../motion';
import { boxOf, flip } from '../../motion/flip';
import { useApp } from '../../state';
import type { AnchorDraft, DocsAnchor } from '../anchors';
import { useMountedEditor, viewOf } from '../core/hooks';
import type { DocsContext } from '../modules/types';
import { decide, DRAFT_ID, DRAFT_KEY, startComment } from './actions';
import { DraftCard, Pictures, SuggestionCard, ThreadCard } from './cards';
import { highlightKey, rangeOf, setHighlights, type HighlightsStorage, type HighlightThread } from './highlights';
import { awarenessOf, linkRoom } from './live';
import { drawnId, suggestionKey, threadKey, useReview, type ReviewSnapshot, type ReviewStore, type Writer } from './store';
import { collectSuggestions, suggestKey, type Refusal, type Suggestion, type SuggestionsStorage } from './suggest';
import './review.css';

const MARGIN_W = 280;
/** Between the page and the cards, and the cards and the stage's edge. */
const SIDE_GAP = 24;
const CARD_GAP = 12;
const ACTIVE_SHIFT = -12;

const REFUSED: Record<Refusal, string> = {
  format: 'Only typing and deleting can be suggested. Switch to Editing for this.',
  code: 'Suggestions can’t go in code. Switch to Editing for this.'
};

/** `key` is what the store calls it; `rkey` is the element's, which a posted thread keeps. */
type Item =
  | { key: string; rkey: string; kind: 'draft'; draft: AnchorDraft }
  | { key: string; rkey: string; kind: 'thread'; thread: CommentThread }
  | { key: string; rkey: string; kind: 'suggestion'; suggestion: Suggestion };

export const writerOf = (me: { id: string; name: string; avatarUrl: string | null } | null): Writer =>
  me ? { id: me.id, name: me.name, avatarUrl: me.avatarUrl } : { id: null, name: 'Guest' };

/** The open threads, and the comment being written, as the page draws them. */
function drawnThreads(snap: ReviewSnapshot): HighlightThread[] {
  const out: HighlightThread[] = [];
  for (const t of snap.threads ?? []) if (!t.resolved && t.anchor.kind === 'docs') out.push({ id: t.id, anchor: t.anchor as DocsAnchor });
  if (snap.draft) out.push({ id: DRAFT_ID, anchor: { kind: 'docs', ...snap.draft } });
  return out;
}

export function ReviewHost({ ctx }: { ctx: DocsContext }) {
  const editor = useMountedEditor(ctx.editor);
  const { me } = useApp();
  const enabled = ctx.can.comments;
  const { store, snap } = useReview(ctx.meta.id, enabled);
  const latest = useRef(ctx);
  latest.current = ctx;

  // A refused write is said once, where everything else is said.
  useEffect(() => {
    if (!enabled) return;
    store.onError = (text) => latest.current.notify({ text, tone: 'danger' });
    return () => {
      store.onError = null;
    };
  }, [store, enabled]);

  useEffect(() => {
    if (!enabled || !editor) return;
    const awareness = awarenessOf(editor);
    return awareness ? linkRoom(store, awareness) : undefined;
  }, [store, enabled, editor]);

  // The page needs to know who is typing a suggestion, and whether one is.
  const authorId = ctx.can.suggest && me ? me.id : null;
  const authorName = me?.name ?? '';
  useLayoutEffect(() => {
    if (!editor) return;
    const now = suggestKey.getState(editor.state);
    if (!now) return;
    const author = authorId ? { id: authorId, name: authorName } : null;
    const patch: { mode?: string; author?: typeof author } = {};
    if (now.mode !== ctx.mode) patch.mode = ctx.mode;
    if (now.author?.id !== author?.id || now.author?.name !== author?.name) patch.author = author;
    if (patch.mode !== undefined || patch.author !== undefined) editor.commands.setSuggestState(patch);
  }, [editor, ctx.mode, authorId, authorName]);

  // What Suggesting cannot make a suggestion of is refused, and said, not too often.
  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as unknown as { suggestions?: SuggestionsStorage }).suggestions;
    if (!storage) return;
    let said = 0;
    storage.onRefused = (reason) => {
      if (Date.now() - said < 4000) return;
      said = Date.now();
      latest.current.notify({ text: REFUSED[reason] });
    };
    return () => {
      storage.onRefused = null;
    };
  }, [editor]);

  // The page tells the cards what was clicked, and Ctrl+Alt+M starts a comment.
  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as unknown as { commentHighlights?: HighlightsStorage }).commentHighlights;
    if (!storage) return;
    storage.onActivate = (key) => {
      store.setActive(key);
      const c = latest.current;
      if (key && c.can.comments && !store.get().margin) c.panes.open('comments');
    };
    storage.onComment = () => startComment(latest.current);
    return () => {
      storage.onActivate = null;
      storage.onComment = null;
    };
  }, [editor, store]);

  // The highlights follow the threads and the active card.
  const threads = useMemo(() => (enabled ? drawnThreads(snap) : []), [enabled, snap.threads, snap.draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(setHighlights(editor.state.tr, { threads, active: snap.active }));
  }, [editor, threads, snap.active]);

  // The suggestions are read out of the page once a frame after it changes.
  useEffect(() => {
    if (!editor || !enabled) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (editor.isDestroyed) return;
      store.setSuggestions(collectSuggestions(editor.state.doc));
      store.setMarkup(suggestKey.getState(editor.state)?.markup ?? 'all');
    };
    const bump = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || transaction.getMeta(suggestKey)) bump();
    };
    read();
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
      cancelAnimationFrame(frame);
    };
  }, [editor, enabled, store]);

  if (!editor || !enabled) return null;
  return <Margin editor={editor} ctx={ctx} store={store} snap={snap} writer={writerOf(me)} canMention={me !== null} />;
}

// ── the margin ──────────────────────────────────────────────────────────────

function Margin({
  editor,
  ctx,
  store,
  snap,
  writer,
  canMention
}: {
  editor: Editor;
  ctx: DocsContext;
  store: ReviewStore;
  snap: ReviewSnapshot;
  writer: Writer;
  canMention: boolean;
}) {
  const paper = useMemo(() => viewOf(editor)?.dom.closest<HTMLElement>('.oa-paper') ?? null, [editor]);
  const [roomy, setRoomy] = useState(false);
  // Everyone's picture the threads know of, and the writer's own: a suggestion and a message being sent carry none.
  const pictures = useMemo(() => {
    const out = new Map<string, string>();
    for (const t of snap.threads ?? []) for (const m of t.messages) if (m.authorId && m.authorAvatarUrl) out.set(m.authorId, m.authorAvatarUrl);
    if (writer.id && writer.avatarUrl) out.set(writer.id, writer.avatarUrl);
    return out;
  }, [snap.threads, writer]);
  const zoom = useRef(1);

  const measure = useCallback(() => {
    const inner = paper?.parentElement;
    if (!paper || !inner) return;
    zoom.current = parseFloat(getComputedStyle(paper).zoom) || 1;
    const need = paper.getBoundingClientRect().width + (MARGIN_W + SIDE_GAP * 2) * zoom.current;
    setRoomy(inner.getBoundingClientRect().width >= need);
  }, [paper]);

  const items = useMemo(() => {
    const out: Item[] = [];
    if (snap.draft && ctx.can.comment) out.push({ key: DRAFT_KEY, rkey: DRAFT_KEY, kind: 'draft', draft: snap.draft });
    for (const t of snap.threads ?? [])
      if (!t.resolved && t.anchor.kind === 'docs') out.push({ key: threadKey(t.id), rkey: threadKey(drawnId(t.id)), kind: 'thread', thread: t });
    if (snap.markup === 'all')
      for (const s of snap.suggestions) out.push({ key: suggestionKey(s.id), rkey: suggestionKey(s.id), kind: 'suggestion', suggestion: s });
    return out;
  }, [snap.draft, snap.threads, snap.suggestions, snap.markup, ctx.can.comment]);

  // Where cards go (beside the page, or the pane), and whether there are any to draw. A
  // comment started on a page with no cards yet goes beside it too, not into the pane.
  const beside = roomy && !ctx.panes.isOpen('comments');
  const on = beside && items.length > 0;

  // The paper steps left to make room, and glides there.
  useLayoutEffect(() => {
    if (!paper) return;
    if ((paper.dataset.reviewMargin === 'on') !== on) {
      const before = boxOf(paper);
      if (on) paper.dataset.reviewMargin = 'on';
      else delete paper.dataset.reviewMargin;
      flip(paper, before);
    }
    store.setMargin(beside);
  }, [on, beside, paper, store]);
  useEffect(
    () => () => {
      if (paper) delete paper.dataset.reviewMargin;
      store.setMargin(false);
    },
    [paper, store]
  );

  // A card that goes (resolved, accepted, deleted) fades where it was before it is removed.
  const last = useRef(new Map<string, Item>());
  const [ghosts, setGhosts] = useState<Item[]>([]);
  useLayoutEffect(() => {
    const now = new Map(items.map((i) => [i.rkey, i]));
    const gone = on ? [...last.current.values()].filter((i) => !now.has(i.rkey)) : [];
    last.current = now;
    if (!gone.length) return;
    setGhosts((g) => [...g.filter((x) => !now.has(x.rkey) && !gone.some((y) => y.rkey === x.rkey)), ...gone]);
    setTimeout(() => setGhosts((g) => g.filter((x) => !gone.includes(x))), DUR.fast + 30);
  }, [items, on]);

  // ── placing the cards ──

  const aside = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const live = useRef({ items, active: snap.active });
  live.current = { items, active: snap.active };
  const observer = useRef<ResizeObserver | null>(null);
  const frame = useRef(0);

  const layout = useCallback(() => {
    const view = viewOf(editor);
    const box = aside.current;
    if (!view || !box) return;
    const state = view.state;
    const size = state.doc.content.size;
    const k = zoom.current;
    const top0 = box.getBoundingClientRect().top;
    const { items: list, active } = live.current;

    const hl = highlightKey.getState(state);
    const threadAt = new Map<string, number>();
    for (const d of hl?.decos.find() ?? []) {
      const id = (d.spec as { thread?: string }).thread;
      if (id) threadAt.set(id, Math.min(threadAt.get(id) ?? Infinity, d.from));
    }
    // A card can be drawn before its highlight is: the highlights are handed over after the
    // cards' first layout. Until then it is placed from its anchor, or it would be hidden, and
    // a hidden composer cannot take the focus.
    const handed = new Set(hl?.threads.map((t) => t.id));
    const anchored = (it: Item): number | undefined => {
      if (it.kind === 'suggestion') return it.suggestion.from;
      const id = it.kind === 'draft' ? DRAFT_ID : it.thread.id;
      const at = threadAt.get(id);
      if (at !== undefined || handed.has(id)) return at;
      const anchor = it.kind === 'draft' ? ({ kind: 'docs', ...it.draft } as DocsAnchor) : (it.thread.anchor as DocsAnchor);
      return rangeOf(state, anchor)?.from;
    };

    const rows: { el: HTMLElement; key: string; y: number; h: number; pos: number }[] = [];
    for (const it of list) {
      const el = els.current.get(it.key);
      if (!el) continue;
      const pos = anchored(it);
      let y: number | null = null;
      if (pos !== undefined && pos <= size) {
        try {
          y = (view.coordsAtPos(pos, 1).top - top0) / k;
        } catch {
          y = null;
        }
      }
      // A thread whose text is gone has nowhere to sit; the pane still lists it.
      if (y === null) {
        el.dataset.placed = 'none';
        continue;
      }
      rows.push({ el, key: it.key, y, h: el.offsetHeight, pos: pos! });
    }
    rows.sort((a, b) => a.y - b.y || a.pos - b.pos);

    // Each card as near its text as the cards around it allow; the active one exactly there.
    const n = rows.length;
    const tops: number[] = new Array<number>(n).fill(0);
    const down = (from: number) => {
      for (let i = from; i < n; i++) tops[i] = i === 0 ? Math.max(0, rows[0]!.y) : Math.max(rows[i]!.y, tops[i - 1]! + rows[i - 1]!.h + CARD_GAP);
    };
    const ai = rows.findIndex((r) => r.key === active);
    if (ai < 0) down(0);
    else {
      tops[ai] = Math.max(0, rows[ai]!.y);
      for (let i = ai - 1; i >= 0; i--) tops[i] = Math.min(rows[i]!.y, tops[i + 1]! - CARD_GAP - rows[i]!.h);
      if (tops[0]! < 0) down(0);
      else down(ai + 1);
    }

    for (let i = 0; i < n; i++) {
      const { el, key } = rows[i]!;
      const t = `translate(${key === active ? ACTIVE_SHIFT : 0}px, ${Math.round(tops[i]!)}px)`;
      if (el.dataset.placed !== 'yes') {
        // Placed where it belongs before it is seen, and from then on it slides.
        el.style.transition = 'none';
        el.style.transform = t;
        void el.offsetWidth;
        el.style.transition = '';
        el.dataset.placed = 'yes';
      } else if (el.style.transform !== t) el.style.transform = t;
    }
  }, [editor]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      layout();
    });
  }, [layout]);

  // After every render: new cards, a new active card, a card that grew.
  useLayoutEffect(() => {
    measure();
    if (on) layout();
  });

  useEffect(() => {
    if (!on) return;
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || transaction.getMeta(highlightKey)) schedule();
    };
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [editor, on, schedule]);

  // The page reflows, the window or the stage resizes, the zoom moves, a card grows.
  useEffect(() => {
    if (!paper) return;
    const again = () => {
      measure();
      schedule();
    };
    const ro = new ResizeObserver(again);
    ro.observe(paper);
    if (paper.parentElement) ro.observe(paper.parentElement);
    for (const el of els.current.values()) ro.observe(el);
    observer.current = ro;
    const shell = paper.closest('.oa-shell');
    const mo = new MutationObserver(again);
    if (shell) mo.observe(shell, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', again);
    return () => {
      ro.disconnect();
      mo.disconnect();
      observer.current = null;
      window.removeEventListener('resize', again);
    };
  }, [paper, measure, schedule]);

  // One ref callback per key, kept: a new one each render would unhook and re-observe every card.
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const slot = (key: string) => {
    let fn = refs.current.get(key);
    if (!fn) {
      fn = (el) => {
        const prev = els.current.get(key);
        if (prev && prev !== el) observer.current?.unobserve(prev);
        if (el) {
          els.current.set(key, el);
          observer.current?.observe(el);
        } else {
          els.current.delete(key);
          refs.current.delete(key);
        }
      };
      refs.current.set(key, fn);
    }
    return fn;
  };

  if (!paper || !on) return null;

  const present = new Set(items.map((i) => i.rkey));
  const shown = [...items, ...ghosts.filter((g) => !present.has(g.rkey))];

  const card = (it: Item, ghost: boolean) => {
    const active = !ghost && snap.active === it.key;
    const activate = () => store.setActive(it.key);
    switch (it.kind) {
      case 'draft':
        return <DraftCard documentId={ctx.meta.id} draft={it.draft} store={store} writer={writer} canMention={canMention} editor={editor} />;
      case 'thread':
        return (
          <ThreadCard
            documentId={ctx.meta.id}
            thread={it.thread}
            store={store}
            writer={writer}
            isOwner={ctx.caps.owner}
            canComment={ctx.can.comment}
            canMention={canMention}
            active={active}
            onActivate={activate}
          />
        );
      case 'suggestion':
        return (
          <SuggestionCard
            suggestion={it.suggestion}
            canDecide={!!ctx.can.suggest}
            active={active}
            onActivate={activate}
            onDecide={(accept) => decide(ctx, accept, it.suggestion.id)}
          />
        );
    }
  };

  return createPortal(
    <div ref={aside} className="rv-margin" aria-label="Changes and comments" role="complementary">
      {shown.map((it) => {
        const ghost = !present.has(it.rkey);
        return (
          <div
            key={it.rkey}
            ref={ghost ? undefined : slot(it.key)}
            className="rv-slot oa-fade"
            data-state={ghost ? 'closed' : undefined}
            data-on={!ghost && snap.active === it.key ? 'true' : undefined}
            aria-hidden={ghost ? true : undefined}
          >
            <Pictures.Provider value={pictures}>{card(it, ghost)}</Pictures.Provider>
          </div>
        );
      })}
    </div>,
    paper
  );
}
