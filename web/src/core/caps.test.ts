import { describe, expect, it } from 'vitest';
import type { DocumentMeta, Role } from '@shared/api';
import { capsFor, readOnlyNote } from './caps';

const meta = (
  role: Role,
  over: Partial<Pick<DocumentMeta, 'principal' | 'canDownload' | 'trashedAt' | 'locked'>> = {}
) => ({ role, principal: 'user' as const, canDownload: true, trashedAt: null, locked: false, ...over });

describe('capsFor', () => {
  it('lets an owner do everything', () => {
    expect(capsFor(meta('owner'))).toMatchObject({
      owner: true,
      canEdit: true,
      canComment: true,
      canShare: true,
      canSeeHistory: true,
      restricted: false,
      guest: false
    });
  });

  it('lets an editor change the page and see its history, but is not the owner', () => {
    expect(capsFor(meta('editor'))).toMatchObject({ owner: false, canEdit: true, canShare: true, canSeeHistory: true });
  });

  it('lets a commenter comment and nothing else', () => {
    expect(capsFor(meta('commenter'))).toMatchObject({
      canEdit: false,
      canComment: true,
      canShare: false,
      canSeeHistory: false
    });
  });

  it('lets a viewer read', () => {
    expect(capsFor(meta('viewer'))).toMatchObject({ canEdit: false, canComment: false, canShare: false, canSeeHistory: false });
  });

  it('keeps a link guest out of sharing and history even with the editor role', () => {
    const caps = capsFor(meta('editor', { principal: 'link' }));
    expect(caps).toMatchObject({ guest: true, canEdit: true, canComment: true, canShare: false, canSeeHistory: false });
  });

  it('makes everyone read-only in the trash, the owner included, who can still restore', () => {
    const caps = capsFor(meta('owner', { trashedAt: 100 }));
    expect(caps).toMatchObject({ owner: true, canEdit: false, canComment: false, canShare: false, trashed: true });
  });

  it('turns downloads off only for readers who arrived with the switch off', () => {
    expect(capsFor(meta('viewer', { canDownload: false })).restricted).toBe(true);
    expect(capsFor(meta('commenter', { canDownload: false })).restricted).toBe(true);
    expect(capsFor(meta('editor', { canDownload: false })).restricted).toBe(false);
    expect(capsFor(meta('viewer', { canDownload: true })).restricted).toBe(false);
  });

  it('offers a locked document none of the shared features', () => {
    expect(capsFor(meta('owner', { locked: true }))).toMatchObject({
      owner: true,
      canComment: false,
      canShare: false,
      canSeeHistory: false
    });
  });
});

describe('readOnlyNote', () => {
  it('names what the reader is, or says nothing for someone who can type', () => {
    expect(readOnlyNote({ role: 'viewer' }, false)).toBe('View only');
    expect(readOnlyNote({ role: 'commenter' }, false)).toBe('Comment only');
    expect(readOnlyNote({ role: 'editor' }, false)).toBeNull();
    expect(readOnlyNote({ role: 'owner' }, true)).toBe('In the trash');
  });
});
