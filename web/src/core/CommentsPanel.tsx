/**
 * Comments and changes, in the side pane (the shell draws its title and close button).
 *
 * The same cards as the margin beside the page (docs/review/cards.tsx), from the same store
 * (docs/review/store.ts), listed in page order: where there is no room beside the page, or
 * the reader has opened this, this is where they are. Choosing a card shows its text in the
 * page. A thread whose text has been deleted says so and keeps its quote.
 */

import { useEffect, useMemo, useState } from 'react';
import type { CommentThread } from '@shared/api';
import type { DocsAnchor } from '../docs/anchors';
import { decide, focusStop } from '../docs/review/actions';
import { DraftCard, SuggestionCard, ThreadCard } from '../docs/review/cards';
import { rangeOf } from '../docs/review/highlights';
import { writerOf } from '../docs/review/ReviewHost';
import { drawnId, suggestionKey, threadKey, useReview } from '../docs/review/store';
import type { DocsContext } from '../docs/modules/types';
import { useFlipList } from '../motion/flip';
import { useApp } from '../state';
import { Button, Chip } from './controls';
import { Banner, Bone } from './ui';

type Show = 'open' | 'resolved' | 'changes';

export function CommentsPanel({ ctx }: { ctx: DocsContext }) {
  const { me } = useApp();
  const { store, snap } = useReview(ctx.meta.id, ctx.can.comments);
  const editor = ctx.editor;
  const writer = writerOf(me);
  const [show, setShow] = useState<Show>(() => (snap.active?.startsWith('s:') ? 'changes' : 'open'));

  // Where each thread is in the page now, or null when its text is gone. Before the room's
  // state has arrived nothing resolves, and that is not a deletion.
  const placed = useMemo(() => {
    const out = new Map<string, number | null>();
    if (!editor || editor.isDestroyed) return out;
    for (const t of snap.threads ?? []) {
      if (t.anchor.kind !== 'docs') continue;
      out.set(t.id, rangeOf(editor.state, t.anchor as DocsAnchor)?.from ?? null);
    }
    return out;
    // The page's text is read when the threads change, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, snap.threads]);
  const settled = ctx.connection === 'live' || ctx.connection === 'local';

  const byPage = (a: CommentThread, b: CommentThread) => {
    const pa = placed.get(a.id) ?? Infinity;
    const pb = placed.get(b.id) ?? Infinity;
    return pa - pb || a.createdAt - b.createdAt;
  };
  const open = (snap.threads ?? []).filter((t) => !t.resolved).sort(byPage);
  const resolved = (snap.threads ?? []).filter((t) => t.resolved).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  const changes = snap.suggestions;
  const showChanges = changes.length > 0 || !!ctx.can.suggest;

  // A card made active from the page comes to the front of the pane.
  useEffect(() => {
    if (!snap.active) return;
    if (snap.active.startsWith('s:')) setShow('changes');
    else if (snap.active.startsWith('t:')) {
      const t = snap.threads?.find((x) => threadKey(x.id) === snap.active);
      if (t) setShow(t.resolved ? 'resolved' : 'open');
    }
  }, [snap.active, snap.threads]);

  const keys = show === 'changes' ? changes.map((s) => suggestionKey(s.id)) : (show === 'open' ? open : resolved).map((t) => threadKey(drawnId(t.id)));
  // The list, not the pane, is the frame of reference: it scrolls with its cards.
  const flips = useFlipList(keys);

  useEffect(() => {
    if (!snap.active) return;
    const el = flips.container.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(snap.active)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [snap.active, show, flips.container]);

  const focusThread = (t: CommentThread) => {
    const from = placed.get(t.id);
    if (from === null || from === undefined) store.setActive(threadKey(t.id));
    else focusStop(ctx, { key: threadKey(t.id), from, to: from });
  };

  return (
    <div className="rv-pane oa-scroll">
      {ctx.can.comment && !snap.draft && (
        <Button variant="secondary" size="md" fullWidth onClick={() => ctx.actions.startComment()}>
          Comment on selection
        </Button>
      )}

      {snap.draft && ctx.can.comment && !snap.margin && (
        <DraftCard documentId={ctx.meta.id} draft={snap.draft} store={store} writer={writer} canMention={me !== null} quote editor={editor} />
      )}

      {snap.error && <Banner tone="danger">{snap.error}</Banner>}

      <div role="group" aria-label="Show" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip pressed={show === 'open'} onClick={() => setShow('open')}>
          Open · {open.length}
        </Chip>
        <Chip pressed={show === 'resolved'} onClick={() => setShow('resolved')}>
          Resolved · {resolved.length}
        </Chip>
        {showChanges && (
          <Chip pressed={show === 'changes'} onClick={() => setShow('changes')}>
            Changes · {changes.length}
          </Chip>
        )}
      </div>

      {!snap.threads && !snap.error && show !== 'changes' && (
        <div role="status" aria-busy="true" aria-label="Loading" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {['88%', '64%'].map((w) => (
            <div key={w} className="rv-card">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bone w={26} h={26} r={13} />
                <Bone w="38%" h={10} />
              </span>
              <Bone w={w} h={10} />
              <Bone w="52%" h={10} />
            </div>
          ))}
        </div>
      )}

      <div ref={flips.container as React.RefObject<HTMLDivElement>} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {show === 'changes' ? (
          changes.length === 0 ? (
            <p className="rv-note" style={{ margin: '8px 4px', fontSize: 14 }}>
              {ctx.can.suggest ? 'No changes. Choose Suggesting to track yours.' : 'No changes.'}
            </p>
          ) : (
            changes.map((s) => {
              const key = suggestionKey(s.id);
              return (
                <div key={key} ref={flips.item(key)} data-card={key} className="oa-fade">
                  <SuggestionCard
                    suggestion={s}
                    canDecide={!!ctx.can.suggest}
                    active={snap.active === key}
                    onActivate={() => focusStop(ctx, { key, from: s.from, to: s.to })}
                    onDecide={(accept) => decide(ctx, accept, s.id)}
                  />
                </div>
              );
            })
          )
        ) : (
          snap.threads &&
          ((show === 'open' ? open : resolved).length === 0 ? (
            <p className="rv-note" style={{ margin: '8px 4px', fontSize: 14 }}>
              {show === 'open' ? (ctx.can.comment ? 'No open comments. Select text and comment on it.' : 'No open comments.') : 'Nothing resolved yet.'}
            </p>
          ) : (
            (show === 'open' ? open : resolved).map((t) => {
              const key = threadKey(t.id);
              const rkey = threadKey(drawnId(t.id));
              return (
                <div key={rkey} ref={flips.item(rkey)} data-card={key} className="oa-fade">
                  <ThreadCard
                    documentId={ctx.meta.id}
                    thread={t}
                    store={store}
                    writer={writer}
                    isOwner={ctx.caps.owner}
                    canComment={ctx.can.comment}
                    canMention={me !== null}
                    active={snap.active === key}
                    detached={settled && placed.get(t.id) === null}
                    quote
                    onActivate={() => focusThread(t)}
                  />
                </div>
              );
            })
          ))
        )}
      </div>
    </div>
  );
}
