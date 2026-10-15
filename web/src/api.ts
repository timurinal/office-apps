/**
 * The API client.
 *
 * Same shape as the sibling apps: one `request` helper, typed wrappers, and
 * errors that carry the server's code so a caller can branch on it. Paths and
 * bodies are typed from shared/api.ts, which the Worker types its handlers
 * against, so a field that changes shape fails to compile on both sides.
 *
 * Only the helpers and the calls the shell itself makes are here. The home page,
 * the editors and the dialogs each add their wrappers as they are built, and a
 * wrapper is `request<T>(PATHS.x(id), { method, body })` and nothing more.
 */

import type { ApiErrorCode, ApiErrorBody } from '@shared/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | string,
    message: string,
    /** The rest of the server's error object: `rev` on a 412, `limitBytes` on a 413. */
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    // The session cookie is domain-wide and the link grant cookie is path-scoped;
    // same-origin is all either needs.
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init.body && !(init.headers && 'content-type' in init.headers)
        ? { 'content-type': 'application/json' }
        : {}),
      ...init.headers
    }
  });

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;

  if (!res.ok) {
    const { code, message, ...details } = body?.error ?? { code: 'error', message: '' };
    throw new ApiError(res.status, code, message || 'Something went wrong.', details);
  }
  return body as T;
}

export const get = <T>(path: string): Promise<T> => request<T>(path);

export const send = <T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> =>
  request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/**
 * A response that is bytes, not JSON: a version's snapshot. Errors still arrive
 * as the server's JSON, so a refusal is an `ApiError` here too.
 */
export async function requestBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    const { code, message, ...details } = body?.error ?? { code: 'error', message: '' };
    throw new ApiError(res.status, code, message || 'Something went wrong.', details);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** The sentence to show for a failed call. The server writes its messages for
 *  people, so they are shown as sent; anything else gets the caller's words. */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
}

/** Whether a failed call means the caller has no way in. */
export const isNoAccess = (err: unknown): boolean =>
  err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404);
