/**
 * The pane that lists a sheet's conditional-format rules, first priority first: what each looks for,
 * where it applies, and its look, with the means to edit it, move it up or down and delete it.
 * It follows the model, so a rule another person adds or removes appears here without a refresh.
 */

import { Button, IconButton } from '../../core/controls';
import { caretDownIcon, caretUpIcon, pencilSimpleIcon, trashIcon } from '../../core/icons';
import type { CfRule } from '../model';
import { clearRules, describe, moveRule, rangesText, removeRule, rulesOf } from '../modules/conditionalActions';
import { type SheetsContext } from '../modules/types';
import { useModelVersion } from './parts';
import { openTool } from './tools';

function Chip({ rule }: { rule: CfRule }) {
  const w = rule.when;
  if (w.kind === 'scale') return <span className="sx-rule-chip" style={{ background: `linear-gradient(90deg, ${w.min}, ${w.mid ? `${w.mid}, ` : ''}${w.max})` }} />;
  if (w.kind === 'bar') {
    return (
      <span className="sx-rule-chip" style={{ justifyContent: 'flex-start', padding: '0 3px' }}>
        <span style={{ width: '70%', height: 16, background: w.color, borderRadius: 2 }} />
      </span>
    );
  }
  const s = rule.style;
  return (
    <span
      className="sx-rule-chip"
      style={{
        ...(s.fill ? { background: s.fill } : {}),
        ...(s.color ? { color: s.color } : {}),
        fontWeight: s.bold ? 700 : 600,
        fontStyle: s.italic ? 'italic' : 'normal',
        textDecoration: s.strike ? 'line-through' : 'none'
      }}
    >
      Aa
    </span>
  );
}

export default function CfManager({ ctx }: { ctx: SheetsContext }) {
  useModelVersion(ctx.model);
  const rules = rulesOf(ctx);
  const edit = ctx.can.edit;

  return (
    <div className="sx-rules">
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" disabled={!edit} onClick={() => openTool({ id: 'cf' })}>
          New rule
        </Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" disabled={!edit || rules.length === 0} onClick={() => clearRules(ctx, 'sheet')}>
          Clear all
        </Button>
      </div>

      {rules.length === 0 && <p className="sx-empty">No rules on this sheet. Select cells and add one.</p>}

      {rules.map(({ id, rule, rects }, i) => (
        <div className="sx-rule-card" key={id} data-rule={id}>
          <Chip rule={rule} />
          <div className="sx-rule-text">
            <span className="sx-rule-title">{describe(rule.when, ctx)}</span>
            <span className="sx-rule-where">
              {rects.length ? rangesText(rects) : 'Cells that are gone'}
              {rule.stop ? ', stops here' : ''}
            </span>
          </div>
          <div className="sx-rule-tools">
            <div style={{ display: 'flex' }}>
              <IconButton icon={caretUpIcon} label="Move up" size="sm" disabled={!edit || i === 0} onClick={() => moveRule(ctx, id, -1)} />
              <IconButton icon={caretDownIcon} label="Move down" size="sm" disabled={!edit || i === rules.length - 1} onClick={() => moveRule(ctx, id, 1)} />
            </div>
            <div style={{ display: 'flex' }}>
              <IconButton icon={pencilSimpleIcon} label="Edit rule" size="sm" disabled={!edit} onClick={() => openTool({ id: 'cf', ruleId: id })} />
              <IconButton icon={trashIcon} label="Delete rule" size="sm" disabled={!edit} onClick={() => removeRule(ctx, id)} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
