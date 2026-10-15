import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { checkAccess, loadFailure } from './useDocument';

describe('loadFailure', () => {
  it('reads 401 as "who are you"', () => {
    expect(loadFailure(new ApiError(401, 'unauthorized', 'Sign in.'))).toEqual({ status: 'signin' });
  });

  it('reads a missing second factor as its own state, not as being signed out', () => {
    expect(loadFailure(new ApiError(403, 'second_factor_required', 'x'))).toEqual({ status: 'second-factor' });
  });

  it('gives a document you cannot see and one that is not there the same answer', () => {
    expect(loadFailure(new ApiError(404, 'not_found', 'x'))).toEqual({ status: 'denied' });
    expect(loadFailure(new ApiError(403, 'forbidden', 'x'))).toEqual({ status: 'denied' });
  });

  it('treats anything else as a fault worth trying again, in the server\'s words when it has them', () => {
    expect(loadFailure(new ApiError(500, 'internal', 'Something broke.'))).toEqual({
      status: 'error',
      message: 'Something broke.'
    });
    expect(loadFailure(new TypeError('Failed to fetch'))).toEqual({
      status: 'error',
      message: 'Could not open this document.'
    });
  });
});

describe('checkAccess', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number) =>
    vi.stubGlobal('fetch', async () =>
      status === 200
        ? new Response(JSON.stringify({ id: 'd' }), { status })
        : new Response(JSON.stringify({ error: { code: 'x', message: 'x' }, requestId: 'r' }), { status })
    );

  it('says ok while the document opens', async () => {
    answer(200);
    await expect(checkAccess('d')).resolves.toBe('ok');
  });

  it('tells a lost session from lost access', async () => {
    answer(401);
    await expect(checkAccess('d')).resolves.toBe('signed-out');
    answer(404);
    await expect(checkAccess('d')).resolves.toBe('no-access');
    answer(403);
    await expect(checkAccess('d')).resolves.toBe('no-access');
  });

  it('does not call a server fault a lost session', async () => {
    answer(500);
    await expect(checkAccess('d')).rejects.toBeInstanceOf(ApiError);
  });
});
