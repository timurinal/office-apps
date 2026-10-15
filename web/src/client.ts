/**
 * Every call the web makes, typed from shared/api.ts.
 *
 * A wrapper here is `get`/`send` on a `PATHS` entry and nothing more: paths are
 * spelled once, in the contract, and bodies and answers are the contract's types,
 * so a shape that changes there fails to compile here. Anything that needs a
 * decision (retry, optimism, what to say) belongs to the caller.
 */

import {
  PATHS,
  type AddMemberRequest,
  type CopyDocumentRequest,
  type CreateDocumentRequest,
  type CreateLinkRequest,
  type CreateLinkResponse,
  type CreateLockedDocumentRequest,
  type CreateThreadRequest,
  type DocKind,
  type DocumentMeta,
  type EditMessageRequest,
  type LinkLanding,
  type LinkState,
  type ListCommentsResponse,
  type ListDocumentsQuery,
  type ListDocumentsResponse,
  type ListTemplatesResponse,
  type ListVersionsResponse,
  type LockDocumentRequest,
  type LockedPayload,
  type Member,
  type PutLockedRequest,
  type PutLockedResponse,
  type RenameDocumentRequest,
  type ReplyRequest,
  type ResolveThreadRequest,
  type RestoreVersionResponse,
  type SetGeneralAccessRequest,
  type SetTemplateRequest,
  type SharingState,
  type UnlockDocumentRequest,
  type UnlockLinkRequest,
  type UpdateLinkRequest,
  type UpdateMemberRequest,
  type CommentThread,
  type VersionSummary
} from '@shared/api';
import { get, request, requestBytes, send } from './api';

/** `?a=1&b=2`, leaving out what is not set. */
export function queryString(q: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * A spreadsheet is made from its structure, so a blank one is not "kind and nothing else": the
 * room refuses it. It is built here, on the press, by the model's own blank seed, and from a
 * module Home does not load with its first paint. Every caller that makes one by kind alone
 * (Home's card, a File > New in any editor, the command box) gets it without knowing.
 */
async function withBlankSheet(body: CreateDocumentRequest): Promise<CreateDocumentRequest> {
  if (body.kind !== 'sheets' || body.state !== undefined || body.templateId !== undefined) return body;
  const { blankSheetRequest } = await import('./sheets/blank');
  return { ...body, ...blankSheetRequest() };
}

export const documents = {
  list: (q: ListDocumentsQuery = {}) =>
    get<ListDocumentsResponse>(`${PATHS.documents}${queryString({ ...q })}`),
  create: async (body: CreateDocumentRequest) => send<DocumentMeta>('POST', PATHS.documents, await withBlankSheet(body)),
  get: (id: string) => get<DocumentMeta>(PATHS.document(id)),
  rename: (id: string, title: string) =>
    send<DocumentMeta>('PATCH', PATHS.document(id), { title } satisfies RenameDocumentRequest),
  trash: (id: string) => send<DocumentMeta>('POST', PATHS.trash(id)),
  restoreFromTrash: (id: string) => send<DocumentMeta>('POST', PATHS.restoreFromTrash(id)),
  remove: (id: string) => send<void>('DELETE', PATHS.document(id)),
  star: (id: string, on: boolean) => send<void>(on ? 'PUT' : 'DELETE', PATHS.star(id)),
  copy: (id: string, body: CopyDocumentRequest = {}) =>
    send<DocumentMeta>('POST', PATHS.copy(id), body)
};

export const templates = {
  list: (kind?: DocKind) =>
    get<ListTemplatesResponse>(`${PATHS.templates}${queryString({ kind })}`),
  set: (id: string, scope: SetTemplateRequest['scope']) =>
    send<DocumentMeta>('PUT', PATHS.template(id), { scope } satisfies SetTemplateRequest)
};

export const versions = {
  list: (id: string) => get<ListVersionsResponse>(PATHS.versions(id)),
  name: (id: string, label: string) =>
    send<VersionSummary>('POST', PATHS.versions(id), { label }),
  rename: (id: string, versionId: string, label: string) =>
    send<VersionSummary>('PATCH', PATHS.version(id, versionId), { label }),
  restore: (id: string, versionId: string) =>
    send<RestoreVersionResponse>('POST', PATHS.restoreVersion(id, versionId)),
  /** The version's Yjs state, decrypted. */
  snapshot: (id: string, versionId: string) => requestBytes(PATHS.snapshot(id, versionId))
};

export const comments = {
  list: (id: string) => get<ListCommentsResponse>(PATHS.comments(id)),
  create: (id: string, body: CreateThreadRequest) =>
    send<CommentThread>('POST', PATHS.comments(id), body),
  reply: (id: string, threadId: string, body: ReplyRequest) =>
    send<CommentThread>('POST', PATHS.replies(id, threadId), body),
  resolve: (id: string, threadId: string, resolved: boolean) =>
    send<CommentThread>('PATCH', PATHS.thread(id, threadId), {
      resolved
    } satisfies ResolveThreadRequest),
  edit: (id: string, threadId: string, messageId: string, body: EditMessageRequest) =>
    send<CommentThread>('PATCH', PATHS.message(id, threadId, messageId), body),
  removeMessage: (id: string, threadId: string, messageId: string) =>
    send<void>('DELETE', PATHS.message(id, threadId, messageId)),
  removeThread: (id: string, threadId: string) => send<void>('DELETE', PATHS.thread(id, threadId))
};

export const sharing = {
  get: (id: string) => get<SharingState>(PATHS.sharing(id)),
  setGeneral: (id: string, body: SetGeneralAccessRequest) =>
    send<SharingState>('PUT', PATHS.sharingGeneral(id), body),
  createLink: (id: string, body: CreateLinkRequest) =>
    send<CreateLinkResponse>('POST', PATHS.sharingLink(id), body),
  updateLink: (id: string, body: UpdateLinkRequest) =>
    send<LinkState>('PATCH', PATHS.sharingLink(id), body),
  removeLink: (id: string) => send<void>('DELETE', PATHS.sharingLink(id)),
  addMember: (id: string, body: AddMemberRequest) =>
    send<Member>('POST', PATHS.sharingMembers(id), body),
  updateMember: (id: string, memberId: string, body: UpdateMemberRequest) =>
    send<Member>('PATCH', PATHS.sharingMember(id, memberId), body),
  removeMember: (id: string, memberId: string) =>
    send<void>('DELETE', PATHS.sharingMember(id, memberId))
};

export const links = {
  /** No session needed. `ok` sets the grant cookie. */
  landing: (token: string) => get<LinkLanding>(PATHS.link(token)),
  unlock: (token: string, password: string) =>
    send<LinkLanding>('POST', PATHS.unlockLink(token), { password } satisfies UnlockLinkRequest)
};

export const locked = {
  create: (body: CreateLockedDocumentRequest) =>
    send<DocumentMeta>('POST', PATHS.lockedDocuments, body),
  lock: (id: string, body: LockDocumentRequest) => send<DocumentMeta>('POST', PATHS.lock(id), body),
  get: (id: string) => get<LockedPayload>(PATHS.locked(id)),
  /** `rev` is the revision this save builds on. A stale one is a 412 carrying the current. */
  put: (id: string, rev: number, body: PutLockedRequest) =>
    request<PutLockedResponse>(PATHS.locked(id), {
      method: 'PUT',
      headers: { 'if-match': `"${rev}"` },
      body: JSON.stringify(body)
    }),
  versions: (id: string) => get<ListVersionsResponse>(PATHS.lockedVersions(id)),
  version: (id: string, versionId: string) =>
    get<LockedPayload>(PATHS.lockedVersion(id, versionId)),
  unlock: (id: string, body: UnlockDocumentRequest) =>
    send<DocumentMeta>('POST', PATHS.unlock(id), body)
};
