import { describe, expect, it } from 'vitest';
import { collect, problems } from '../modules/collect';
import { SHEETS_MODULES } from '../modules';
import { chartsModule } from '../modules/charts';
import type { SheetsContext } from '../modules/types';
import { room } from '../model/test/helpers';
import { chartStoreFor } from './store';

const all = collect(SHEETS_MODULES);

const ctx = (over: { edit?: boolean } = {}): SheetsContext => {
  const { people, sheet } = room((b) => b.addSheet('Data', { rows: 10, cols: 4 }));
  return { model: people[0]!.model, sheetId: sheet, can: { edit: over.edit ?? true } } as unknown as SheetsContext;
};

describe('the charts module', () => {
  it('is listed, and shares no id with any other module', () => {
    expect(SHEETS_MODULES.map((m) => m.id)).toContain('charts');
    expect(problems(SHEETS_MODULES)).toEqual([]);
  });

  it('puts one group, Charts, on the Insert tab at order 200, the slot the other modules are told about', () => {
    expect(chartsModule.ribbon.map((g) => [g.id, g.tab, g.order, g.label])).toEqual([['insert.charts', 'insert', 200, 'Charts']]);
    const items = chartsModule.ribbon[0]!.items.map((i) => i.id);
    expect(items).toEqual(['insert.chart-column', 'insert.chart-bar', 'insert.chart-line', 'insert.chart-area', 'insert.chart-pie', 'insert.chart-scatter']);
  });

  it('has a menu for the types that have a variant, with the stacked and doughnut ones in them', () => {
    const menus = Object.fromEntries(chartsModule.ribbon[0]!.items.flatMap((i) => (i.type === 'menu' ? [[i.id, i.entries.map((e) => e.label)]] : [])));
    expect(menus).toEqual({
      'insert.chart-column': ['Clustered column', 'Stacked column'],
      'insert.chart-bar': ['Clustered bar', 'Stacked bar'],
      'insert.chart-pie': ['Pie', 'Doughnut']
    });
  });

  it('is off wherever the workbook cannot be changed', () => {
    const reader = ctx({ edit: false });
    const editor = ctx({ edit: true });
    for (const item of chartsModule.ribbon[0]!.items) {
      if (item.type === 'separator' || item.type === 'custom') continue;
      expect(item.disabled?.(reader), item.id).toBe(true);
      expect(item.disabled?.(editor), item.id).toBe(false);
    }
    for (const cmd of all.commands.filter((c) => c.id.startsWith('insert.chart-'))) {
      expect(cmd.visible?.(reader), cmd.id).toBe(false);
      expect(cmd.visible?.(editor), cmd.id).toBe(true);
    }
  });

  it('adds Edit chart and Delete chart to the command box only while a chart on this sheet is selected', () => {
    const c = ctx();
    const edit = all.commands.find((x) => x.id === 'chart.edit')!;
    expect(edit.visible?.(c)).toBe(false);
    const sh = c.model.engine.sheet(c.sheetId)!;
    const id = c.model.setRule(c.sheetId, 'charts', null, {
      type: 'line',
      sheet: c.sheetId,
      data: { r1: sh.rowOrder[0]!, c1: sh.colOrder[0]!, r2: sh.rowOrder[2]!, c2: sh.colOrder[1]! },
      anchor: { row: sh.rowOrder[0]!, col: sh.colOrder[3]!, dx: 0, dy: 0 },
      w: 300,
      h: 200
    })!;
    chartStoreFor(c.model).select(id);
    expect(edit.visible?.(c)).toBe(true);
    expect(all.commands.find((x) => x.id === 'chart.delete')!.visible?.(c)).toBe(true);
    expect(edit.visible?.({ ...c, sheetId: 'another' } as SheetsContext)).toBe(false);
    expect(edit.visible?.({ ...c, can: { edit: false } } as unknown as SheetsContext)).toBe(false);
  });

  it('has a pane on the right for the selected chart, an overlay for the cards, and no pane for a reader', () => {
    expect(chartsModule.panes!.map((p) => [p.id, p.side, p.width])).toEqual([['chart', 'right', 320]]);
    expect(chartsModule.panes![0]!.visible?.(ctx({ edit: false }))).toBe(false);
    expect(chartsModule.panes![0]!.visible?.(ctx())).toBe(true);
    expect(chartsModule.overlays!.map((o) => o.id)).toEqual(['charts']);
  });
});
