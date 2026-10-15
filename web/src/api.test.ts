import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorText, isNoAccess, request, requestBytes } from './api';
import { comments, documents, links, locked, queryString, sharing, templates, versions } from './client';

interface Call {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

let calls: Call[] = [];
let reply: () => Response = () => json({});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  calls = [];
  reply = () => json({});
  vi.stubGlobal('fetch', async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return reply();
  });
});
afterEach(() => vi.unstubAllGlobals());

const last = (): Call => calls[calls.length - 1]!;

describe('request', () => {
  it('sends the cookie, asks for JSON, and parses the answer', async () => {
    reply = () => json({ ok: true });
    await expect(request('/api/office/me')).resolves.toEqual({ ok: true });
    expect(last().init.credentials).toBe('same-origin');
    expect(last().init.headers.accept).toBe('application/json');
    expect(last().init.headers['content-type']).toBeUndefined();
  });

  it('says it is sending JSON only when it is', async () => {
    await request('/x', { method: 'POST', body: '{}' });
    expect(last().init.headers['content-type']).toBe('application/json');
  });

  it('answers undefined to a 204', async () => {
    reply = () => new Response(null, { status: 204 });
    await expect(request('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('turns an error body into an ApiError that carries the server\'s code and the rest', async () => {
    reply = () =>
      json({ error: { code: 'stale_revision', message: 'Someone else saved.', rev: 9 }, requestId: 'r' }, 412);
    const err = await request('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 412, code: 'stale_revision', message: 'Someone else saved.' });
    expect((err as ApiError).details).toEqual({ rev: 9 });
  });

  it('still throws an ApiError when the body is not JSON at all', async () => {
    reply = () => new Response('<html>bad gateway</html>', { status: 502 });
    const err = await request('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'error', message: 'Something went wrong.' });
  });
});

describe('requestBytes', () => {
  it('returns the body as bytes', async () => {
    reply = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    expect([...(await requestBytes('/x'))]).toEqual([1, 2, 3]);
    expect(last().init.credentials).toBe('same-origin');
  });

  it('turns a refusal into an ApiError', async () => {
    reply = () => json({ error: { code: 'forbidden', message: 'No.' }, requestId: 'r' }, 403);
    await expect(requestBytes('/x')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});

describe('errorText and isNoAccess', () => {
  it('shows the server\'s words for an API error and ours for anything else', () => {
    expect(errorText(new ApiError(403, 'forbidden', 'Only the owner can do that.'), 'Could not.')).toBe(
      'Only the owner can do that.'
    );
    expect(errorText(new TypeError('Failed to fetch'), 'Could not reach Office.')).toBe('Could not reach Office.');
  });

  it('knows a missing way in from a failure', () => {
    for (const status of [401, 403, 404]) expect(isNoAccess(new ApiError(status, 'x', 'x'))).toBe(true);
    expect(isNoAccess(new ApiError(500, 'internal', 'x'))).toBe(false);
    expect(isNoAccess(new TypeError('offline'))).toBe(false);
  });
});

describe('queryString', () => {
  it('leaves out what is not set and encodes the rest', () => {
    expect(queryString({})).toBe('');
    expect(queryString({ q: undefined, kind: null, view: '' })).toBe('');
    expect(queryString({ view: 'trash', q: 'a b&c', limit: 50 })).toBe('?view=trash&q=a+b%26c&limit=50');
  });
});

describe('the documents calls', () => {
  it('list builds the query from what is set', async () => {
    await documents.list({ view: 'starred', kind: 'docs', q: 'plan' });
    expect(last().url).toBe('/api/office/documents?view=starred&kind=docs&q=plan');
    await documents.list();
    expect(last().url).toBe('/api/office/documents');
  });

  it('create posts the kind and the template', async () => {
    await documents.create({ kind: 'docs', templateId: 'predefined:letter' });
    expect(last().url).toBe('/api/office/documents');
    expect(last().init.method).toBe('POST');
    expect(JSON.parse(last().init.body as string)).toEqual({ kind: 'docs', templateId: 'predefined:letter' });
  });

  it('star is a PUT and unstar a DELETE', async () => {
    reply = () => new Response(null, { status: 204 });
    await documents.star('d1', true);
    expect([last().init.method, last().url]).toEqual(['PUT', '/api/office/documents/d1/star']);
    await documents.star('d1', false);
    expect(last().init.method).toBe('DELETE');
  });

  it('rename patches the title', async () => {
    await documents.rename('d1', 'Plan');
    expect([last().init.method, last().url]).toEqual(['PATCH', '/api/office/documents/d1']);
    expect(JSON.parse(last().init.body as string)).toEqual({ title: 'Plan' });
  });

  it('puts an id in the path safely', async () => {
    await documents.get('a/b c');
    expect(last().url).toBe('/api/office/documents/a%2Fb%20c');
  });

  it('trash, restore and remove use their own paths', async () => {
    await documents.trash('d1');
    expect(last().url).toBe('/api/office/documents/d1/trash');
    await documents.restoreFromTrash('d1');
    expect(last().url).toBe('/api/office/documents/d1/restore');
    reply = () => new Response(null, { status: 204 });
    await documents.remove('d1');
    expect([last().init.method, last().url]).toEqual(['DELETE', '/api/office/documents/d1']);
  });
});

describe('the other calls', () => {
  it('templates ask for a kind only when given one', async () => {
    await templates.list();
    expect(last().url).toBe('/api/office/templates');
    await templates.list('docs');
    expect(last().url).toBe('/api/office/templates?kind=docs');
  });

  it('versions restore posts, and the snapshot is read as bytes', async () => {
    await versions.restore('d1', 'v1');
    expect([last().init.method, last().url]).toEqual(['POST', '/api/office/documents/d1/versions/v1/restore']);
    reply = () => new Response(new Uint8Array([7]), { status: 200 });
    expect([...(await versions.snapshot('d1', 'v1'))]).toEqual([7]);
    expect(last().url).toBe('/api/office/documents/d1/versions/v1/snapshot');
  });

  it('comments resolve with a PATCH carrying the new state', async () => {
    await comments.resolve('d1', 't1', true);
    expect([last().init.method, last().url]).toEqual(['PATCH', '/api/office/documents/d1/comments/t1']);
    expect(JSON.parse(last().init.body as string)).toEqual({ resolved: true });
  });

  it('sharing addresses members by their own id', async () => {
    await sharing.addMember('d1', { handle: 'ben.okoro', role: 'editor' });
    expect(last().url).toBe('/api/office/documents/d1/sharing/members');
    await sharing.updateMember('d1', 'm1', { role: 'viewer' });
    expect([last().init.method, last().url]).toEqual(['PATCH', '/api/office/documents/d1/sharing/members/m1']);
    reply = () => new Response(null, { status: 204 });
    await sharing.removeMember('d1', 'm1');
    expect(last().init.method).toBe('DELETE');
  });

  it('the link landing puts the token in the path, and unlock posts the password', async () => {
    await links.landing('tok en');
    expect(last().url).toBe('/api/office/links/tok%20en');
    await links.unlock('tok', 'hunter2');
    expect(last().url).toBe('/api/office/links/tok/unlock');
    expect(JSON.parse(last().init.body as string)).toEqual({ password: 'hunter2' });
  });
});

describe('the locked calls', () => {
  it('quote the revision in If-Match when saving', async () => {
    reply = () => json({ rev: 5 });
    await locked.put('d1', 4, { ciphertext: 'AAAA' });
    expect(last().init.method).toBe('PUT');
    expect(last().url).toBe('/api/office/documents/d1/locked');
    expect(last().init.headers['if-match']).toBe('"4"');
    expect(last().init.headers['content-type']).toBe('application/json');
  });

  it('surface the current revision when the server says it moved', async () => {
    reply = () => json({ error: { code: 'stale_revision', message: 'Moved on.', rev: 6 }, requestId: 'r' }, 412);
    const err = (await locked.put('d1', 4, { ciphertext: 'AAAA' }).catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(412);
    expect(err.code).toBe('stale_revision');
    expect(err.details.rev).toBe(6);
  });

  it('lock and unlock post to their own routes', async () => {
    await locked.lock('d1', {
      kdf: { alg: 'argon2id', salt: 'AAAA', memKiB: 19456, iterations: 2, parallelism: 1, version: 1 },
      ciphertext: 'AAAA',
      confirm: true
    });
    expect(last().url).toBe('/api/office/documents/d1/lock');
    await locked.unlock('d1', { rev: 3, state: 'AAAA' });
    expect(last().url).toBe('/api/office/documents/d1/unlock');
  });
});
