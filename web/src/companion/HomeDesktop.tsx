/**
 * Home's part inside the desktop app, loaded only there (docs/desktop-bridge.md):
 *
 *   · "On this PC", the files the app opened or saved lately, in the recent view;
 *   · a file Upload to Office left for `/?import=<nonce>`, imported as a dropped file is.
 */

import { useEffect, useState } from 'react';
import { useNotify } from '../core/ui';
import { useRouter } from '../router';
import type { CloudClient } from './bridge';
import { cloudBridge, takeImportFile } from './cloud';
import { LocalFiles } from './LocalFiles';
import { LocalFilesSkeleton } from './LocalFilesSkeleton';

export default function HomeDesktop({ takeFiles, showFiles }: { takeFiles: (files: File[]) => void; showFiles: boolean }) {
  const { query, navigate } = useRouter();
  const notify = useNotify();
  const [client, setClient] = useState<CloudClient | null | undefined>(undefined);
  const [nonce] = useState(() => query.get('import'));

  useEffect(() => {
    let live = true;
    void cloudBridge().then((c) => {
      if (live) setClient(c);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (nonce === null) return;
    // A reload must not ask again for what the shell gives only once.
    navigate('/', { replace: true });
    void takeImportFile(nonce).then((file) => {
      if (file === 'asked') return;
      if (file) takeFiles([file]);
      else notify({ text: 'That upload expired. Upload it again.', tone: 'danger' });
    });
  }, [nonce, navigate, notify, takeFiles]);

  if (!showFiles || client === null) return null;
  return client ? <LocalFiles client={client} /> : <LocalFilesSkeleton />;
}
