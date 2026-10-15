/**
 * The charts module: Insert > Charts, the chart pane, and the charts themselves over the grid.
 *
 *   Insert    Charts (order 200): Column, Bar, Line, Area, Pie, Scatter, from the selection
 *   Pane      Chart, on the right: type, data, title, legend, axes, colours
 *   Overlay   the cards, in the grid's own overlay layer (charts/ChartLayer.tsx)
 *
 * What a chart is, how it is read from the cells and how it is drawn are in `charts/`; this file says
 * where it goes. Insert reads the selection like Excel and Google do (charts/series.ts) and stores one
 * chart in its sheet, selected, in one step. A button is off wherever the workbook cannot be changed.
 */

import { pencilSimpleIcon, trashIcon } from '../../core/icons';
import type { Command, MenuEntry, RibbonGroup } from '../../core/shell/types';
import { ChartLayer } from '../charts/ChartLayer';
import { ChartPane } from '../charts/ChartPane';
import { deleteChart, insertChart } from '../charts/edit';
import { chartBarHorizontalIcon, chartBarIcon, chartDonutIcon, chartLineIcon, chartLineUpIcon, chartPieIcon, chartScatterIcon } from '../charts/icons';
import { chartStoreFor } from '../charts/store';
import type { ChartType } from '../charts/types';
import type { SheetsContext, SheetsModule } from './types';

const cannotEdit = (c: SheetsContext): boolean => !c.can.edit;

/** Makes the chart, then puts the keyboard on it, so Delete removes it and Escape lets go. */
export function insert(c: SheetsContext, type: ChartType, variant: { stacked?: boolean } = {}): string | null {
  const id = insertChart(c, type, variant);
  if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-chart="${id}"]`)?.focus({ preventScroll: true }));
  return id;
}

const entry = (label: string, icon: string, type: ChartType, variant: { stacked?: boolean } = {}): MenuEntry<SheetsContext> => ({
  label,
  icon,
  run: (c) => void insert(c, type, variant),
  disabled: cannotEdit
});

const ribbon: RibbonGroup<SheetsContext>[] = [
  {
    id: 'insert.charts',
    tab: 'insert',
    order: 200,
    label: 'Charts',
    items: [
      {
        type: 'menu',
        id: 'insert.chart-column',
        label: 'Column',
        icon: chartBarIcon,
        showLabel: true,
        disabled: cannotEdit,
        entries: [entry('Clustered column', chartBarIcon, 'column'), entry('Stacked column', chartBarIcon, 'column', { stacked: true })]
      },
      {
        type: 'menu',
        id: 'insert.chart-bar',
        label: 'Bar',
        icon: chartBarHorizontalIcon,
        showLabel: true,
        disabled: cannotEdit,
        entries: [entry('Clustered bar', chartBarHorizontalIcon, 'bar'), entry('Stacked bar', chartBarHorizontalIcon, 'bar', { stacked: true })]
      },
      { type: 'button', id: 'insert.chart-line', label: 'Line', icon: chartLineIcon, showLabel: true, disabled: cannotEdit, run: (c) => void insert(c, 'line') },
      { type: 'button', id: 'insert.chart-area', label: 'Area', icon: chartLineUpIcon, showLabel: true, disabled: cannotEdit, run: (c) => void insert(c, 'area') },
      {
        type: 'menu',
        id: 'insert.chart-pie',
        label: 'Pie',
        icon: chartPieIcon,
        showLabel: true,
        disabled: cannotEdit,
        entries: [entry('Pie', chartPieIcon, 'pie'), entry('Doughnut', chartDonutIcon, 'doughnut')]
      },
      { type: 'button', id: 'insert.chart-scatter', label: 'Scatter', icon: chartScatterIcon, showLabel: true, disabled: cannotEdit, run: (c) => void insert(c, 'scatter') }
    ]
  }
];

const KEYWORDS = ['graph', 'plot', 'visualise', 'visualize'];

const make = (id: string, title: string, icon: string, type: ChartType, variant: { stacked?: boolean } = {}, more: string[] = []): Command<SheetsContext> => ({
  id: `insert.chart-${id}`,
  title,
  section: 'Insert',
  icon,
  keywords: [...KEYWORDS, ...more],
  visible: (c) => c.can.edit,
  run: (c) => void insert(c, type, variant)
});

/** A chart is selected on the sheet on screen. */
const selected = (c: SheetsContext): boolean => {
  const store = chartStoreFor(c.model);
  const e = store.selected ? store.get(store.selected) : undefined;
  return !!e && e.host === c.sheetId;
};

const commands: Command<SheetsContext>[] = [
  make('column', 'Insert column chart', chartBarIcon, 'column', {}, ['bar', 'columns']),
  make('column-stacked', 'Insert stacked column chart', chartBarIcon, 'column', { stacked: true }),
  make('bar', 'Insert bar chart', chartBarHorizontalIcon, 'bar', {}, ['horizontal']),
  make('bar-stacked', 'Insert stacked bar chart', chartBarHorizontalIcon, 'bar', { stacked: true }),
  make('line', 'Insert line chart', chartLineIcon, 'line', {}, ['trend']),
  make('area', 'Insert area chart', chartLineUpIcon, 'area'),
  make('pie', 'Insert pie chart', chartPieIcon, 'pie', {}, ['share']),
  make('doughnut', 'Insert doughnut chart', chartDonutIcon, 'doughnut', {}, ['donut', 'ring']),
  make('scatter', 'Insert scatter chart', chartScatterIcon, 'scatter', {}, ['xy', 'correlation']),
  { id: 'chart.edit', title: 'Edit chart', section: 'Edit', icon: pencilSimpleIcon, keywords: ['chart', 'graph', 'format'], visible: (c) => c.can.edit && selected(c), run: (c) => c.panes.open('chart') },
  {
    id: 'chart.delete',
    title: 'Delete chart',
    section: 'Edit',
    icon: trashIcon,
    keywords: ['remove', 'graph'],
    visible: (c) => c.can.edit && selected(c),
    run: (c) => {
      const store = chartStoreFor(c.model);
      const e = store.selected ? store.get(store.selected) : undefined;
      if (e) deleteChart(c.model, e);
    }
  }
];

export const chartsModule: SheetsModule = {
  id: 'charts',
  ribbon,
  commands,
  panes: [{ id: 'chart', side: 'right', title: 'Chart', width: 320, visible: (c) => c.can.edit, render: (c) => <ChartPane ctx={c} /> }],
  overlays: [{ id: 'charts', render: (c) => <ChartLayer ctx={c} /> }]
};
