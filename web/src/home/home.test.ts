import { describe, expect, it } from 'vitest';
import {
  dateColumn,
  docPath,
  emptyText,
  formatBytes,
  importKindFor,
  isDocsFile,
  isSheetsFile,
  ownerLabel,
  ownedBy,
  RAIL,
  readLayout,
  VIEW_HEADING,
  writeLayout
} from './home';

describe('importKindFor', () => {
  it('sends each file to the editor that opens it', () => {
    expect(importKindFor('Report.docx')).toBe('docs');
    expect(importKindFor('budget.xlsx')).toBe('sheets');
    expect(importKindFor('export.csv')).toBe('sheets');
    expect(importKindFor('export.TSV')).toBe('sheets');
    expect(importKindFor('deck.pptx')).toBe('slides');
  });

  it('opens a workbook and delimited text in Sheets, and not a document', () => {
    for (const name of ['budget.xlsx', 'export.csv', 'export.tsv']) expect(isSheetsFile(name), name).toBe(true);
    for (const name of ['Report.docx', 'notes.md', 'deck.pptx', 'old.xls', 'data.xlsm']) expect(isSheetsFile(name), name).toBe(false);
  });

  it('opens Markdown and web pages in Docs', () => {
    expect(importKindFor('notes.md')).toBe('docs');
    expect(importKindFor('README.markdown')).toBe('docs');
    expect(importKindFor('page.html')).toBe('docs');
    expect(importKindFor('page.HTM')).toBe('docs');
    expect(isDocsFile('Report.docx')).toBe(true);
    expect(isDocsFile('budget.xlsx')).toBe(false);
  });

  it('ignores the case of the extension and any dots before it', () => {
    expect(importKindFor('REPORT.DOCX')).toBe('docs');
    expect(importKindFor('v2.final.draft.docx')).toBe('docs');
  });

  it('refuses everything else', () => {
    expect(importKindFor('notes.txt')).toBeNull();
    expect(importKindFor('archive.docx.zip')).toBeNull();
    expect(importKindFor('docx')).toBeNull();
    expect(importKindFor('')).toBeNull();
    expect(importKindFor('old.doc')).toBeNull();
  });
});

describe('docPath', () => {
  it('spells the permanent paths', () => {
    expect(docPath('docs', 'abc')).toBe('/docs/abc');
    expect(docPath('sheets', 'abc')).toBe('/sheets/abc');
    expect(docPath('slides', 'abc')).toBe('/slides/abc');
  });
  it('encodes an id that is not path-safe', () => {
    expect(docPath('docs', 'a/b')).toBe('/docs/a%2Fb');
  });
});

describe('the rail', () => {
  it('offers home, shared, starred, templates and trash, in the order the board draws them', () => {
    expect(RAIL.map((v) => v.value)).toEqual(['recent', 'shared', 'starred', 'templates', 'trash']);
  });

  it('heads every view with a sentence that ends in a full stop', () => {
    for (const v of RAIL) expect(VIEW_HEADING[v.value].endsWith('.'), v.value).toBe(true);
  });
});

describe('ownedBy', () => {
  const docs = [
    { id: 'a', ownerId: 'me' },
    { id: 'b', ownerId: 'them' },
    { id: 'c', ownerId: 'me' }
  ];
  it('keeps everything for anyone, and when nobody is signed in', () => {
    expect(ownedBy(docs, 'any', 'me')).toHaveLength(3);
    expect(ownedBy(docs, 'me', null)).toHaveLength(3);
  });
  it('narrows to your own, or to everyone else\u2019s', () => {
    expect(ownedBy(docs, 'me', 'me').map((d) => d.id)).toEqual(['a', 'c']);
    expect(ownedBy(docs, 'others', 'me').map((d) => d.id)).toEqual(['b']);
  });
});

describe('dateColumn', () => {
  const doc = { openedAt: 300, updatedAt: 200, trashedAt: 100 as number | null };
  it('shows when it was deleted in the trash', () => {
    expect(dateColumn(doc, 'trash')).toEqual({ label: 'Deleted', at: 100 });
  });
  it('shows when you opened it in recent, if you have', () => {
    expect(dateColumn(doc, 'recent')).toEqual({ label: 'Opened', at: 300 });
    expect(dateColumn({ ...doc, openedAt: null }, 'recent')).toEqual({ label: 'Modified', at: 200 });
  });
  it('shows when it last changed everywhere else', () => {
    expect(dateColumn(doc, 'owned')).toEqual({ label: 'Modified', at: 200 });
    expect(dateColumn(doc, 'starred')).toEqual({ label: 'Modified', at: 200 });
  });
});

describe('ownerLabel', () => {
  it('says You for your own', () => {
    expect(ownerLabel({ ownerId: 'u1', ownerName: 'Ada Rowe' }, 'u1')).toBe('You');
    expect(ownerLabel({ ownerId: 'u1', ownerName: 'Ada Rowe' }, 'u2')).toBe('Ada Rowe');
    expect(ownerLabel({ ownerId: 'u1', ownerName: 'Ada Rowe' }, null)).toBe('Ada Rowe');
  });
});

describe('emptyText', () => {
  it('names the next action rather than defining the feature', () => {
    expect(emptyText('recent', '')).toBe('Nothing here yet. Start with a blank document.');
    expect(emptyText('starred', '')).toBe('Star a document to find it here.');
    expect(emptyText('trash', '')).toBe('The trash is empty.');
  });
  it('answers a search by quoting it', () => {
    expect(emptyText('recent', '  budget ')).toBe('No documents match “budget”.');
  });
});

describe('formatBytes', () => {
  it('uses the unit a person reads', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('the remembered layout', () => {
  it('reads what was written, and defaults to the grid', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readLayout(storage)).toBe('grid');
    writeLayout('list', storage);
    expect(readLayout(storage)).toBe('list');
    writeLayout('grid', storage);
    expect(readLayout(storage)).toBe('grid');
  });

  it('works when storage throws or is missing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };
    expect(readLayout(broken)).toBe('grid');
    expect(() => writeLayout('list', broken)).not.toThrow();
    expect(readLayout(null)).toBe('grid');
    expect(() => writeLayout('list', null)).not.toThrow();
  });
});
