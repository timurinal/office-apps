/**
 * Insert > Special characters: a dialog of the characters people reach for, in groups, with
 * a search by name. Choosing one inserts it where the caret was and closes the dialog.
 */

import type { Editor } from '@tiptap/core';
import { useMemo, useState } from 'react';
import { TextField, UnderlineTabs } from '../../core/controls';
import { Modal } from '../../core/ui';
import { CHAR_GROUPS, searchChars } from './characters';

export function SpecialChars({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('common');
  const [named, setNamed] = useState('');
  // Searching looks everywhere; the groups are for browsing.
  const shown = useMemo(() => searchChars(query, query.trim() ? 'all' : group), [query, group]);

  const insert = (ch: string) => {
    editor.chain().focus().insertContent(ch).run();
    onClose();
  };

  return (
    <Modal title="Special characters" width={520} onClose={onClose}>
      <TextField aria-label="Search characters" placeholder="Search by name" size="sm" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
      {!query.trim() && (
        <div style={{ marginTop: 10 }}>
          <UnderlineTabs items={CHAR_GROUPS.map((g) => ({ value: g.id, label: g.label }))} value={group} onChange={setGroup} label="Groups" />
        </div>
      )}
      <div className="oa-chars-grid" role="group" aria-label="Characters">
        {shown.map((c) => (
          <button
            key={c.ch}
            type="button"
            className="oa-chars-cell"
            aria-label={c.name}
            title={c.name}
            onMouseEnter={() => setNamed(c.name)}
            onFocus={() => setNamed(c.name)}
            onClick={() => insert(c.ch)}
          >
            {c.ch === ' ' ? '␣' : c.ch}
          </button>
        ))}
      </div>
      <div className="oa-chars-name" aria-live="polite">
        {shown.length === 0 ? 'Nothing matches that.' : named}
      </div>
      <div style={{ height: 8 }} />
    </Modal>
  );
}
