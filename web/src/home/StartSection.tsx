/**
 * "Start something new.": three blank starts and the templates, in tabs.
 *
 * Suggested is the blanks and the first few predefined templates, one row at the width
 * the board is drawn for (the rail's Templates view has them all, so Recent is not pushed
 * off the first screen), Yours is the reader's own,
 * and the third tab (the organisation's name) is the templates its owners and admins
 * marked for everyone. A card makes the document and opens it.
 *
 * A predefined card draws its own page from the template's content (docs/templates), where
 * the others draw the kind's generic one: the server does not send a document's content for
 * a list.
 */

import { useState } from 'react';
import type { DocKind, TemplateSummary } from '@shared/api';
import { UnderlineTabs } from '../core/controls';
import { buildingsIcon } from '../core/icons';
import { prefetchEditor } from '../core/prefetch';
import { Spinner } from '../core/ui';
import { warmTemplates } from '../docs/templates/create';
import { PREDEFINED_PREFIX, sketchFor } from '../docs/templates';
import type { Sketch } from '../docs/templates/sketch';
import { BLANKS, KIND_LABEL } from './home';
import { SketchThumb } from './SketchThumb';
import { Thumb } from './Thumb';

export interface Entry {
  key: string;
  kind: DocKind;
  title: string;
  blank: boolean;
  templateId?: string;
  description?: string | null;
  /** A predefined template's own page. */
  sketch?: Sketch | null;
}

/** With the three blanks, a row of seven cards: what the Home board draws at 1440px. */
const SUGGESTED_TEMPLATES = 4;

export const fromTemplate = (t: TemplateSummary): Entry => ({
  key: t.id,
  kind: t.kind,
  title: t.title,
  blank: false,
  templateId: t.id,
  description: t.description,
  sketch: t.scope === 'predefined' ? sketchFor(t.id) : null
});

export function TemplateGrid({
  entries,
  onCreate,
  animate = false,
  row = false
}: {
  entries: Entry[];
  onCreate: (kind: DocKind, templateId?: string) => Promise<void>;
  /** Cards rise in one after another: after a change of tab, not on the page's first paint. */
  animate?: boolean;
  /** On a phone, one row that scrolls sideways, so ten cards do not push Recent five screens down. */
  row?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (entry: Entry) => {
    if (busy) return;
    setBusy(entry.key);
    try {
      await onCreate(entry.kind, entry.templateId);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="oa-tgrid" data-stagger={animate ? 'true' : undefined} data-row={row ? 'true' : undefined}>
      {entries.map((e, i) => (
        <Card key={e.key} entry={e} index={i} busy={busy === e.key} onPick={() => void pick(e)} />
      ))}
    </div>
  );
}

/** Pointing at a card starts what pressing it needs: the editor's code, and the template's builder. */
function warm(entry: Entry): void {
  prefetchEditor(entry.kind);
  if (entry.templateId?.startsWith(PREDEFINED_PREFIX)) warmTemplates();
}

function Card({ entry, index, busy, onPick }: { entry: Entry; index: number; busy: boolean; onPick: () => void }) {
  return (
    // Named by its title, and described by its kind, so a screen reader hears "Blank document"
    // and then "Docs", not one run of words.
    <button
      type="button"
      className="oa-tcard"
      data-app={entry.kind}
      aria-label={entry.title}
      aria-describedby={`${entry.key}-kind`}
      title={entry.description ?? undefined}
      disabled={busy}
      style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
      onPointerEnter={() => warm(entry)}
      onFocus={() => warm(entry)}
      onClick={onPick}
    >
      <span className="oa-tcard-thumb">
        {busy ? (
          <Spinner size={22} />
        ) : entry.sketch ? (
          <SketchThumb sketch={entry.sketch} />
        ) : (
          <Thumb kind={entry.kind} variant="template" blank={entry.blank} />
        )}
      </span>
      <span className="oa-tcard-text">
        <span className="oa-tcard-title oa-ellipsis">{entry.title}</span>
        <span id={`${entry.key}-kind`} className="oa-tcard-kind">
          {KIND_LABEL[entry.kind]}
        </span>
      </span>
    </button>
  );
}

export function StartSection({
  templates,
  orgName,
  onCreate
}: {
  templates: TemplateSummary[];
  /** The organisation's name, for its tab. */
  orgName: string | null;
  /** Makes the document and resolves when it has. */
  onCreate: (kind: DocKind, templateId?: string) => Promise<void>;
}) {
  const [tab, setTab] = useState('suggested');
  // The cards rise in when the tab is changed, and stay still on the page's first paint.
  const [moved, setMoved] = useState(false);
  const choose = (value: string) => {
    setMoved(true);
    setTab(value);
  };

  const mine = templates.filter((t) => t.scope === 'user').map(fromTemplate);
  const company = templates.filter((t) => t.scope === 'org').map(fromTemplate);
  const suggested: Entry[] = [
    ...BLANKS.map((b) => ({ key: `blank:${b.kind}`, kind: b.kind, title: b.title, blank: true })),
    ...templates.filter((t) => t.scope === 'predefined').slice(0, SUGGESTED_TEMPLATES).map(fromTemplate)
  ];

  const showCompany = company.length > 0;
  const tabs = [
    { value: 'suggested', label: 'Suggested' },
    { value: 'yours', label: 'Yours' },
    ...(showCompany ? [{ value: 'org', label: orgName ?? 'Company', icon: buildingsIcon }] : [])
  ];
  const active = tab === 'org' && !showCompany ? 'suggested' : tab;
  const entries = active === 'yours' ? mine : active === 'org' ? company : suggested;

  return (
    <section aria-labelledby="oa-new-h" className="oa-home-panel">
      <div className="oa-home-panel-head">
        <h1 id="oa-new-h" className="oa-home-h">
          Start something new.
        </h1>
        <UnderlineTabs label="Template source" items={tabs} value={active} onChange={choose} />
      </div>
      {entries.length === 0 ? (
        <p className="oa-home-empty">Save a document as a template from its File menu.</p>
      ) : (
        <TemplateGrid key={active} entries={entries} onCreate={onCreate} animate={moved} row />
      )}
    </section>
  );
}
