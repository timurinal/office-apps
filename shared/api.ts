/**
 * The HTTP contract of Office, under `/api/office`.
 *
 * Owned by this repo and imported by both halves: the Worker types its handlers
 * against it and the web client types its calls against it, so a field that
 * changes shape fails to compile on the side that did not change. It is the one
 * file here that is *not* a copy of another repository's.
 *
 * ── Rules the types encode ──────────────────────────────────────────────────
 *
 *   · Timestamps are unix seconds, as everywhere in the suite.
 *   · Ids are opaque strings. Never parse one.
 *   · A request body is JSON unless a route says otherwise. Bytes travel raw,
 *     with a `content-type` that is not `application/json`.
 *   · Errors are `ApiErrorBody`. The `code` is what a client switches on.
 *   · A link token is returned **once**, by the call that makes it. Only a hash
 *     is stored, so no read returns one.
 *   · A locked document is end-to-end: its routes carry ciphertext the server
 *     cannot read. Every other route refuses it with 423 `document_locked`.
 *     Nothing else on this page describes a document as end-to-end, and nothing
 *     may: the rest is encrypted at rest and the Worker holds the key.
 *
 * ── Adding to it ────────────────────────────────────────────────────────────
 * Add, do not change. A route this file does not mention belongs in the file of
 * whoever builds it, and moves here when somebody else needs to call it. The
 * `PATHS` table is the one place a path is spelled for a client.
 */

import type { Branding } from './branding';

export const API_BASE = '/api/office';

// ── vocabulary ───────────────────────────────────────────────────────────────

export type DocKind = 'docs' | 'sheets' | 'slides';
export const DOC_KINDS: readonly DocKind[] = ['docs', 'sheets', 'slides'];
export const isDocKind = (v: unknown): v is DocKind =>
  typeof v === 'string' && (DOC_KINDS as readonly string[]).includes(v);

/**
 * What a person can do to a document. `owner` is held by exactly one person and
 * is never assigned through a share, a link or general access.
 *
 *   viewer     read, and follow along in the room
 *   commenter  viewer, and comment
 *   editor     commenter, and change the content, name versions, restore them
 *   owner      editor, and share, lock, rename, trash and transfer
 */
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
/** The roles a share, a link or general access can grant. */
export type ShareRole = Exclude<Role, 'owner'>;

export const ROLE_RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
export const roleAtLeast = (role: Role, min: Role): boolean => ROLE_RANK[role] >= ROLE_RANK[min];
export const isShareRole = (v: unknown): v is ShareRole =>
  v === 'editor' || v === 'commenter' || v === 'viewer';

/** Who, beyond the people added by name, can open a document. */
export type GeneralAccess = 'restricted' | 'org' | 'link';
export const GENERAL_ACCESS: readonly GeneralAccess[] = ['restricted', 'org', 'link'];

/** `user` is a personal template, `org` a company template. `predefined` ships
 *  in this repo and is never a document row. */
export type TemplateScope = 'user' | 'org';
export type TemplateKind = TemplateScope | 'predefined';

/** See migration 0002 for what each kind means. */
export type VersionKind = 'auto' | 'named' | 'restore' | 'assist' | 'import' | 'locked';

// ── limits both sides need ───────────────────────────────────────────────────

export const LIMITS = {
  titleMax: 200,
  versionLabelMax: 120,
  commentMax: 4000,
  /** An image in a document. The page resizes before it uploads. */
  assetMaxBytes: 10 * 1024 * 1024,
  /** Raster formats only. SVG is refused: it can carry script. */
  assetMimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as readonly string[],
  /**
   * The encoded Yjs state of one document, past which the document refuses to
   * grow, and where the page warns. Memory bound, not a storage one: a loaded
   * `Y.Doc` is 16 to 21 times its encoded size on the heap, in a 128 MB
   * isolate. Spike S3's RESULT.md has the measurements.
   */
  docStateMaxBytes: 3 * 1024 * 1024,
  docStateWarnBytes: 2 * 1024 * 1024,
  /** A locked document's ciphertext. The server cannot read it, so this is only
   *  a bound on what one request may make it hold. */
  lockedMaxBytes: 8 * 1024 * 1024,
  /** Link password: wrong guesses per link per hour. */
  linkPasswordAttempts: 10,
  /** How long an unlocked link grants access, in seconds. */
  linkGrantSeconds: 12 * 60 * 60,
  /** Auto versions are kept this long. Named ones are kept until deleted. */
  autoVersionDays: 30
} as const;

// ── errors ───────────────────────────────────────────────────────────────────

/**
 * The codes a client may switch on. The HTTP status carries the class of the
 * failure and this carries which one.
 */
export type ApiErrorCode =
  | 'unauthorized' // 401, no usable session
  | 'second_factor_required' // 403, signed in but the second factor is outstanding
  | 'forbidden' // 403, signed in and not allowed
  | 'not_found' // 404, and also what a document you cannot see answers
  | 'method_not_allowed' // 405
  | 'invalid_field' // 400
  | 'bad_content_type' // 400
  | 'bad_json' // 400
  | 'bad_origin' // 403, a cookie-credentialed write or socket from another origin
  | 'document_locked' // 423, the route does not exist for a locked document
  | 'not_locked' // 409, the route is for a locked document and this one is not
  | 'stale_revision' // 412, If-Match did not match. Carries `rev`
  | 'precondition_required' // 428, a write that needs If-Match sent none
  | 'trashed' // 409, the document is in the trash
  | 'not_trashed' // 409, permanent delete of a document that is not in the trash
  | 'too_large' // 413, over a size limit. Carries `limitBytes`
  | 'rate_limited' // 429
  | 'link_password_wrong' // 401, on the unlock call only
  | 'not_configured' // 503, a binding or the key is missing on this deployment
  | 'not_ready' // 503, migrations are pending
  | 'internal'; // 500

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; [detail: string]: unknown };
  requestId: string;
}

// ── health and identity ──────────────────────────────────────────────────────

/** GET /health. 200 when `ok`, 503 when not. */
export interface Health {
  ok: boolean;
  database: 'ready' | 'migrations_pending' | 'unreachable';
  /** ENCRYPTION_KEY is present. Without it no document can be made or opened. */
  encryption: boolean;
  /** The R2 bucket. */
  files: boolean;
  /** The DocumentRoom namespace. */
  rooms: boolean;
  kv: boolean;
  /** Invite and mention emails are delivered. Off, they are logged. */
  email: boolean;
  /** Organisation access and branding are enforceable. */
  enterprise: boolean;
  missingTables?: string[];
  missingColumns?: string[];
  hint?: string;
}

/** What the caller's organisation shows in place of the default branding. */
export type OrgBranding = Branding;

/** A document that GET /me turned from a pending email invite into a share. */
export interface ClaimedInvite {
  documentId: string;
  kind: DocKind;
  title: string;
  role: ShareRole;
}

/**
 * GET /me. 401 when signed out, 403 `second_factor_required`, 503 `not_ready`.
 *
 * Signing in claims any pending email invites made to this account's **verified**
 * address, and says which in `claimed`. An unverified address claims nothing.
 */
export interface MeResponse {
  id: string;
  name: string;
  email: string;
  /** The profile picture on the account site, or null. */
  avatarUrl: string | null;
  plan: string;
  orgId: string | null;
  branding: OrgBranding | null;
  claimed: ClaimedInvite[];
}

// ── documents ────────────────────────────────────────────────────────────────

export interface DocumentSummary {
  id: string;
  kind: DocKind;
  title: string;
  ownerId: string;
  ownerName: string;
  /** The caller's role on it. */
  role: Role;
  locked: boolean;
  starred: boolean;
  /** Anyone besides the owner can open it. Locked documents are never shared. */
  shared: boolean;
  templateScope: TemplateScope | null;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  /** When the caller last opened it, for the `recent` view. */
  openedAt: number | null;
}

export type DocumentView = 'recent' | 'owned' | 'shared' | 'starred' | 'trash';
export const DOCUMENT_VIEWS: readonly DocumentView[] = [
  'recent',
  'owned',
  'shared',
  'starred',
  'trash'
];

/**
 * GET /documents?view=&kind=&q=&limit=&cursor=
 *
 * `view` defaults to `recent`. `q` matches titles, case-insensitively, and only
 * titles: Office has no content search. `limit` is 1 to 100, default 50.
 */
export interface ListDocumentsQuery {
  view?: DocumentView;
  kind?: DocKind;
  q?: string;
  limit?: number;
  cursor?: string;
}
export interface ListDocumentsResponse {
  documents: DocumentSummary[];
  /** Opaque. Pass it back as `cursor` for the next page, or null at the end. */
  nextCursor: string | null;
}

/**
 * POST /documents. 201 with a `DocumentMeta`.
 *
 * `templateId` is `predefined:<slug>` or the id of a template document the
 * caller can read. The new document is an ordinary copy of it: it carries no
 * link back, and a locked document is never a template.
 */
export interface CreateDocumentRequest {
  kind: DocKind;
  title?: string;
  templateId?: string;
  /**
   * The new document's content: a Yjs update, base64, that **replaces** the (empty)
   * content, applied through the room's `import:` edit like a template's. At most
   * `LIMITS.docStateMaxBytes` once decoded (413 `too_large`), valid base64 and a Yjs
   * update that stands alone (400 `invalid_field`, field `state`), and not together with
   * `templateId` (400). The creating call is the only one that takes it: a locked
   * document is made from ciphertext (`POST /documents/locked`), which has no room to
   * seed. Web: `web/src/docs/seed.ts` makes one from ProseMirror JSON.
   *
   * A spreadsheet needs one, or a `templateId`: its structure (sheets, row and column
   * order) is what every cell hangs off, so an empty `sheets` document is refused (400
   * `invalid_field`, field `state`).
   */
  state?: string;
  /**
   * A spreadsheet's cells: base64 of a cell list (`encodeCellList`, shared/cells.ts), only
   * with `kind: 'sheets'` and a `state`, never with `templateId` (400 `invalid_field`,
   * field `cells`). At most `CELL_LIMITS.listBytes` decoded (413 `too_large` with
   * `limitBytes`), `CELL_LIMITS.cellsPerDocument` cells (413 `too_large` with
   * `limitCells`) and `CELL_LIMITS.bytesPerDocument` of ids and content (413 `too_large`
   * with that as `limitBytes`); a list that does not decode is 400. All of it is checked
   * before the document is made, and it is applied with `state` as one `import:` edit.
   */
  cells?: string;
}

/** GET /documents/:id */
export interface DocumentMeta extends DocumentSummary {
  generalAccess: GeneralAccess;
  generalRole: ShareRole;
  /** What the caller is, so the page can draw a guest differently. */
  principal: 'user' | 'link';
  /** The link's "can download, print and copy" switch. Always true for a user. */
  canDownload: boolean;
}

/** PATCH /documents/:id. Owner. Allowed while the document is trashed. */
export interface RenameDocumentRequest {
  title: string;
}

// GET /documents/:id           Any role. Also records the open, for `recent`, unless `?peek=1`.
// POST /documents/:id/trash    Owner. Moves it to the trash and closes its sockets.
//                              Returns the `DocumentMeta`.
// POST /documents/:id/restore  Owner. Takes it out of the trash. Returns the `DocumentMeta`.
// DELETE /documents/:id        Owner. A trashed document only, else 409 `not_trashed`.
//                              Deletes the room, the R2 objects, the versions, the
//                              comments and the assets. 204.
// PUT /documents/:id/star      Any role. 204. DELETE removes it. 204.

/** POST /documents/:id/copy. 201 with a `DocumentMeta`. A locked document cannot be
 *  copied, a link guest cannot copy (sign in), and neither can a viewer or commenter
 *  who has the document only by a link that turned downloads off (`canDownload`). */
export interface CopyDocumentRequest {
  title?: string;
}

// ── versions ─────────────────────────────────────────────────────────────────

export interface VersionAuthor {
  /** The principal string stored: `u:<id>`, `g:<id>` or `assist:<id>`. */
  id: string;
  name: string;
  kind: 'user' | 'guest' | 'assist';
}

export interface VersionSummary {
  id: string;
  kind: VersionKind;
  label: string | null;
  authors: VersionAuthor[];
  sizeBytes: number;
  createdAt: number;
}

/** GET /documents/:id/versions. Editor, and a signed-in person: a viewer, a
 *  commenter or a link guest gets 403, because history holds text an editor has
 *  since removed. Newest first. */
export interface ListVersionsResponse {
  versions: VersionSummary[];
}

/** POST /documents/:id/versions. Editor. Names the current state. 201. */
export interface NameVersionRequest {
  label: string;
}

/** PATCH /documents/:id/versions/:versionId. Editor. A `named` version only. */
export interface RenameVersionRequest {
  label: string;
}

/**
 * POST /documents/:id/versions/:versionId/restore. Editor.
 *
 * The room replaces the content with the version's, as one transaction every
 * connected tab receives. The state it replaced is kept as a `restore` version,
 * so a restore can be undone by restoring that.
 */
export interface RestoreVersionResponse {
  ok: boolean;
  /** The `restore` version holding what was replaced. */
  undoVersionId: string | null;
}

// GET /documents/:id/versions/:versionId/snapshot
//   Editor, on the same terms as the list. The version's Yjs state, decrypted, as
//   raw bytes (application/octet-stream), for a preview. Not available for `locked`
//   versions: those are ciphertext and have their own route below. For a spreadsheet
//   it is structure and cells together (`decodeSheetSnapshot`, shared/cells.ts); one
//   from before phase 4 is a bare Yjs state, and `decodeSheetSnapshot` answers null.

// ── comments ─────────────────────────────────────────────────────────────────

/**
 * Where a thread is anchored, by document kind. The server checks that `kind`
 * matches the document and nothing more: it does not know whether a position
 * still exists, and a thread whose anchor has gone is shown as detached.
 */
export type CommentAnchor =
  /** `relpos` is base64 of `Y.encodeRelativePosition`, and `relposEnd` the end
   *  of a selection. `quote` is the selected text at the time, for display. */
  | { kind: 'docs'; relpos: string; relposEnd?: string; quote?: string }
  /** `cell` is `<sheetId>!<rowId>:<colId>`, the model's stable ids. */
  | { kind: 'sheets'; cell: string }
  /** `element` is `<slideId>:<elementId>`. */
  | { kind: 'slides'; element: string };

export interface CommentMessage {
  id: string;
  /** A user id, or null for a link guest. */
  authorId: string | null;
  authorName: string;
  /** The author's profile picture on the account site, or null. */
  authorAvatarUrl: string | null;
  body: string;
  /** User ids mentioned. Each is emailed once, if they can open the document. */
  mentions: string[];
  createdAt: number;
  editedAt: number | null;
}

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  resolved: boolean;
  resolvedById: string | null;
  resolvedAt: number | null;
  /** The first message is the comment and the rest are replies. */
  messages: CommentMessage[];
  createdAt: number;
}

/** GET /documents/:id/comments?resolved=0|1. Viewer. Without `resolved`, both. */
export interface ListCommentsResponse {
  threads: CommentThread[];
}

/** POST /documents/:id/comments. Commenter. 201 with a `CommentThread`. */
export interface CreateThreadRequest {
  anchor: CommentAnchor;
  body: string;
  mentions?: string[];
}

/** POST /documents/:id/comments/:threadId/replies. Commenter. 201 with the `CommentThread`. */
export interface ReplyRequest {
  body: string;
  mentions?: string[];
}

/** PATCH /documents/:id/comments/:threadId. Commenter resolves and reopens. */
export interface ResolveThreadRequest {
  resolved: boolean;
}

/** PATCH /documents/:id/comments/:threadId/messages/:messageId. The author only. */
export interface EditMessageRequest {
  body: string;
  mentions?: string[];
}

// DELETE /documents/:id/comments/:threadId/messages/:messageId
//   The author, or the owner. Deleting the first message deletes the thread.
// DELETE /documents/:id/comments/:threadId
//   The owner, or the author of its first message.

/** Someone a comment can mention. No email address: the picker does not need one. */
export interface MentionCandidate {
  userId: string;
  name: string;
  /** `users.username`, which `@handle` in a comment's text resolves. */
  handle: string | null;
  avatarUrl: string | null;
}

/**
 * GET /documents/:id/comments/people?q=. Commenter, signed in; a link guest gets
 * 403. The people who can open the document (its owner, the people it is shared
 * with, and the organisation's members when it is open to the organisation),
 * matched on the start of a name, a word of it, or a handle. At most 8, never the
 * caller. A locked document refuses it like every other comment route.
 */
export interface MentionPeopleResponse {
  people: MentionCandidate[];
}

// ── assets ───────────────────────────────────────────────────────────────────

export interface AssetMeta {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  /** Same-origin, relative. Needs the same credentials as the document. */
  url: string;
}

// POST /documents/:id/assets   Editor. The raw image bytes as the body, with
//   `content-type` one of LIMITS.assetMimes and the file name in
//   `x-asset-name`. 201 with an `AssetMeta`. 413 `too_large` past assetMaxBytes.
// GET /documents/:id/assets/:assetId   Viewer. The bytes, with their type.
//   Refused for a locked document, whose images are inside its ciphertext.

// ── sharing ──────────────────────────────────────────────────────────────────

export interface Person {
  userId: string;
  name: string;
  /** The profile picture on the account site, or null. */
  avatarUrl: string | null;
  handle: string | null;
  email: string;
}

/**
 * One row of "people with access". A pending invite has no `userId` yet: it was
 * made to an address, and the first time that address signs in verified, it
 * becomes a share.
 */
export interface Member {
  id: string;
  userId: string | null;
  email: string | null;
  name: string | null;
  handle: string | null;
  /** The profile picture on the account site, or null (always, for a pending invite). */
  avatarUrl: string | null;
  role: ShareRole;
  /** Unix seconds, after which the share stops applying. */
  expiresAt: number | null;
  pending: boolean;
  invitedById: string;
  createdAt: number;
}

/** The link's settings. Never the token, never the password. */
export interface LinkState {
  id: string;
  role: ShareRole;
  hasPassword: boolean;
  expiresAt: number | null;
  allowDownload: boolean;
  createdAt: number;
}

/** GET /documents/:id/sharing. Owner. */
export interface SharingState {
  owner: Person;
  generalAccess: GeneralAccess;
  generalRole: ShareRole;
  /** The active link, or null. A document has at most one. */
  link: LinkState | null;
  members: Member[];
  /** Whether the owner has an organisation, so `org` can be offered. */
  orgName: string | null;
}

/** PUT /documents/:id/sharing/general. Owner. Returns `SharingState`. */
export interface SetGeneralAccessRequest {
  access: GeneralAccess;
  /** Defaults to the current role. */
  role?: ShareRole;
}

/**
 * POST /documents/:id/sharing/link. Owner. Makes the link, or **rotates** it:
 * a second call revokes the first link and makes another, because a document
 * has one. Also sets general access to `link`. 201.
 */
export interface CreateLinkRequest {
  role: ShareRole;
  /** Set to require one. Stored as a salted hash and never returned. */
  password?: string | null;
  expiresAt?: number | null;
  allowDownload?: boolean;
}
export interface CreateLinkResponse {
  /** The only time it is returned. */
  token: string;
  /** `<origin>/l/<token>` */
  url: string;
  link: LinkState;
}

/**
 * PATCH /documents/:id/sharing/link. Owner. Changes the settings and keeps the
 * token. `password: null` removes the password, and leaving it out keeps it.
 */
export interface UpdateLinkRequest {
  role?: ShareRole;
  password?: string | null;
  expiresAt?: number | null;
  allowDownload?: boolean;
}

// DELETE /documents/:id/sharing/link   Owner. Revokes the link, closes its
//   sockets, and sets general access back to `restricted` if it was `link`.

/**
 * POST /documents/:id/sharing/members. Owner. Exactly one of `handle` and
 * `email`. An unknown email makes a pending invite. 201 with the `Member`.
 */
export interface AddMemberRequest {
  handle?: string;
  email?: string;
  role: ShareRole;
  expiresAt?: number | null;
  /** Send the invite email. Defaults to true. */
  notify?: boolean;
}

/** PATCH /documents/:id/sharing/members/:memberId. Owner. */
export interface UpdateMemberRequest {
  role?: ShareRole;
  expiresAt?: number | null;
}

// DELETE /documents/:id/sharing/members/:memberId   Owner. Closes their sockets.

/** POST /documents/:id/sharing/transfer. Owner. The previous owner becomes an editor. */
export interface TransferOwnershipRequest {
  userId: string;
}

// ── link landing ─────────────────────────────────────────────────────────────

/**
 * GET /links/:token, and the answer to POST /links/:token/unlock.
 *
 * Needs no session. `ok` sets the grant cookie: signed, scoped to the one
 * document's paths, and short-lived (`LIMITS.linkGrantSeconds`). A revoked,
 * expired or unknown link, and a link to a document that has since been locked
 * or trashed, all answer `gone`, so the answer says nothing about which.
 */
export type LinkLanding =
  | {
      status: 'ok';
      documentId: string;
      kind: DocKind;
      title: string;
      role: ShareRole;
      allowDownload: boolean;
    }
  | { status: 'password' }
  | { status: 'gone' };

/** POST /links/:token/unlock. 401 `link_password_wrong`, 429 after ten wrong in an hour. */
export interface UnlockLinkRequest {
  password: string;
}

// ── locked documents ─────────────────────────────────────────────────────────

/**
 * What the client needs to re-derive its key, stored beside the ciphertext. The
 * server checks the shape and the ranges and nothing about whether they are
 * wise. The key itself, and the password it comes from, never leave the browser.
 */
export interface KdfParams {
  alg: 'argon2id';
  /** Base64, 16 bytes or more. */
  salt: string;
  memKiB: number;
  iterations: number;
  parallelism: number;
  version: 1;
}

/** The ciphertext of a locked document, base64, as `web/src/crypto` produces it. */
export interface LockedPayload {
  rev: number;
  kdf: KdfParams;
  ciphertext: string;
}

/**
 * POST /documents/locked. Makes a locked document from nothing. 201 with a
 * `DocumentMeta`. It has no room and no key.
 */
export interface CreateLockedDocumentRequest {
  kind: DocKind;
  title?: string;
  kdf: KdfParams;
  ciphertext: string;
}

/**
 * POST /documents/:id/lock. Owner. Locks an existing document with the
 * ciphertext of its content.
 *
 * It removes every share and the link, sets general access to `restricted`,
 * clears the template flag, **deletes the document's server-readable versions,
 * its R2 snapshots and its room state, and erases its wrapped key**. Comments
 * and assets are deleted too. `confirm` must be true: the page asks first.
 * Returns the `DocumentMeta`.
 */
export interface LockDocumentRequest {
  kdf: KdfParams;
  ciphertext: string;
  confirm: true;
}

// GET /documents/:id/locked   Owner, locked documents only. A `LockedPayload`,
//   with the revision also in `etag`.
//
// PUT /documents/:id/locked   Owner, locked documents only. Body `{ ciphertext,
//   kdf? }` (`kdf` only when the password changed). Needs `If-Match: "<rev>"`
//   and answers 428 without it and 412 `stale_revision` (carrying the current
//   `rev`) when it is not the current one. 200 with `{ rev }`. The previous
//   ciphertext is kept as a `locked` version when it is older than fifteen
//   minutes.
//
// GET /documents/:id/locked/versions            Owner. `ListVersionsResponse`.
// GET /documents/:id/locked/versions/:versionId Owner. A `LockedPayload`.

export interface PutLockedRequest {
  ciphertext: string;
  kdf?: KdfParams;
}
export interface PutLockedResponse {
  rev: number;
}

/**
 * POST /documents/:id/unlock. Owner, locked documents only. Turns a locked
 * document back into an ordinary one from a plaintext Yjs state the client
 * decrypted: a new data key is minted and the state becomes the room's. The old
 * ciphertext versions are deleted. `rev` must be the current revision.
 */
export interface UnlockDocumentRequest {
  rev: number;
  /** Base64 of `Y.encodeStateAsUpdate`. At most `LIMITS.docStateMaxBytes`. */
  state: string;
  /** A spreadsheet's cells, as `CreateDocumentRequest.cells`. Ignored for other kinds;
   *  a spreadsheet unlocked without it has no cells. */
  cells?: string;
}

// ── templates ────────────────────────────────────────────────────────────────

export interface TemplateSummary {
  /** `predefined:<slug>`, or a document id. Pass it as `templateId`. */
  id: string;
  kind: DocKind;
  title: string;
  scope: TemplateKind;
  /** The template's owner, for `user` and `org`. */
  ownerName: string | null;
  description: string | null;
}

/**
 * GET /templates?kind=. The caller's own, then the organisation's. Docs' predefined
 * templates are not here: they are made in the browser, where the editor's schema is
 * (`web/src/docs/templates`).
 *
 * `organisation` is the caller's, and whether they may offer a document to it as a
 * company template (an owner or an administrator), so the page offers that only to
 * people the server would let. Null outside an organisation.
 */
export interface ListTemplatesResponse {
  templates: TemplateSummary[];
  organisation: { name: string; canOffer: boolean } | null;
}

/**
 * PUT /documents/:id/template. Owner. `scope: null` stops offering it. `org`
 * needs the owner to be in an organisation, and the organisation's own role
 * rules decide who may (read from ENTERPRISE_DB). A locked document cannot be
 * a template.
 */
export interface SetTemplateRequest {
  scope: TemplateScope | null;
}

// ── the room ─────────────────────────────────────────────────────────────────

/**
 * GET /documents/:id/room is a WebSocket upgrade and speaks y-websocket's
 * frames, so a stock `WebsocketProvider` connects:
 *
 *   new WebsocketProvider(`${wsOrigin}/api/office/documents`, `${id}/room`, doc)
 *
 * The close codes below are the room's. The client must not reconnect on
 * `protocol` or `tooLarge`, because the same diff would be sent again.
 */
export const ROOM_CLOSE = {
  /** No usable credentials. Reconnect through the Worker, which will say why. */
  unauthorized: 4001,
  /** A frame the room refused. A bug in the client. */
  protocol: 4002,
  /** A frame over the cap. Do not reconnect with the same diff. */
  tooLarge: 4003,
  /** Access withdrawn. Stop. */
  revoked: 4005,
  /** The role changed. Reconnect, and the Worker resolves the new one. */
  roleChanged: 4006,
  /** A spreadsheet was restored. Reconnect, take the new snapshot, and resend the steps
   *  not yet acknowledged (shared/cells.ts). */
  resync: 4007
} as const;
export type RoomCloseCode = (typeof ROOM_CLOSE)[keyof typeof ROOM_CLOSE];

// ── paths ────────────────────────────────────────────────────────────────────

const seg = encodeURIComponent;

/** Every path, spelled once. All are relative to the origin. */
export const PATHS = {
  health: `${API_BASE}/health`,
  me: `${API_BASE}/me`,
  documents: `${API_BASE}/documents`,
  lockedDocuments: `${API_BASE}/documents/locked`,
  document: (id: string) => `${API_BASE}/documents/${seg(id)}`,
  /** The metadata of a document the reader is linking to, without opening it: the open
   *  is not recorded, so a chip in a document does not put its target in Recent. */
  documentPeek: (id: string) => `${API_BASE}/documents/${seg(id)}?peek=1`,
  trash: (id: string) => `${API_BASE}/documents/${seg(id)}/trash`,
  restoreFromTrash: (id: string) => `${API_BASE}/documents/${seg(id)}/restore`,
  star: (id: string) => `${API_BASE}/documents/${seg(id)}/star`,
  copy: (id: string) => `${API_BASE}/documents/${seg(id)}/copy`,
  template: (id: string) => `${API_BASE}/documents/${seg(id)}/template`,
  room: (id: string) => `${API_BASE}/documents/${seg(id)}/room`,
  versions: (id: string) => `${API_BASE}/documents/${seg(id)}/versions`,
  version: (id: string, versionId: string) =>
    `${API_BASE}/documents/${seg(id)}/versions/${seg(versionId)}`,
  restoreVersion: (id: string, versionId: string) =>
    `${API_BASE}/documents/${seg(id)}/versions/${seg(versionId)}/restore`,
  snapshot: (id: string, versionId: string) =>
    `${API_BASE}/documents/${seg(id)}/versions/${seg(versionId)}/snapshot`,
  comments: (id: string) => `${API_BASE}/documents/${seg(id)}/comments`,
  thread: (id: string, threadId: string) =>
    `${API_BASE}/documents/${seg(id)}/comments/${seg(threadId)}`,
  replies: (id: string, threadId: string) =>
    `${API_BASE}/documents/${seg(id)}/comments/${seg(threadId)}/replies`,
  message: (id: string, threadId: string, messageId: string) =>
    `${API_BASE}/documents/${seg(id)}/comments/${seg(threadId)}/messages/${seg(messageId)}`,
  commentPeople: (id: string) => `${API_BASE}/documents/${seg(id)}/comments/people`,
  assets: (id: string) => `${API_BASE}/documents/${seg(id)}/assets`,
  asset: (id: string, assetId: string) =>
    `${API_BASE}/documents/${seg(id)}/assets/${seg(assetId)}`,
  sharing: (id: string) => `${API_BASE}/documents/${seg(id)}/sharing`,
  sharingGeneral: (id: string) => `${API_BASE}/documents/${seg(id)}/sharing/general`,
  sharingLink: (id: string) => `${API_BASE}/documents/${seg(id)}/sharing/link`,
  sharingMembers: (id: string) => `${API_BASE}/documents/${seg(id)}/sharing/members`,
  sharingMember: (id: string, memberId: string) =>
    `${API_BASE}/documents/${seg(id)}/sharing/members/${seg(memberId)}`,
  transfer: (id: string) => `${API_BASE}/documents/${seg(id)}/sharing/transfer`,
  link: (token: string) => `${API_BASE}/links/${seg(token)}`,
  unlockLink: (token: string) => `${API_BASE}/links/${seg(token)}/unlock`,
  lock: (id: string) => `${API_BASE}/documents/${seg(id)}/lock`,
  locked: (id: string) => `${API_BASE}/documents/${seg(id)}/locked`,
  lockedVersions: (id: string) => `${API_BASE}/documents/${seg(id)}/locked/versions`,
  lockedVersion: (id: string, versionId: string) =>
    `${API_BASE}/documents/${seg(id)}/locked/versions/${seg(versionId)}`,
  unlock: (id: string) => `${API_BASE}/documents/${seg(id)}/unlock`,
  templates: `${API_BASE}/templates`
} as const;
