// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { capsFor } from '../core/caps';
import { cloudSource, CLOUD_FEATURES, localMeta, localSource, NO_FEATURES, type SourceEvents } from './source';

const events = (): SourceEvents & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    onStatus: (s) => log.push(`status:${s}`),
    onSynced: (s) => log.push(`synced:${s}`),
    onStop: (r) => log.push(`stop:${r}`),
    onNotice: () => undefined,
    onRoleChanged: () => undefined,
    checkAccess: async () => 'ok'
  };
};

describe('a local source', () => {
  it('hands the editor the document it was given, and no room', () => {
    const doc = new Y.Doc();
    const source = localSource({ title: 'Notes', doc });
    const conn = source.connect(events());
    expect(conn.doc).toBe(doc);
    expect(conn.provider).toBeNull();
    expect(conn.awareness).toBeNull();
  });

  it('is connected and in sync without touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', fetchSpy);
    const e = events();
    localSource({ title: 'Notes', doc: new Y.Doc() }).connect(e);
    expect(e.log).toEqual([]); // not during connect
    await Promise.resolve();
    expect(e.log).toEqual(['status:connected', 'synced:true']);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the host’s document alive when the editor lets go', () => {
    const doc = new Y.Doc();
    const destroyed = vi.fn();
    doc.on('destroy', destroyed);
    localSource({ title: 'Notes', doc }).connect(events()).destroy();
    expect(destroyed).not.toHaveBeenCalled();
    doc.getText('t').insert(0, 'still writable');
    expect(doc.getText('t').toString()).toBe('still writable');
  });

  it('turns every server feature off, and keeps only renaming', () => {
    const f = localSource({ title: 'Notes', doc: new Y.Doc() }).features;
    expect(f).toEqual({ ...NO_FEATURES, rename: true });
    const server = ['comments', 'sharing', 'history', 'presence', 'lock', 'unlock', 'trash', 'copy', 'star'] as const;
    for (const k of server) expect(f[k], k).toBe(false);
  });

  it('is its person’s own, so the role rules let them type', () => {
    const caps = capsFor(localSource({ title: 'Notes', doc: new Y.Doc() }).meta);
    expect(caps.canEdit).toBe(true);
    expect(caps.owner).toBe(true);
    expect(caps.guest).toBe(false);
    expect(caps.restricted).toBe(false);
  });

  it('has a title and an id of its own', () => {
    const m = localMeta('Budget', 'file:1');
    expect([m.title, m.id, m.locked, m.shared, m.trashedAt]).toEqual(['Budget', 'file:1', false, false, null]);
  });
});

describe('a cloud source', () => {
  it('asks the room for the document by its id, at this origin', () => {
    const room = { doc: new Y.Doc(), provider: {} as never, awareness: {} as never, destroy: () => undefined };
    const connect = vi.fn(() => room);
    const e = events();
    const conn = cloudSource('doc-1', connect).connect(e);
    expect(connect).toHaveBeenCalledWith('doc-1', window.location, e);
    expect(conn).toBe(room);
  });

  it('offers every server feature except taking a password off', () => {
    expect(cloudSource('x').features).toEqual(CLOUD_FEATURES);
    expect(CLOUD_FEATURES.unlock).toBe(false);
    expect(Object.entries(CLOUD_FEATURES).filter(([, v]) => !v).map(([k]) => k)).toEqual(['unlock']);
  });
});
