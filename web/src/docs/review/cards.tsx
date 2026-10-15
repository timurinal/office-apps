/**
 * The cards: a comment thread, a suggestion, and a comment being written. The same cards
 * are drawn beside the page (the margin, ReviewHost.tsx) and in the pane
 * (core/CommentsPanel.tsx); only where they sit differs.
 *
 * Every button answers in the frame it is pressed in: the store (store.ts) draws the
 * change and sends it after, and Accept and Reject are transactions on the page.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { PATHS, type CommentMessage, type CommentThread, type MentionCandidate, type MentionPeopleResponse } from '@shared/api';
import { get } from '../../api';
import { colorFor } from '../../core/color';
import { Button, IconButton } from '../../core/controls';
import { arrowCounterClockwiseIcon, checkCircleIcon, checkIcon, dotsThreeIcon, pencilSimpleIcon, trashIcon, xIcon } from '../../core/icons';
import { Avatar, Menu, type MenuItem } from '../../core/ui';
import { formatWhen } from '../../theme';
import type { AnchorDraft } from '../anchors';
import { isTemp, type ReviewStore, type Writer } from './store';
import type { Suggestion } from './suggest';

const MAX_BODY = 4000;

// ── words typed and not yet sent ────────────────────────────────────────────

/**
 * What is in each box, kept outside React: the composer moves from the pane to the margin
 * when the pane closes, and a card scrolls out and back, and neither may lose a sentence.
 */
const unsent = new Map<string, string>();
export const unsentKey = (documentId: string, what: string) => `${documentId}\u0000${what}`;

// ── mentions ────────────────────────────────────────────────────────────────

const found = new Map<string, Promise<MentionCandidate[]>>();

function people(documentId: string, q: string): Promise<MentionCandidate[]> {
  const key = `${documentId}\u0000${q.toLowerCase()}`;
  let p = found.get(key);
  if (!p) {
    p = get<MentionPeopleResponse>(`${PATHS.commentPeople(documentId)}?q=${encodeURIComponent(q)}`)
      .then((r) => r.people)
      .catch(() => {
        found.delete(key);
        return [];
      });
    found.set(key, p);
  }
  return p;
}

/** The `@word` being typed at the caret, or null. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
}

/** The token a picked person is written as: their handle, or their name. */
export const tokenFor = (p: MentionCandidate) => `@${p.handle ?? p.name}`;

interface Picked {
  userId: string;
  token: string;
}

/** The ids of the people picked whose token is still in the text. */
export const mentionIds = (text: string, picked: readonly Picked[]): string[] => [
  ...new Set(picked.filter((p) => text.includes(p.token)).map((p) => p.userId))
];

/**
 * A box for a comment, with the @ picker. The picker lists the people who can open the
 * document; a guest gets none, and can still type a handle, which the server resolves.
 */
export function MentionInput({
  documentId,
  storeKey,
  canMention,
  label,
  placeholder,
  multiline = false,
  autoFocus = false,
  initial = '',
  onSubmit,
  onCancel,
  onText,
  submitRef
}: {
  documentId: string;
  /** Where the unsent text is kept; null to keep none. */
  storeKey: string | null;
  canMention: boolean;
  label: string;
  placeholder: string;
  /** Enter makes a new line and Ctrl+Enter sends, rather than Enter sending. */
  multiline?: boolean;
  autoFocus?: boolean;
  initial?: string;
  onSubmit: (text: string, mentions: string[]) => void;
  onCancel?: () => void;
  onText?: (text: string) => void;
  /** Set to this box's send, for a button outside it. */
  submitRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [text, setTextState] = useState(() => (storeKey ? (unsent.get(storeKey) ?? initial) : initial));
  const [list, setList] = useState<MentionCandidate[]>([]);
  const [at, setAt] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const picked = useRef<Picked[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const asked = useRef(0);

  const setText = (v: string) => {
    setTextState(v);
    if (storeKey) {
      if (v) unsent.set(storeKey, v);
      else unsent.delete(storeKey);
    }
    onText?.(v);
  };

  useEffect(() => {
    if (!autoFocus) return;
    const el = box.current;
    if (!el) return;
    // Without scrolling: the card is placed by transform, and a scroll to it would jump the page.
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  // Ask for people a beat after the typing stops; an answer to an older question is dropped.
  useEffect(() => {
    if (!at || !canMention) {
      setList([]);
      return;
    }
    const n = ++asked.current;
    const timer = setTimeout(() => {
      void people(documentId, at.query).then((r) => {
        if (n !== asked.current) return;
        setList(r);
        setIndex(0);
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [at, canMention, documentId]);

  const look = (el: HTMLTextAreaElement) => setAt(mentionAt(el.value, el.selectionStart ?? el.value.length));

  const pick = (p: MentionCandidate) => {
    const el = box.current;
    if (!el || !at) return;
    const token = tokenFor(p);
    const caret = el.selectionStart ?? text.length;
    const next = `${text.slice(0, at.start)}${token} ${text.slice(caret)}`;
    picked.current = [...picked.current.filter((x) => x.userId !== p.userId), { userId: p.userId, token }];
    setText(next);
    setAt(null);
    const end = at.start + token.length + 1;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(end, end);
    });
  };

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    onSubmit(body, mentionIds(body, picked.current));
    picked.current = [];
    setText('');
    setAt(null);
  };

  if (submitRef) submitRef.current = submit;

  const open = at !== null && list.length > 0;

  return (
    <div className="rv-input-wrap">
      <textarea
        ref={box}
        className="rv-input"
        data-multiline={multiline ? 'true' : undefined}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        maxLength={MAX_BODY}
        rows={1}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          setText(e.target.value);
          look(e.target);
        }}
        onSelect={(e) => look(e.currentTarget)}
        onBlur={() => setTimeout(() => setAt(null), 150)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              const p = list[index];
              if (p) pick(p);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setAt(null);
              return;
            }
          }
          if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
          }
          if (e.key === 'Enter' && (multiline ? e.ctrlKey || e.metaKey : !e.shiftKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {open && (
        <div className="rv-people oa-rise" role="listbox" aria-label="People">
          {list.map((p, i) => (
            <button
              key={p.userId}
              type="button"
              role="option"
              aria-selected={i === index}
              className="rv-person"
              // Keep the box focused, so the caret is where the name goes.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
            >
              <Avatar name={p.name} color={colorFor(p.userId)} size={22} />
              <span className="oa-ellipsis">{p.name}</span>
              {p.handle && <span className="rv-handle">@{p.handle}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

/** A message's words, with each `@handle` drawn as one. */
export function Body({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9][a-z0-9._-]*)/gi);
  return (
    <p className="rv-body">
      {parts.map((part, i) =>
        part.startsWith('@') && part.length > 1 ? (
          <span key={i} className="rv-mention">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </p>
  );
}

function Who({ name, id, when, size = 26, edited = false }: { name: string; id: string | null; when: number; size?: number; edited?: boolean }) {
  return (
    <>
      <Avatar name={name} color={colorFor(id ?? `guest:${name}`)} size={size} />
      <span className="rv-who">
        <b className="oa-ellipsis">{name}</b>
        <span>
          {formatWhen(when)}
          {edited && ' · edited'}
        </span>
      </span>
    </>
  );
}

/** A click on the card, but not on a control in it. */
const onCard = (fn: () => void) => (e: React.MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, textarea, input, a, [role="menu"]')) return;
  fn();
};

// ── a thread ────────────────────────────────────────────────────────────────

export interface ThreadCardProps {
  documentId: string;
  thread: CommentThread;
  store: ReviewStore;
  writer: Writer;
  isOwner: boolean;
  canComment: boolean;
  canMention: boolean;
  active: boolean;
  /** The text it was on is gone. The pane says so; the margin never draws one. */
  detached?: boolean;
  /** Show the commented text, for the pane, which is not beside it. */
  quote?: boolean;
  /** Always show the reply box, not only on the active card. */
  alwaysReply?: boolean;
  onActivate: () => void;
}

/** One message's words, or the box that edits them. */
function MessageBody({
  documentId,
  message,
  editing,
  onDone,
  onEdit
}: {
  documentId: string;
  message: CommentMessage;
  editing: boolean;
  onDone: () => void;
  onEdit: (body: string, mentions: string[]) => void;
}) {
  if (!editing) return <Body text={message.body} />;
  return (
    <MentionInput
      documentId={documentId}
      storeKey={null}
      canMention={false}
      label="Edit comment"
      placeholder="Comment"
      multiline
      autoFocus
      initial={message.body}
      onCancel={onDone}
      onSubmit={(text, mentions) => {
        onDone();
        if (text !== message.body) onEdit(text, mentions);
      }}
    />
  );
}

/** Edit and Delete for one message, where this person may. */
function messageMenu(canEdit: boolean, canDelete: boolean, first: boolean, edit: () => void, remove: () => void): MenuItem[] {
  return [
    ...(canEdit ? [{ label: 'Edit', icon: pencilSimpleIcon, onSelect: edit }] : []),
    ...(canDelete ? [{ label: first ? 'Delete thread' : 'Delete', icon: trashIcon, danger: true, onSelect: remove }] : [])
  ];
}

export function ThreadCard({
  documentId,
  thread,
  store,
  writer,
  isOwner,
  canComment,
  canMention,
  active,
  detached = false,
  quote = false,
  alwaysReply = false,
  onActivate
}: ThreadCardProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const first = thread.messages[0];
  if (!first) return null;
  const temp = isTemp(thread.id);
  const mine = (m: CommentMessage) => writer.id !== null && m.authorId === writer.id;
  const anchorQuote = thread.anchor.kind === 'docs' ? thread.anchor.quote : undefined;
  const menuFor = (m: CommentMessage, i: number) =>
    isTemp(m.id) || temp
      ? []
      : messageMenu(
          canComment && mine(m),
          canComment && (isOwner || mine(m)),
          i === 0,
          () => setEditing(m.id),
          () => store.remove(thread.id, i === 0 ? null : m.id)
        );
  const firstMenu = menuFor(first, 0);

  return (
    <div className="rv-card" data-kind="thread" data-active={active ? 'true' : undefined} data-temp={temp ? 'true' : undefined} onClick={onCard(onActivate)}>
      <span className="rv-head">
        <Who name={first.authorName} id={first.authorId} when={first.createdAt} edited={first.editedAt !== null} />
        {canComment && !temp && (
          <IconButton
            size="sm"
            icon={thread.resolved ? arrowCounterClockwiseIcon : checkCircleIcon}
            label={thread.resolved ? 'Reopen' : 'Resolve'}
            title={thread.resolved ? 'Reopen' : 'Resolve'}
            className="rv-resolve"
            onClick={() => store.resolve(thread.id, !thread.resolved, writer)}
          />
        )}
        {firstMenu.length > 0 && <Menu label="More" icon={dotsThreeIcon} items={firstMenu} />}
      </span>
      {quote && anchorQuote && <span className="rv-quote">{anchorQuote}</span>}
      {detached && <span className="rv-note">The text was removed.</span>}
      <MessageBody
        documentId={documentId}
        message={first}
        editing={editing === first.id}
        onDone={() => setEditing(null)}
        onEdit={(body, mentions) => store.edit(thread.id, first.id, body, mentions)}
      />
      {thread.messages.slice(1).map((m, i) => {
        const items = menuFor(m, i + 1);
        return (
          <div key={m.id} className="rv-reply">
            <span className="rv-head">
              <Who name={m.authorName} id={m.authorId} when={m.createdAt} size={22} edited={m.editedAt !== null} />
              {items.length > 0 && <Menu label="More" icon={dotsThreeIcon} items={items} />}
            </span>
            <MessageBody
              documentId={documentId}
              message={m}
              editing={editing === m.id}
              onDone={() => setEditing(null)}
              onEdit={(body, mentions) => store.edit(thread.id, m.id, body, mentions)}
            />
          </div>
        );
      })}
      {canComment && !temp && !thread.resolved && (active || alwaysReply) && (
        <MentionInput
          documentId={documentId}
          storeKey={unsentKey(documentId, `reply:${thread.id}`)}
          canMention={canMention}
          label="Reply"
          placeholder="Reply, or @ to add someone"
          onSubmit={(text, mentions) => store.reply(thread.id, text, mentions, writer)}
        />
      )}
    </div>
  );
}

// ── a suggestion ────────────────────────────────────────────────────────────

const LONG = 140;
const q = (s: string) => `“${s.length > LONG ? `${s.slice(0, LONG).trimEnd()}…` : s.replace(/\n/g, ' ')}”`;
const spaces = (s: string) => (s.length === 1 ? 'a space' : 'spaces');

/** What a suggestion does, as the card says it: a verb and what it acted on. */
export function describe(s: Suggestion): { verb: string; rest: string } {
  // Quoted without the spaces at either end: “ morning” reads as a typo in the card.
  const ins = s.inserted.trim();
  const del = s.deleted.trim();
  if (ins && del) return { verb: 'Replaced', rest: `${q(del)} with ${q(ins)}` };
  if (ins) return { verb: 'Inserted', rest: q(ins) };
  if (del) return { verb: 'Deleted', rest: q(del) };
  if (s.inserted && !s.deleted) return { verb: 'Inserted', rest: spaces(s.inserted) };
  if (s.deleted && !s.inserted) return { verb: 'Deleted', rest: spaces(s.deleted) };
  if (s.breaks) return { verb: 'Inserted', rest: s.breaks === 1 ? 'a paragraph break' : `${s.breaks} paragraph breaks` };
  if (s.joins) return { verb: 'Joined', rest: 'two paragraphs' };
  if (s.nodesAdded) return { verb: 'Inserted', rest: s.nodesAdded === 1 ? 'an object' : `${s.nodesAdded} objects` };
  if (s.nodesRemoved) return { verb: 'Deleted', rest: s.nodesRemoved === 1 ? 'an object' : `${s.nodesRemoved} objects` };
  return { verb: 'Changed', rest: 'the text' };
}

export function SuggestionCard({
  suggestion,
  canDecide,
  active,
  onActivate,
  onDecide
}: {
  suggestion: Suggestion;
  canDecide: boolean;
  active: boolean;
  onActivate: () => void;
  onDecide: (accept: boolean) => void;
}) {
  const { verb, rest } = describe(suggestion);
  return (
    <div className="rv-card" data-kind="suggestion" data-active={active ? 'true' : undefined} onClick={onCard(onActivate)}>
      <span className="rv-head">
        <Who name={suggestion.authorName} id={suggestion.authorId} when={Math.floor(suggestion.at / 1000)} />
        {canDecide && (
          <>
            <IconButton size="sm" icon={checkIcon} label="Accept change" title="Accept" className="rv-accept" onClick={() => onDecide(true)} />
            <IconButton size="sm" icon={xIcon} label="Reject change" title="Reject" className="rv-reject" onClick={() => onDecide(false)} />
          </>
        )}
      </span>
      <p className="rv-body">
        <b>{verb}</b> {rest}
      </p>
    </div>
  );
}

// ── a comment being written ─────────────────────────────────────────────────

export function DraftCard({
  documentId,
  draft,
  store,
  writer,
  canMention,
  quote = false,
  editor
}: {
  documentId: string;
  draft: AnchorDraft;
  store: ReviewStore;
  writer: Writer;
  canMention: boolean;
  quote?: boolean;
  editor: Editor | null;
}) {
  const key = unsentKey(documentId, 'new');
  const [empty, setEmpty] = useState(() => !unsent.get(key));
  const back = () => editor?.commands.focus(undefined, { scrollIntoView: false });
  const cancel = () => {
    unsent.delete(key);
    store.setDraft(null);
    store.setActive(null);
    back();
  };
  const post = (text: string, mentions: string[]) => {
    store.create(draft, text, mentions, writer);
    back();
  };
  const send = useRef<(() => void) | null>(null);

  return (
    <div className="rv-card" data-kind="draft" data-active="true">
      <span className="rv-head">
        <Avatar name={writer.name} color={colorFor(writer.id ?? `guest:${writer.name}`)} size={26} />
        <span className="rv-who">
          <b className="oa-ellipsis">{writer.name}</b>
        </span>
      </span>
      {quote && draft.quote && <span className="rv-quote">{draft.quote}</span>}
      <MentionInput
        documentId={documentId}
        storeKey={key}
        canMention={canMention}
        label="Comment"
        placeholder="Comment, or @ to add someone"
        multiline
        autoFocus
        onText={(t) => setEmpty(!t.trim())}
        onCancel={cancel}
        onSubmit={post}
        submitRef={send}
      />
      <span className="rv-actions">
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={empty}
          // The box owns the mentions it picked, so the button sends through it.
          onClick={() => send.current?.()}
        >
          Comment
        </Button>
      </span>
    </div>
  );
}
