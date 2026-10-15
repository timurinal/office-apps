/**
 * Loading one document's metadata, and what each failure means for the page.
 *
 * `GET /documents/:id` is also the question "may this person be here at all",
 * for a link guest as much as for an account, so its failures are the page's
 * states: 401 is "who are you", 403 `second_factor_required` is "finish signing
 * in", 403 and 404 are the same answer on purpose ("that document is not
 * available"), and anything else is a fault worth a retry.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DocumentMeta } from '@shared/api';
import { ApiError, errorText } from '../api';
import { documents } from '../client';
import { takePrefetched } from './prefetch';

export type DocLoad =
  | { status: 'loading' }
  | { status: 'ready'; meta: DocumentMeta }
  | { status: 'signin' }
  | { status: 'second-factor' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

/** The page state a failed load means. */
export function loadFailure(err: unknown): Exclude<DocLoad, { status: 'loading' | 'ready' }> {
  if (err instanceof ApiError) {
    if (err.code === 'second_factor_required') return { status: 'second-factor' };
    if (err.status === 401) return { status: 'signin' };
    if (err.status === 403 || err.status === 404) return { status: 'denied' };
  }
  return { status: 'error', message: errorText(err, 'Could not open this document.') };
}

export function useDocument(id: string) {
  const [load, setLoad] = useState<DocLoad>({ status: 'loading' });
  const [key, setKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    // A press on Home's card has usually asked already (core/prefetch.ts).
    (takePrefetched(id) ?? documents.get(id))
      .then((meta) => live && setLoad({ status: 'ready', meta }))
      .catch((err: unknown) => live && setLoad(loadFailure(err)));
    return () => {
      live = false;
    };
  }, [id, key]);

  /** Ask again without blanking the page: a role changed, a title was saved. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoad({ status: 'ready', meta: await documents.get(id) });
    } catch (err) {
      setLoad(loadFailure(err));
    }
  }, [id]);

  const setMeta = useCallback((meta: DocumentMeta) => setLoad({ status: 'ready', meta }), []);
  /** Start over, with the loading state. */
  const reload = useCallback(() => setKey((k) => k + 1), []);

  return { load, refresh, setMeta, reload };
}

/** The room's question when it keeps failing to connect. */
export async function checkAccess(id: string): Promise<'ok' | 'no-access' | 'signed-out'> {
  try {
    await documents.get(id);
    return 'ok';
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return 'signed-out';
      if (err.status === 403 || err.status === 404) return 'no-access';
    }
    throw err;
  }
}
