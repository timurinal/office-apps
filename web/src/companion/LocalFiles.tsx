/**
 * "On this PC": the files the desktop app opened or saved lately, Open, and New. Home draws it inside
 * the app, and the local page's home draws it when the Office address cannot be reached
 * (docs/desktop-bridge.md). Each opens in a new local tab; the shell does the opening.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../core/controls';
import { fileTextIcon, folderOpenIcon, Icon, plusIcon, presentationChartIcon, tableIcon } from '../core/icons';
import { Menu, SkeletonRows, useNotify, type MenuItem } from '../core/ui';
import { KIND_GLYPH } from '../home/Thumb';
import { formatWhen } from '../theme';
import { KIND_OF_FORMAT, type DesktopClient, type RecentFile } from './bridge';
import './desktop.css';

export function LocalFiles({ client }: { client: DesktopClient }) {
  const notify = useNotify();
  const [recent, setRecent] = useState<RecentFile[] | null>(null);

  const ask = useCallback(() => client.recentFiles().then(setRecent), [client]);
  useEffect(() => {
    let live = true;
    void client.recentFiles().then((list) => live && setRecent(list));
    // A file opened or saved in another tab is on the list when this tab is shown again.
    const shown = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    document.addEventListener('visibilitychange', shown);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', shown);
    };
  }, [client, ask]);

  const open = async (file: RecentFile) => {
    if ((await client.openRecent(file.key)) !== 'missing') return;
    setRecent((list) => list?.filter((f) => f.key !== file.key) ?? null);
    notify({ text: `“${file.name}” is not there any more.`, tone: 'danger' });
  };

  const newItems: MenuItem[] = [
    { label: 'New document', icon: fileTextIcon, onSelect: () => client.newLocal('docs') },
    { label: 'New spreadsheet', icon: tableIcon, onSelect: () => client.newLocal('sheets') },
    { label: 'New presentation', icon: presentationChartIcon, onSelect: () => client.newLocal('slides') }
  ];

  return (
    <section aria-labelledby="oa-local-h" className="oa-home-panel">
      <div className="oa-home-list-head">
        <h2 id="oa-local-h" className="oa-home-h">
          On this PC
        </h2>
        <span style={{ flex: 1 }} />
        <Button icon={folderOpenIcon} onClick={() => client.openFile()}>
          Open
        </Button>
        <Menu
          label="New"
          icon={plusIcon}
          items={newItems}
          trigger={({ open: isOpen, toggle, ref }) => (
            <Button ref={ref} icon={plusIcon} chevron aria-haspopup="menu" aria-expanded={isOpen} onClick={toggle}>
              New
            </Button>
          )}
        />
      </div>

      {recent === null && <SkeletonRows count={3} />}
      {recent?.length === 0 && <p className="oa-home-empty">No recent files.</p>}
      {recent && recent.length > 0 && (
        <div className="oa-clist" role="list" aria-label="Recent files">
          {recent.map((f) => {
            const kind = KIND_OF_FORMAT[f.format];
            return (
              <div key={f.key} role="listitem" className="oa-row oa-lrow" data-app={kind}>
                <span className="oa-lrow-tile">
                  <Icon icon={KIND_GLYPH[kind]} size={18} />
                </span>
                <span className="oa-lrow-title">
                  <button type="button" className="oa-local-open oa-ellipsis" onClick={() => void open(f)}>
                    {f.name}
                  </button>
                </span>
                <span className="oa-col-owner oa-ellipsis oa-lrow-cell" style={{ width: 220 }} title={f.folder}>
                  {f.folder}
                </span>
                <span className="oa-col-date oa-lrow-cell" style={{ width: 120 }}>
                  {formatWhen(f.modified / 1000)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
