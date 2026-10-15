/**
 * The File menu's rows, in sections. The rows come from the modules' `fileItems`
 * (docs/modules/types.ts), so Download, Print and "Save as template" appear the
 * moment a module contributes them.
 */

import { Icon } from '../icons';
import { fileSections } from './registry';
import type { FileItem } from './types';

export function FileMenu<C>({ items, ctx }: { items: readonly FileItem<C>[]; ctx: C }) {
  const sections = fileSections(items, ctx);
  return (
    <div role="none">
      {sections.map((s, i) => (
        <div key={s.section} role="group" aria-label={s.section}>
          {i > 0 && <div className="oa-menu-rule" />}
          {s.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="oa-menu-item"
              data-tone={item.danger ? 'danger' : undefined}
              disabled={item.disabled?.(ctx) ?? false}
              onClick={() => item.run(ctx)}
            >
              {item.icon ? <Icon icon={item.icon} size={16} /> : <span className="oa-menu-gap" />}
              <span className="oa-menu-label">{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
