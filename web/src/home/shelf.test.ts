// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { TemplateSummary } from '@shared/api';
import { clearCache, readCache, writeCache } from './cache';
import { arranged, noteOffered, SHELF_KEY } from './shelf';

const t = (id: string, title: string, scope: 'user' | 'org'): TemplateSummary => ({ id, kind: 'docs', title, scope, ownerName: 'Ada', description: null });
const doc = { id: 'd9', kind: 'docs' as const, title: 'Brief', ownerName: 'Ada Rowe' };

beforeEach(() => {
  clearCache();
  sessionStorage.clear();
});

describe('Home’s shelf when a document is offered', () => {
  it('orders the reader’s own by title and then the organisation’s, as the server does', () => {
    expect(arranged([t('3', 'b', 'org'), t('2', 'Zed', 'user'), t('1', 'apple', 'user'), t('4', 'A', 'org')]).map((x) => x.id)).toEqual(['1', '2', '4', '3']);
  });

  it('does nothing before Home has painted a shelf: there is nothing to keep right', () => {
    noteOffered(doc, 'user');
    expect(readCache(SHELF_KEY)).toBeNull();
  });

  it('adds the document in its place, and moves it when it goes to the organisation', () => {
    writeCache(SHELF_KEY, [t('d1', 'Agenda', 'user'), t('d2', 'Zebra', 'org')]);
    noteOffered(doc, 'user');
    expect(readCache<TemplateSummary[]>(SHELF_KEY)!.map((x) => [x.id, x.scope])).toEqual([['d1', 'user'], ['d9', 'user'], ['d2', 'org']]);
    noteOffered(doc, 'org');
    expect(readCache<TemplateSummary[]>(SHELF_KEY)!.map((x) => [x.id, x.scope])).toEqual([['d1', 'user'], ['d9', 'org'], ['d2', 'org']]);
  });

  it('takes it off', () => {
    writeCache(SHELF_KEY, [t('d9', 'Brief', 'user')]);
    noteOffered(doc, null);
    expect(readCache(SHELF_KEY)).toEqual([]);
  });

  it('gives the card the owner and no description, as the server’s list does for a document', () => {
    writeCache(SHELF_KEY, []);
    noteOffered(doc, 'user');
    expect(readCache<TemplateSummary[]>(SHELF_KEY)![0]).toEqual({ id: 'd9', kind: 'docs', title: 'Brief', scope: 'user', ownerName: 'Ada Rowe', description: null });
  });
});
