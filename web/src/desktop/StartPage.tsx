/**
 * The Start window: ways to begin, and the files opened lately.
 *
 * The cards are Home's (`home/StartSection.tsx`): the blanks for each kind that is built, then
 * the predefined templates, each drawing its own first page. A card asks the host for a new
 * window; the recent list comes from the host, which keeps it.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DocKind } from '@shared/api';
import { Button } from '../core/controls';
import { fileTextIcon, folderOpenIcon, Icon, presentationChartIcon, tableIcon, xIcon, type PhIcon } from '../core/icons';
import { isMac } from '../core/keys';
import { predefinedSummaries } from '../docs/templates';
import { BLANKS } from '../home/home';
import { fromTemplate, TemplateGrid, type Entry } from '../home/StartSection';
import { formatWhen } from '../theme';
import { useHost, type RecentFile } from './host';
import { KINDS } from './kinds';
import '../home/home.css';
import './start.css';

const KIND_ICON: Record<DocKind, PhIcon> = { docs: fileTextIcon, sheets: tableIcon, slides: presentationChartIcon };

function folderOf(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  const folder = parts.join('/');
  return folder.replace(/^\/(Users|home)\/[^/]+/, '~') || '/';
}

export function StartPage() {
  const { host, info } = useHost();
  const [recents, setRecents] = useState<RecentFile[] | null>(null);

  const load = useCallback(() => {
    host.recents().then(setRecents, () => setRecents([]));
  }, [host]);

  useEffect(() => {
    load();
    return host.onCommand((name) => {
      if (name === 'recentsChanged') load();
    });
  }, [host, load]);

  useEffect(() => {
    host.setState({ title: info.appName, dirty: false, hasPath: false, saving: false });
  }, [host, info]);

  const entries: Entry[] = [
    ...BLANKS.filter((b) => KINDS[b.kind].enabled).map((b) => ({ key: `blank:${b.kind}`, kind: b.kind, title: b.title, blank: true })),
    ...predefinedSummaries().map(fromTemplate)
  ];
  const onCreate = async (kind: DocKind, templateId?: string) => host.newDocument(kind, templateId);

  return (
    <div className="oa-home oa-start" data-start="true">
      <header className="oa-home-hd oa-start-hd">
        <span className="oa-start-brand">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          {info.appName}
        </span>
        <span className="oa-start-gap" />
        <Button variant="suite" icon={folderOpenIcon} onClick={() => host.open()}>
          Open…
        </Button>
      </header>

      <div className="oa-home-body">
        <main className="oa-home-main">
          <section aria-labelledby="oa-new-h" className="oa-home-panel">
            <div className="oa-home-panel-head">
              <h1 id="oa-new-h" className="oa-home-h">
                Start something new.
              </h1>
            </div>
            <TemplateGrid entries={entries} onCreate={onCreate} />
          </section>

          <section aria-labelledby="oa-recent-h" className="oa-home-panel oa-home-list">
            <div className="oa-home-list-head">
              <h2 id="oa-recent-h" className="oa-home-h">
                Recent.
              </h2>
            </div>
            {recents && recents.length === 0 && <p className="oa-home-empty">Open a file, or start one above.</p>}
            {recents && recents.length > 0 && (
              <ul className="oa-recent" aria-label="Recent files">
                {recents.map((r) => (
                  <RecentRow key={r.path} file={r} />
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function RecentRow({ file }: { file: RecentFile }) {
  const { host } = useHost();
  return (
    <li className="oa-recent-row" data-app={file.kind} data-missing={file.exists ? undefined : 'true'}>
      <button
        type="button"
        className="oa-recent-open"
        disabled={!file.exists}
        title={file.exists ? file.path : 'This file is not there any more.'}
        onClick={() => host.openRecent(file.path)}
      >
        <span className="oa-recent-mark" aria-hidden="true">
          <Icon icon={KIND_ICON[file.kind]} size={18} />
        </span>
        <span className="oa-recent-name oa-ellipsis">{file.name}</span>
        <span className="oa-recent-folder oa-ellipsis">{file.exists ? folderOf(file.path) : 'Not found'}</span>
        <span className="oa-recent-when">{formatWhen(Math.floor(file.openedAt / 1000))}</span>
      </button>
      {file.exists && (
        <button type="button" className="oa-recent-act" aria-label={isMac() ? 'Show in Finder' : 'Show in folder'} title={isMac() ? 'Show in Finder' : 'Show in folder'} onClick={() => host.reveal(file.path)}>
          <Icon icon={folderOpenIcon} size={16} />
        </button>
      )}
      <button type="button" className="oa-recent-act" aria-label="Remove from the list" title="Remove from the list" onClick={() => host.forgetRecent(file.path)}>
        <Icon icon={xIcon} size={16} />
      </button>
    </li>
  );
}
