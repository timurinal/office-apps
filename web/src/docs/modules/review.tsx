/**
 * Review: comments, suggestions, version history and the lock.
 *
 * The pieces live in docs/review/: the suggestion marks and the transaction rewrite that
 * makes typing in Suggesting a suggestion (suggest.ts), the comment highlights
 * (highlights.ts), the store every card reads (store.ts), the cards (cards.tsx), and the
 * margin and the wiring between the page and the cards (ReviewHost.tsx), which rides on a
 * footer item as CoreHost does. The pane is core/CommentsPanel.tsx.
 *
 * Who may do what is `ctx.can`: `comment` starts a thread, `comments` shows them, and
 * `suggest` (an editor or the owner, signed in) offers Suggesting and decides on changes. A
 * commenter is never offered Suggesting: the room refuses a commenter's Yjs updates, and a
 * suggestion is one.
 */

import {
  caretDownIcon,
  caretLeftIcon,
  caretRightIcon,
  caretUpIcon,
  chatCircleTextIcon,
  checkIcon,
  clockCounterClockwiseIcon,
  lockKeyIcon,
  notePencilIcon,
  xIcon
} from '../../core/icons';
import { CommentsPanel } from '../../core/CommentsPanel';
import { mod } from '../../core/keys';
import { currentSuggestion, decide, hasSuggestions, startComment, step } from '../review/actions';
import { Highlights } from '../review/highlights';
import { ReviewHost } from '../review/ReviewHost';
import { useReview } from '../review/store';
import { suggestKey, Suggestions, type Markup } from '../review/suggest';
import type { DocsContext, DocsModule } from './types';

const markupOf = (c: DocsContext): Markup => (c.editor && !c.editor.isDestroyed ? (suggestKey.getState(c.editor.state)?.markup ?? 'all') : 'all');
const suggesting = (c: DocsContext) => c.mode === 'suggesting';
const canDecide = (c: DocsContext) => !!c.can.suggest;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "2 changes · 1 comment" in the footer; a click opens the pane. */
function ReviewStatus({ ctx }: { ctx: DocsContext }) {
  const { snap } = useReview(ctx.meta.id, true);
  const comments = snap.threads?.filter((t) => !t.resolved).length ?? 0;
  const changes = snap.suggestions.length;
  if (!comments && !changes) return null;
  const text = [changes ? plural(changes, 'change') : '', comments ? plural(comments, 'comment') : ''].filter(Boolean).join(' · ');
  return (
    <button type="button" className="oa-status oa-wordbtn" title="Show comments" onClick={() => ctx.panes.toggle('comments')}>
      {text}
    </button>
  );
}

export const reviewModule: DocsModule = {
  id: 'review',
  extensions: [Suggestions, Highlights],

  ribbon: [
    {
      id: 'review.comments',
      tab: 'review',
      order: 100,
      label: 'Comments',
      items: [
        {
          type: 'button',
          id: 'review.new-comment',
          label: 'New comment',
          icon: chatCircleTextIcon,
          shortcut: mod('Alt+M'),
          showLabel: true,
          visible: (c) => c.can.comment,
          // A thread is attached to text, so there has to be some selected.
          disabled: (c) => !c.editor || c.editor.state.selection.empty,
          run: (c) => void startComment(c)
        },
        {
          type: 'button',
          id: 'review.prev-comment',
          label: 'Previous comment',
          icon: caretUpIcon,
          visible: (c) => c.can.comments,
          run: (c) => step(c, 'comment', -1)
        },
        {
          type: 'button',
          id: 'review.next-comment',
          label: 'Next comment',
          icon: caretDownIcon,
          visible: (c) => c.can.comments,
          run: (c) => step(c, 'comment', 1)
        },
        {
          type: 'button',
          id: 'review.show-comments',
          label: 'Show comments',
          icon: chatCircleTextIcon,
          showLabel: true,
          visible: (c) => c.can.comments,
          active: (c) => c.panes.isOpen('comments'),
          run: (c) => c.panes.toggle('comments')
        }
      ]
    },
    {
      id: 'review.tracking',
      tab: 'review',
      order: 150,
      label: 'Tracking',
      items: [
        {
          type: 'button',
          id: 'review.track-changes',
          label: 'Track changes',
          icon: notePencilIcon,
          showLabel: true,
          visible: canDecide,
          active: suggesting,
          run: (c) => c.setMode(suggesting(c) ? 'editing' : 'suggesting')
        },
        {
          type: 'select',
          id: 'review.markup',
          label: 'Show markup',
          width: 118,
          visible: (c) => c.can.comments,
          options: [
            { value: 'all', label: 'All markup' },
            { value: 'none', label: 'No markup' }
          ],
          value: markupOf,
          run: (c, value) => c.editor?.commands.setSuggestState({ markup: value === 'none' ? 'none' : 'all' })
        }
      ]
    },
    {
      id: 'review.changes',
      tab: 'review',
      order: 160,
      label: 'Changes',
      items: [
        {
          type: 'split',
          id: 'review.accept',
          label: 'Accept',
          icon: checkIcon,
          showLabel: true,
          visible: canDecide,
          disabled: (c) => !hasSuggestions(c),
          run: (c) => decide(c, true),
          menu: [
            { label: 'Accept this change', icon: checkIcon, disabled: (c) => !currentSuggestion(c), run: (c) => decide(c, true) },
            { label: 'Accept all changes', run: (c) => decide(c, true, 'all') }
          ]
        },
        {
          type: 'split',
          id: 'review.reject',
          label: 'Reject',
          icon: xIcon,
          showLabel: true,
          visible: canDecide,
          disabled: (c) => !hasSuggestions(c),
          run: (c) => decide(c, false),
          menu: [
            { label: 'Reject this change', icon: xIcon, disabled: (c) => !currentSuggestion(c), run: (c) => decide(c, false) },
            { label: 'Reject all changes', run: (c) => decide(c, false, 'all') }
          ]
        },
        {
          type: 'button',
          id: 'review.prev-change',
          label: 'Previous change',
          icon: caretLeftIcon,
          visible: (c) => c.can.comments,
          disabled: (c) => !hasSuggestions(c),
          run: (c) => step(c, 'change', -1)
        },
        {
          type: 'button',
          id: 'review.next-change',
          label: 'Next change',
          icon: caretRightIcon,
          visible: (c) => c.can.comments,
          disabled: (c) => !hasSuggestions(c),
          run: (c) => step(c, 'change', 1)
        }
      ]
    },
    {
      id: 'review.history',
      tab: 'review',
      order: 200,
      label: 'History',
      items: [
        {
          type: 'button',
          id: 'review.version-history',
          label: 'Version history',
          icon: clockCounterClockwiseIcon,
          showLabel: true,
          visible: (c) => c.can.history,
          active: (c) => c.panes.isOpen('history'),
          run: (c) => c.panes.toggle('history')
        }
      ]
    },
    {
      id: 'review.protect',
      tab: 'review',
      order: 300,
      label: 'Protect',
      items: [
        {
          type: 'button',
          id: 'review.lock',
          label: 'Lock',
          icon: lockKeyIcon,
          showLabel: true,
          visible: (c) => c.can.lock,
          run: (c) => c.actions.lock()
        }
      ]
    }
  ],

  commands: [
    {
      id: 'review.comment',
      title: 'New comment',
      section: 'Review',
      icon: chatCircleTextIcon,
      shortcut: mod('Alt+M'),
      keywords: ['annotate'],
      visible: (c) => c.can.comment,
      run: (c) => void startComment(c)
    },
    {
      id: 'review.comments',
      title: 'Show comments',
      section: 'Review',
      icon: chatCircleTextIcon,
      visible: (c) => c.can.comments,
      run: (c) => c.panes.open('comments')
    },
    {
      id: 'review.track',
      title: 'Track changes',
      section: 'Review',
      icon: notePencilIcon,
      keywords: ['suggest', 'suggesting', 'suggestion'],
      visible: canDecide,
      run: (c) => c.setMode(suggesting(c) ? 'editing' : 'suggesting')
    },
    {
      id: 'review.accept-all',
      title: 'Accept all changes',
      section: 'Review',
      icon: checkIcon,
      keywords: ['suggestions'],
      visible: canDecide,
      disabled: (c) => !hasSuggestions(c),
      run: (c) => decide(c, true, 'all')
    },
    {
      id: 'review.reject-all',
      title: 'Reject all changes',
      section: 'Review',
      icon: xIcon,
      keywords: ['suggestions'],
      visible: canDecide,
      disabled: (c) => !hasSuggestions(c),
      run: (c) => decide(c, false, 'all')
    },
    {
      id: 'review.next-change',
      title: 'Next change',
      section: 'Review',
      icon: caretRightIcon,
      keywords: ['suggestion'],
      visible: (c) => c.can.comments,
      disabled: (c) => !hasSuggestions(c),
      run: (c) => step(c, 'change', 1)
    },
    {
      id: 'review.history',
      title: 'Version history',
      section: 'Review',
      icon: clockCounterClockwiseIcon,
      keywords: ['restore', 'versions', 'earlier'],
      visible: (c) => c.can.history,
      run: (c) => c.panes.open('history')
    }
  ],

  panes: [
    {
      id: 'comments',
      side: 'right',
      title: 'Comments',
      width: 360,
      visible: (c) => c.can.comments,
      render: (c) => <CommentsPanel ctx={c} />
    }
  ],

  statusItems: [
    { id: 'status.review', side: 'left', order: 20, visible: (c) => c.can.comments, render: (c) => <ReviewStatus ctx={c} /> },
    // Draws nothing in the footer: the margin is portalled into the page (review/ReviewHost.tsx).
    { id: 'status.review-host', side: 'right', order: 1001, render: (c) => <ReviewHost ctx={c} /> }
  ],

  modes: [{ id: 'suggesting', label: 'Suggesting', icon: notePencilIcon, order: 150 }]
};
