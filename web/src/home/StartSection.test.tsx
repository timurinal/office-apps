// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocKind, TemplateSummary } from '@shared/api';
import { predefinedSummaries } from '../docs/templates';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const warm = vi.hoisted(() => ({ editor: vi.fn(), templates: vi.fn() }));
vi.mock('../core/prefetch', () => ({ prefetchEditor: warm.editor }));
vi.mock('../docs/templates/create', () => ({ warmTemplates: warm.templates }));

const { StartSection } = await import('./StartSection');

const mine: TemplateSummary = { id: 'd_mine', kind: 'docs', title: 'Our sprint review', scope: 'user', ownerName: 'Ada', description: null };
const theirs: TemplateSummary = { id: 'd_org', kind: 'docs', title: 'Client proposal', scope: 'org', ownerName: 'Ben', description: null };

let host: HTMLDivElement;
let root: Root;
let onCreate: ReturnType<typeof vi.fn<(kind: DocKind, templateId?: string) => Promise<void>>>;

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  onCreate = vi.fn<(kind: DocKind, templateId?: string) => Promise<void>>().mockResolvedValue(undefined);
  warm.editor.mockClear();
  warm.templates.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (templates: TemplateSummary[], orgName: string | null = 'Northwind Studio') =>
  act(() => root.render(<StartSection templates={templates} orgName={orgName} onCreate={onCreate} />));

const cards = () => [...host.querySelectorAll<HTMLButtonElement>('.oa-tcard')];
const names = () => cards().map((c) => c.getAttribute('aria-label'));
const tab = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((t) => t.textContent?.includes(label))!;

describe('Start something new', () => {
  it('shows the three blanks and then the first of Docs’ templates: one row, not the whole shelf', () => {
    mount(predefinedSummaries());
    expect(names()).toEqual(['Blank document', 'Blank spreadsheet', 'Blank presentation', 'Meeting notes', 'Project brief', 'Report', 'Letter']);
  });

  it('draws a template’s own page on its card, and the kind’s generic page on the others', () => {
    mount(predefinedSummaries());
    const withSketch = cards().filter((c) => c.querySelector('[aria-hidden="true"][style*="padding"]'));
    // The predefined cards draw a sketch; the blanks draw a plus.
    expect(withSketch.map((c) => c.getAttribute('aria-label'))).toEqual(['Meeting notes', 'Project brief', 'Report', 'Letter']);
    // Two predefined templates do not draw alike.
    const html = (label: string) => cards().find((c) => c.getAttribute('aria-label') === label)!.querySelector('.oa-tcard-thumb')!.innerHTML;
    expect(html('Letter')).not.toBe(html('Report'));
  });

  it('draws a personal template with the kind’s page, since a list carries no content', () => {
    mount([mine]);
    act(() => tab('Yours').click());
    const card = cards()[0]!;
    expect(card.getAttribute('aria-label')).toBe('Our sprint review');
    expect(card.querySelector('[aria-hidden="true"][style*="padding"]')).toBeNull();
    expect(card.querySelector('.oa-tcard-thumb')!.children.length).toBe(1);
  });

  it('has Suggested, Yours and the organisation’s tab, which is there only when it has a template', () => {
    mount([...predefinedSummaries(), mine]);
    expect([...host.querySelectorAll('[role=tab]')].map((t) => t.textContent)).toEqual(['Suggested', 'Yours']);
    mount([...predefinedSummaries(), mine, theirs]);
    expect([...host.querySelectorAll('[role=tab]')].map((t) => t.textContent)).toEqual(['Suggested', 'Yours', 'Northwind Studio']);
  });

  it('lists Yours and the organisation’s separately', () => {
    mount([...predefinedSummaries(), mine, theirs]);
    act(() => tab('Yours').click());
    expect(names()).toEqual(['Our sprint review']);
    act(() => tab('Northwind Studio').click());
    expect(names()).toEqual(['Client proposal']);
    act(() => tab('Suggested').click());
    expect(names()).toContain('Meeting notes');
  });

  it('names the next action when Yours is empty, and does not define the feature', () => {
    mount(predefinedSummaries());
    act(() => tab('Yours').click());
    expect(host.querySelector('.oa-home-empty')?.textContent).toBe('Save a document as a template from its File menu.');
    expect(cards()).toEqual([]);
  });

  it('lets the cards rise in after a change of tab, and not on the first paint', () => {
    mount([...predefinedSummaries(), mine]);
    expect(host.querySelector('.oa-tgrid')!.getAttribute('data-stagger')).toBeNull();
    act(() => tab('Yours').click());
    expect(host.querySelector('.oa-tgrid')!.getAttribute('data-stagger')).toBe('true');
    expect(cards()[0]!.getAttribute('style')).toContain('--i: 0');
  });

  it('makes the document when a card is pressed: a blank by its kind, a template by its id', async () => {
    mount([...predefinedSummaries(), mine]);
    await act(async () => cards()[1]!.click());
    expect(onCreate).toHaveBeenLastCalledWith('sheets', undefined);
    await act(async () => cards().find((c) => c.getAttribute('aria-label') === 'Report')!.click());
    expect(onCreate).toHaveBeenLastCalledWith('docs', 'predefined:report');
    act(() => tab('Yours').click());
    await act(async () => cards()[0]!.click());
    expect(onCreate).toHaveBeenLastCalledWith('docs', 'd_mine');
  });

  it('starts what a press needs when the pointer reaches a card: the editor, and for a predefined template its builder', () => {
    mount(predefinedSummaries());
    // React makes `onPointerEnter` from `pointerover`.
    const over = (label: string) => act(() => void cards().find((c) => c.getAttribute('aria-label') === label)!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    over('Blank document');
    expect(warm.editor).toHaveBeenCalledWith('docs');
    expect(warm.templates).not.toHaveBeenCalled();
    over('Report');
    expect(warm.templates).toHaveBeenCalledTimes(1);
  });

  it('puts a template’s description on its card as a tooltip', () => {
    mount(predefinedSummaries());
    expect(cards().find((c) => c.getAttribute('aria-label') === 'Report')!.getAttribute('title')).toBe('A cover, contents, numbered pages and the usual sections.');
    expect(cards()[0]!.getAttribute('title')).toBeNull();
  });
});
