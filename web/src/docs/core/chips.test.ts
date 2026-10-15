// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api';
import type { DocsContext } from '../modules/types';
import { pickerOf } from './chips';
import { fetchInfo, knownTitle, loadTitle, resetTitles, subscribeTitle } from './docTitles';
import { provideCtx } from './env';
import { dateItems, personItems, pickKey, createPickerStore, type PickItem } from './picker';
import { fetchPeople, filterMentionables, loadMentionables, resetPeople } from './people';
import { docOf, jsonOf, makeEditor, p, type TestEditor } from './testing';

let t: TestEditor;
afterEach(() => {
  t?.destroy();
  vi.unstubAllGlobals();
});

const PEOPLE = [
  { id: 'u1', name: 'Ada Rowe', handle: 'ada.rowe' },
  { id: 'u2', name: 'Priya Shah', handle: 'priya' },
  { id: 'u3', name: 'Sam Okafor', handle: 'sam.okafor' },
  { id: 'u4', name: 'Adrian Cole', handle: null }
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The two lists the picker asks the Worker for, with a way to hold either back. */
interface Server {
  /** Everyone the document has, as the Worker would list them. */
  people: typeof PEOPLE;
  /** What the unfiltered `?q=` answers: the first few. */
  base: number;
  documents: Array<{ id: string; kind: string; title: string; trashedAt: number | null }>;
  calls: string[];
  holdPeople: Promise<void> | null;
  holdDocuments: Promise<void> | null;
  peopleStatus: number;
}

function serve(over: Partial<Server> = {}): Server {
  const server: Server = { people: PEOPLE, base: 2, documents: [], calls: [], holdPeople: null, holdDocuments: null, peopleStatus: 200, ...over };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      server.calls.push(url);
      if (url.includes('/comments/people')) {
        await server.holdPeople;
        if (server.peopleStatus !== 200) return json({ error: { code: 'forbidden', message: 'No.' } }, server.peopleStatus);
        const q = new URL(url, 'http://x').searchParams.get('q') ?? '';
        const found = q ? filterMentionables(server.people, q, 8) : server.people.slice(0, server.base);
        return json({ people: found.map((x) => ({ userId: x.id, name: x.name, handle: x.handle })) });
      }
      if (url.includes('/api/office/documents?')) {
        await server.holdDocuments;
        return json({ documents: server.documents, nextCursor: null });
      }
      return json({ error: { code: 'not_found', message: 'x' } }, 404);
    })
  );
  return server;
}

beforeEach(() => {
  resetTitles();
  resetPeople();
  serve();
});

describe('who can be mentioned', () => {
  it('filters by the start of a name, a first or last name, or a handle, before a looser match', () => {
    expect(filterMentionables(PEOPLE, 'ad').map((p) => p.name)).toEqual(['Ada Rowe', 'Adrian Cole']);
    expect(filterMentionables(PEOPLE, 'okafor').map((p) => p.name)).toEqual(['Sam Okafor']);
    expect(filterMentionables(PEOPLE, '@priya').map((p) => p.name)).toEqual(['Priya Shah']);
    expect(filterMentionables(PEOPLE, 'ha').map((p) => p.name)).toEqual(['Priya Shah']);
    expect(filterMentionables(PEOPLE, 'zzz')).toEqual([]);
    expect(filterMentionables(PEOPLE, '')).toHaveLength(4);
    expect(filterMentionables(PEOPLE, '', 2)).toHaveLength(2);
  });

  it('asks the Worker for the people of this document, as the comment box does, and keeps the answer for a minute', async () => {
    const server = serve();
    expect(await fetchPeople('d1', '@Pri')).toEqual([{ id: 'u2', name: 'Priya Shah', handle: 'priya' }]);
    expect(server.calls).toEqual(['/api/office/documents/d1/comments/people?q=pri']);
    await fetchPeople('d1', 'pri');
    expect(server.calls).toHaveLength(1);
    await fetchPeople('d1', 'sam');
    await fetchPeople('d2', 'pri');
    expect(server.calls).toHaveLength(3);
  });

  it('does not keep a failed ask', async () => {
    const server = serve({ peopleStatus: 500 });
    await expect(fetchPeople('d1', 'x')).rejects.toBeInstanceOf(ApiError);
    server.peopleStatus = 200;
    await expect(fetchPeople('d1', 'x')).resolves.toEqual([]);
    expect(server.calls).toHaveLength(2);
  });

  it('lists the first of them for the first @, and the owner alone when the Worker will not say', async () => {
    const server = serve();
    const ctx = { source: { kind: 'cloud' }, meta: { id: 'd1', ownerId: 'u9', ownerName: 'Owen Hart' } } as unknown as DocsContext;
    expect((await loadMentionables(ctx)).map((x) => x.name)).toEqual(['Ada Rowe', 'Priya Shah']);
    resetPeople();
    server.peopleStatus = 403;
    expect(await loadMentionables(ctx)).toEqual([{ id: 'u9', name: 'Owen Hart', handle: null }]);
  });

  it('is empty for a local file, which has no one else, without asking', async () => {
    const server = serve();
    const ctx = { source: { kind: 'local' }, meta: { id: 'local', ownerId: '', ownerName: '' } } as unknown as DocsContext;
    expect(await loadMentionables(ctx)).toEqual([]);
    expect(server.calls).toEqual([]);
  });
});

describe('what the picker offers', () => {
  const NOW = new Date(2026, 9, 14, 12);

  it('offers the days around today, and narrows them by what was typed', () => {
    expect(dateItems('', NOW).map((d) => [d.label, d.detail])).toEqual([
      ['Today', '14 Oct 2026'],
      ['Tomorrow', '15 Oct 2026'],
      ['Yesterday', '13 Oct 2026'],
      ['Next week', '21 Oct 2026']
    ]);
    expect(dateItems('to', NOW).map((d) => d.label)).toEqual(['Today', 'Tomorrow']);
    expect(dateItems('x', NOW)).toEqual([]);
  });

  it('keys each row by what it points at, so two kinds never collide', () => {
    const keys = [
      pickKey({ kind: 'person', id: 'a', label: 'A', detail: '' }),
      pickKey({ kind: 'date', date: '2026-10-14', label: 'Today', detail: '' }),
      pickKey({ kind: 'doc', docId: 'a', docKind: 'docs', label: 'A', detail: '' })
    ];
    expect(new Set(keys).size).toBe(3);
    expect(personItems(PEOPLE, 'pri')).toEqual([{ kind: 'person', id: 'u2', label: 'Priya Shah', detail: '@priya' }]);
  });

  it('moves the highlight round, and tells subscribers', () => {
    const store = createPickerStore();
    const seen = vi.fn();
    store.subscribe(seen);
    store.set({ open: true, items: [{ kind: 'person', id: '1', label: 'a', detail: '' }, { kind: 'person', id: '2', label: 'b', detail: '' }, { kind: 'person', id: '3', label: 'c', detail: '' }] });
    store.move(1);
    store.move(1);
    store.move(1);
    expect(store.get().index).toBe(0);
    store.move(-1);
    expect(store.get().index).toBe(2);
    expect(seen).toHaveBeenCalledTimes(5);
  });
});

function typeAt(editor: TestEditor['editor'], text: string) {
  editor.commands.focus('end');
  editor.commands.insertContent(text);
}

const readyCtx = (over: Record<string, unknown> = {}) =>
  ({ source: { kind: 'cloud' }, meta: { id: 'd1', ownerId: 'u1', ownerName: 'Ada Rowe' }, can: { edit: true }, notify: vi.fn(), ...over }) as unknown as DocsContext;

const kinds = (e: TestEditor['editor']) => pickerOf(e).get().items.map((i) => i.kind);
const labels = (e: TestEditor['editor']) => pickerOf(e).get().items.map((i) => i.label);

describe('the @ picker in the page', () => {
  it('opens on @, lists the people and the dates, and closes when the @ is gone', async () => {
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.length).toBeGreaterThan(0));
    expect(pickerOf(t.editor).get().open).toBe(true);
    expect(kinds(t.editor)).toEqual(['person', 'person', 'date', 'date', 'date', 'date']);
    expect(labels(t.editor).slice(0, 2)).toEqual(['Ada Rowe', 'Priya Shah']);

    t.editor.commands.deleteRange({ from: t.editor.state.doc.content.size - 2, to: t.editor.state.doc.content.size - 1 });
    await vi.waitFor(() => expect(pickerOf(t.editor).get().open).toBe(false));
  });

  it('does not open for an email address, where the @ follows a letter', async () => {
    t = makeEditor(docOf(p('')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, 'write to ada@exam');
    await new Promise((r) => setTimeout(r, 30));
    expect(pickerOf(t.editor).get().open).toBe(false);
  });

  it('inserts a person as a mention, replacing what was typed, with a space after', async () => {
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@ad');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.some((i) => i.kind === 'person')).toBe(true));
    const s = pickerOf(t.editor).get();
    s.choose(s.items[0]!);
    const para = jsonOf(t.editor).content![0]!;
    expect(para.content!.map((n) => n.type)).toEqual(['text', 'mention', 'text']);
    expect(para.content![1]!.attrs).toMatchObject({ id: 'u1', label: 'Ada Rowe' });
    expect(para.content![0]!.text).toBe('Hi ');
    expect(para.content![2]!.text).toBe(' ');
    expect(t.editor.getText()).toContain('@Ada Rowe');
    expect(t.editor.getHTML()).toContain('class="mention"');
  });

  it('shows who it already knows at once, and swaps in what the Worker matches for the typed letters', async () => {
    let release!: () => void;
    // Sam is not among the first two the document lists, so only the server knows to offer him.
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.length).toBeGreaterThan(0));
    serve({ holdPeople: new Promise<void>((r) => (release = r)) });
    t.editor.commands.insertContent('sam');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().query).toBe('sam'));
    // Nobody known matches yet.
    expect(kinds(t.editor)).not.toContain('person');
    release();
    await vi.waitFor(() => expect(labels(t.editor)).toContain('Sam Okafor'));
    expect(kinds(t.editor)[0]).toBe('person');
  });

  it('drops what a slower, older answer brings when the letters have moved on', async () => {
    let release!: () => void;
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.length).toBeGreaterThan(0));
    serve({ holdPeople: new Promise<void>((r) => (release = r)) });
    t.editor.commands.insertContent('sam');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().query).toBe('sam'));
    t.editor.commands.insertContent('x');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().query).toBe('samx'));
    release();
    await new Promise((r) => setTimeout(r, 60));
    expect(labels(t.editor)).not.toContain('Sam Okafor');
  });

  it('inserts a date', async () => {
    t = makeEditor(docOf(p('Due ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@tod');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.some((i) => i.kind === 'date')).toBe(true));
    const s = pickerOf(t.editor).get();
    s.choose(s.items.find((i) => i.kind === 'date' && i.label === 'Today')!);
    const chip = jsonOf(t.editor).content![0]!.content!.find((n) => n.type === 'dateChip')!;
    expect(chip.attrs!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.editor.getText()).toMatch(/Due \d{1,2} \w{3} \d{4}/);
  });

  it('inserts a link to a document the reader chose, from their own list', async () => {
    const server = serve({ documents: [{ id: 'd2', kind: 'sheets', title: 'Quarterly budget', trashedAt: null }, { id: 'd1', kind: 'docs', title: 'This one', trashedAt: null }, { id: 'd3', kind: 'docs', title: 'Gone', trashedAt: 5 }] });
    t = makeEditor(docOf(p('See ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@quar');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.some((i) => i.kind === 'doc')).toBe(true), { timeout: 2000 });
    expect(server.calls.some((u) => u.includes('/api/office/documents?') && u.includes('q=quar'))).toBe(true);
    const docs = pickerOf(t.editor).get().items.filter((i) => i.kind === 'doc');
    // Not the document being edited, and not one in the trash.
    expect(docs.map((d) => (d as Extract<PickItem, { kind: 'doc' }>).docId)).toEqual(['d2']);
    pickerOf(t.editor).get().choose(docs[0]!);
    const link = jsonOf(t.editor).content![0]!.content!.find((n) => n.type === 'docLink')!;
    expect(link.attrs).toMatchObject({ docId: 'd2', kind: 'sheets', title: 'Quarterly budget' });
  });

  it('shows the people and the dates at once, and adds the documents when the list answers', async () => {
    let release!: () => void;
    serve({ holdDocuments: new Promise<void>((r) => (release = r)), documents: [{ id: 'd2', kind: 'docs', title: 'Adoption notes', trashedAt: null }] });
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@ad');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.some((i) => i.kind === 'person')).toBe(true));
    // The people are in and the document list has not answered.
    expect(kinds(t.editor)).not.toContain('doc');
    await new Promise((r) => setTimeout(r, 200));
    release();
    await vi.waitFor(() => expect(kinds(t.editor)).toContain('doc'));
    const k = kinds(t.editor);
    expect(k.indexOf('person')).toBeLessThan(k.indexOf('doc'));
  });

  it('offers no people to a person the Worker will not list them for, and still offers dates', async () => {
    serve({ peopleStatus: 403 });
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.length).toBeGreaterThan(0));
    // The owner, whose name the page holds, and the days.
    expect(kinds(t.editor)).toEqual(['person', 'date', 'date', 'date', 'date']);
    expect(labels(t.editor)[0]).toBe('Ada Rowe');
  });

  it('moves with the arrow keys and chooses with Enter', async () => {
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    typeAt(t.editor, '@');
    await vi.waitFor(() => expect(pickerOf(t.editor).get().items.length).toBeGreaterThan(1));
    const key = (k: string) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      t.editor.view.dom.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(key('ArrowDown')).toBe(true);
    expect(pickerOf(t.editor).get().index).toBe(1);
    expect(key('ArrowUp')).toBe(true);
    expect(pickerOf(t.editor).get().index).toBe(0);
    expect(key('Enter')).toBe(true);
    expect(jsonOf(t.editor).content![0]!.content!.some((n) => n.type === 'mention')).toBe(true);
  });

  it('does not open where a chip cannot go: in a code block', async () => {
    t = makeEditor(docOf({ type: 'codeBlock', content: [{ type: 'text', text: 'let a = ' }] }));
    provideCtx(t.editor, readyCtx());
    // Inside the code block (the editor adds a paragraph after it, which is where `end` is).
    t.editor.commands.setTextSelection(9);
    t.editor.commands.insertContent(' @');
    await new Promise((r) => setTimeout(r, 40));
    expect(t.editor.state.doc.firstChild!.textContent).toContain('@');
    expect(pickerOf(t.editor).get().open).toBe(false);
  });

  it('does not open for someone who can only read', async () => {
    t = makeEditor(docOf(p('Hi ')));
    provideCtx(t.editor, readyCtx());
    t.editor.setEditable(false);
    t.editor.chain().insertContentAt(4, '@').run();
    await new Promise((r) => setTimeout(r, 30));
    expect(pickerOf(t.editor).get().open).toBe(false);
  });
});

describe('the chips as nodes', () => {
  it('survive HTML, and read back what was written', () => {
    t = makeEditor(
      docOf({
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: 'u1', label: 'Ada Rowe' } },
          { type: 'dateChip', attrs: { date: '2026-10-14' } },
          { type: 'docLink', attrs: { docId: 'd2', kind: 'sheets', title: 'Budget' } }
        ]
      })
    );
    const html = t.editor.getHTML();
    expect(html).toContain('data-type="mention"');
    expect(html).toContain('data-date="2026-10-14"');
    expect(html).toContain('data-doc-id="d2"');
    expect(html).toContain('data-kind="sheets"');

    const other = makeEditor(docOf(p('')));
    other.editor.commands.setContent(html);
    expect(jsonOf(other.editor).content![0]!.content!.map((n) => n.type)).toEqual(['mention', 'dateChip', 'docLink']);
    expect(jsonOf(other.editor).content![0]!.content![2]!.attrs).toMatchObject({ docId: 'd2', kind: 'sheets', title: 'Budget' });
    other.destroy();
  });

  it('refuse a date that is not a day and an id that is not an id', () => {
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'dateChip', attrs: { date: '2026-02-30' } }, { type: 'docLink', attrs: { docId: 'x" onmouseover="alert(1)', kind: 'docs', title: '<img src=x onerror=alert(1)>' } }] }));
    const html = t.editor.getHTML();
    // The date is shown as it was written, and is not a date: nothing is kept as one.
    expect(html).not.toContain('data-date');
    expect(html).not.toContain('data-doc-id');
    expect(t.editor.view.dom.querySelector('img:not(.ProseMirror-separator), [onmouseover]')).toBeNull();
  });

  it('are one character wide to the caret and read as their text', () => {
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'dateChip', attrs: { date: '2026-10-14' } }, { type: 'text', text: 'b' }] }));
    // The paragraph's two tokens, and one each for a, the chip and b.
    expect(t.editor.state.doc.content.size).toBe(5);
    expect(t.editor.getText()).toBe('a14 Oct 2026b');
  });
});

describe('the live title of a linked document', () => {
  const mount = (attrs: Record<string, unknown>) => {
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'docLink', attrs }] }));
    return t.editor.view.dom.querySelector<HTMLElement>('[data-type="doc-link"]')!;
  };

  it('shows the stored title at once and the current one when it arrives, in the colour of the app it points at', async () => {
    resetTitles(async () => ({ title: 'Budget, final', kind: 'sheets' }));
    const el = mount({ docId: 'd2', kind: 'docs', title: 'Budget draft' });
    expect(el.textContent).toBe('Budget draft');
    await vi.waitFor(() => expect(el.textContent).toBe('Budget, final'));
    expect(el.dataset.app).toBe('sheets');
    expect(el.dataset.state).toBe('ok');
  });

  it('keeps the stored title and says so when the reader cannot open the document', async () => {
    resetTitles(async () => null);
    const el = mount({ docId: 'd2', kind: 'docs', title: 'Secret plan' });
    await vi.waitFor(() => expect(el.dataset.state).toBe('unavailable'));
    expect(el.textContent).toBe('Secret plan');
    expect(el.title).toBe('You cannot open this document.');
  });

  it('keeps the stored title through a network failure and does not remember the failure', async () => {
    let calls = 0;
    resetTitles(async () => {
      calls += 1;
      throw new Error('offline');
    });
    const el = mount({ docId: 'd2', kind: 'docs', title: 'Plan' });
    await new Promise((r) => setTimeout(r, 20));
    expect(el.textContent).toBe('Plan');
    expect(el.dataset.state).toBe('ok');
    expect(knownTitle('d2')).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('is redrawn when another chip to the same document learns the title', async () => {
    resetTitles(async () => ({ title: 'Now', kind: 'docs' }));
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'docLink', attrs: { docId: 'd2', kind: 'docs', title: 'Then' } }, { type: 'text', text: ' ' }, { type: 'docLink', attrs: { docId: 'd2', kind: 'docs', title: 'Then' } }] }));
    await vi.waitFor(() => expect([...t.editor.view.dom.querySelectorAll('[data-type="doc-link"]')].map((e) => e.textContent)).toEqual(['Now', 'Now']));
  });
});

describe('asking for titles', () => {
  it('asks once per document however many chips ask, and remembers', async () => {
    const f = vi.fn(async (id: string) => ({ title: `T ${id}`, kind: 'docs' as const }));
    resetTitles(f);
    const [a, b, c] = await Promise.all([loadTitle('x'), loadTitle('x'), loadTitle('x')]);
    expect(a).toEqual(b);
    expect(c).toEqual({ title: 'T x', kind: 'docs' });
    expect(f).toHaveBeenCalledTimes(1);
    await loadTitle('x');
    expect(f).toHaveBeenCalledTimes(1);
    expect(knownTitle('x')).toEqual({ title: 'T x', kind: 'docs' });
  });

  it('asks four at a time, so a document of links does not open with a burst', async () => {
    let live = 0;
    let most = 0;
    const gates: Array<() => void> = [];
    resetTitles(
      (id) =>
        new Promise((resolve) => {
          live += 1;
          most = Math.max(most, live);
          gates.push(() => {
            live -= 1;
            resolve({ title: id, kind: 'docs' });
          });
        })
    );
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => loadTitle(`d${i}`)));
    await Promise.resolve();
    expect(live).toBe(4);
    while (gates.length) {
      gates.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await all;
    expect(most).toBe(4);
  });

  it('tells subscribers when an answer arrives, and not after they leave', async () => {
    resetTitles(async () => ({ title: 'A', kind: 'docs' }));
    const seen = vi.fn();
    const off = subscribeTitle('x', seen);
    await loadTitle('x');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    resetTitles(async () => ({ title: 'B', kind: 'docs' }));
    const again = vi.fn();
    subscribeTitle('y', again)();
    await loadTitle('y');
    expect(again).not.toHaveBeenCalled();
  });

  it('reads 401, 403 and 404 as "cannot open", and anything else as a failure to ask', async () => {
    for (const status of [401, 403, 404]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status, headers: { 'content-type': 'application/json' } })));
      expect(await fetchInfo('d1')).toBeNull();
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'internal', message: 'x' } }), { status: 500, headers: { 'content-type': 'application/json' } })));
    await expect(fetchInfo('d1')).rejects.toBeInstanceOf(ApiError);
  });

  it('asks without opening: the peek path, and the title and kind from the answer', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('/api/office/documents/d1?peek=1');
      return new Response(JSON.stringify({ id: 'd1', title: 'Plan', kind: 'slides' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', f);
    expect(await fetchInfo('d1')).toEqual({ title: 'Plan', kind: 'slides' });
  });
});
