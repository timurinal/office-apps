// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentMeta, TemplateSummary } from '@shared/api';
import type { Toast } from '../../core/ui';
import { ApiError } from '../../api';
import { clearCache, readCache, writeCache } from '../../home/cache';
import { SHELF_KEY } from '../../home/shelf';

const api = vi.hoisted(() => ({ set: vi.fn(), list: vi.fn() }));
vi.mock('../../client', () => ({ templates: api }));

const { canOfferToOrganisation, loadOrganisation, offer, offerText, resetOffers, scopeOf } = await import('./offer');

const meta = (over: Partial<DocumentMeta> = {}): DocumentMeta =>
  ({ id: 'd1', kind: 'docs', title: 'Sprint review', ownerName: 'Ada Rowe', templateScope: null, ...over }) as DocumentMeta;

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

const toasts = () => notify.mock.calls.map(([t]) => t);
let notify: ReturnType<typeof vi.fn<(toast: Toast) => void>>;
const page = (m = meta()) => ({ meta: m, notify });

beforeEach(() => {
  notify = vi.fn<(toast: Toast) => void>();
  api.set.mockReset();
  api.list.mockReset();
  resetOffers();
  clearCache();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('offering a document as a template', () => {
  it('answers in the same frame: the toast is up and the page already says so, before the server has been asked to finish', async () => {
    const wait = deferred<unknown>();
    api.set.mockReturnValue(wait.promise);
    const done = offer(page(), 'user');
    // Nothing has resolved yet.
    expect(scopeOf(meta())).toBe('user');
    expect(toasts()).toEqual([{ text: 'Saved as a template.', action: { label: 'Undo', run: expect.any(Function) } }]);
    expect(api.set).toHaveBeenCalledWith('d1', 'user');
    wait.resolve({});
    expect(await done).toBe(true);
  });

  it('says what the page said before, until the page sets something', () => {
    expect(scopeOf(meta())).toBeNull();
    expect(scopeOf(meta({ templateScope: 'org' }))).toBe('org');
  });

  it('puts it back and says why when the server refuses', async () => {
    api.set.mockRejectedValue(new ApiError(403, 'forbidden', 'Only an administrator of your organisation can add a company template.', {}));
    const ok = await offer(page(), 'org');
    expect(ok).toBe(false);
    expect(scopeOf(meta())).toBeNull();
    expect(toasts().at(-1)).toEqual({ text: 'Only an administrator of your organisation can add a company template.', tone: 'danger' });
  });

  it('uses its own words when the failure is not the server’s sentence', async () => {
    api.set.mockRejectedValue(new TypeError('offline'));
    await offer(page(), 'user');
    expect(toasts().at(-1)).toEqual({ text: 'Could not change that.', tone: 'danger' });
  });

  it('asks for nothing when the document already is what it is asked to be', async () => {
    expect(await offer(page(meta({ templateScope: 'user' })), 'user')).toBe(true);
    expect(api.set).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('comes with an Undo that is the same call the other way, and says nothing when it works', async () => {
    api.set.mockResolvedValue({});
    await offer(page(), 'org');
    const action = toasts()[0]!.action!;
    notify.mockClear();
    action.run();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.set).toHaveBeenLastCalledWith('d1', null);
    expect(scopeOf(meta())).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('puts the Undo back too when the server refuses it, and says why', async () => {
    api.set.mockResolvedValueOnce({}).mockRejectedValueOnce(new ApiError(500, 'internal', 'Something went wrong.', {}));
    await offer(page(), 'user');
    toasts()[0]!.action!.run();
    await new Promise((r) => setTimeout(r, 0));
    expect(scopeOf(meta())).toBe('user');
    expect(toasts().at(-1)).toMatchObject({ tone: 'danger' });
  });

  it('names the organisation when it offers to it, and says "removed" when it takes it off', async () => {
    api.list.mockResolvedValue({ templates: [], organisation: { name: 'Northwind Studio', canOffer: true } });
    await loadOrganisation();
    expect(offerText('org', { name: 'Northwind Studio', canOffer: true })).toBe('Saved as a template for Northwind Studio.');
    expect(offerText('org', null)).toBe('Saved as a company template.');
    expect(offerText(null, null)).toBe('Removed from templates.');
    api.set.mockResolvedValue({});
    await offer(page(), 'org');
    expect(toasts()[0]!.text).toBe('Saved as a template for Northwind Studio.');
  });

  describe('Home’s shelf, kept right in the same frame', () => {
    const own: TemplateSummary = { id: 'd0', kind: 'docs', title: 'Zebra notes', scope: 'user', ownerName: 'Ada Rowe', description: null };

    it('adds the document to it, in order, and takes it off again', async () => {
      writeCache(SHELF_KEY, [own]);
      api.set.mockResolvedValue({});
      await offer(page(), 'user');
      expect(readCache<TemplateSummary[]>(SHELF_KEY)!.map((t) => t.title)).toEqual(['Sprint review', 'Zebra notes']);
      await offer(page(meta({ templateScope: 'user' })), null);
      expect(readCache<TemplateSummary[]>(SHELF_KEY)!.map((t) => t.title)).toEqual(['Zebra notes']);
    });

    it('puts the shelf back when the server refuses', async () => {
      writeCache(SHELF_KEY, [own]);
      api.set.mockRejectedValue(new ApiError(403, 'forbidden', 'No.', {}));
      await offer(page(), 'org');
      expect(readCache<TemplateSummary[]>(SHELF_KEY)).toEqual([own]);
    });
  });
});

describe('who may offer to the organisation', () => {
  it('is nobody until the server has said so', () => {
    expect(canOfferToOrganisation()).toBe(false);
  });

  it('is who the server says, asked once for Docs', async () => {
    api.list.mockResolvedValue({ templates: [], organisation: { name: 'Northwind Studio', canOffer: true } });
    await loadOrganisation();
    await loadOrganisation();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenCalledWith('docs');
    expect(canOfferToOrganisation()).toBe(true);
  });

  it('is not an administrator who is told no, nor someone with no organisation', async () => {
    api.list.mockResolvedValue({ templates: [], organisation: { name: 'Northwind Studio', canOffer: false } });
    await loadOrganisation();
    expect(canOfferToOrganisation()).toBe(false);
    resetOffers();
    api.list.mockResolvedValue({ templates: [], organisation: null });
    await loadOrganisation();
    expect(canOfferToOrganisation()).toBe(false);
    // Nothing to ask again about: not being in one is an answer.
    await loadOrganisation();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('is asked again after a failure, and meanwhile is not offered', async () => {
    api.list.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ templates: [], organisation: { name: 'N', canOffer: true } });
    await loadOrganisation();
    expect(canOfferToOrganisation()).toBe(false);
    await loadOrganisation();
    expect(canOfferToOrganisation()).toBe(true);
  });
});
