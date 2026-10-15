import { describe, expect, it } from 'vitest';
import { matchEntries, parseEntries, serialiseEntries } from './nodes';

describe('the table of contents snapshot', () => {
  it('survives a round trip', () => {
    const entries = [
      { level: 1, text: 'Introduction' },
      { level: 2, text: 'Scope' }
    ];
    expect(parseEntries(serialiseEntries(entries))).toEqual(entries);
  });

  it('reads anything else as empty, and clamps what it keeps', () => {
    expect(parseEntries(undefined)).toEqual([]);
    expect(parseEntries('not json')).toEqual([]);
    expect(parseEntries('{"level":1}')).toEqual([]);
    expect(parseEntries('[{"level":9,"text":"Deep"},{"text":"No level"},{"level":1},null]')).toEqual([
      { level: 3, text: 'Deep' },
      { level: 1, text: 'No level' }
    ]);
  });

  it('finds each entry’s heading in order, twins included, and none for one that has gone', () => {
    const headings = [
      { level: 1, text: 'Notes', pos: 10 },
      { level: 2, text: 'Detail', pos: 40 },
      { level: 1, text: 'Notes', pos: 90 }
    ];
    const entries = [
      { level: 1, text: 'Notes' },
      { level: 1, text: 'Notes' },
      { level: 2, text: 'Gone' }
    ];
    expect(matchEntries(entries, headings)).toEqual([10, 90, null]);
  });
});
