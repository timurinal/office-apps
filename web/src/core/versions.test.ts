import { describe, expect, it } from 'vitest';
import type { VersionAuthor, VersionSummary } from '@shared/api';
import { authorsLine, canRename, dayLabel, groupByDay, timeOfDay, versionTitle, whenPhrase } from './versions';

/** Local time, so these hold in whatever zone the suite runs in. */
const at = (y: number, mo: number, d: number, h = 12, mi = 0): number =>
  Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

const NOW = at(2026, 10, 14, 12, 0);

let n = 0;
const version = (createdAt: number, over: Partial<VersionSummary> = {}): VersionSummary => ({
  id: `ver_${++n}`,
  kind: 'auto',
  label: null,
  authors: [],
  sizeBytes: 100,
  createdAt,
  ...over
});

const user = (name: string): VersionAuthor => ({ id: `u:${name}`, name, kind: 'user' });

describe('groupByDay', () => {
  it('groups by the reader\'s calendar day, newest first', () => {
    const days = groupByDay(
      [
        version(at(2026, 10, 13, 23, 30)),
        version(at(2026, 10, 14, 8, 0)),
        version(at(2026, 10, 14, 9, 0)),
        version(at(2026, 10, 1, 10, 0)),
        version(at(2025, 12, 20, 10, 0))
      ],
      NOW
    );
    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday', '1 Oct', '20 Dec 2025']);
    expect(days.map((d) => d.versions.length)).toEqual([2, 1, 1, 1]);
    // Newest first inside a day.
    expect(timeOfDay(days[0]!.versions[0]!.createdAt)).toBe('09:00');
    expect(timeOfDay(days[0]!.versions[1]!.createdAt)).toBe('08:00');
  });

  it('puts just after midnight on the new day, not the old one', () => {
    const days = groupByDay([version(at(2026, 10, 14, 0, 5)), version(at(2026, 10, 13, 23, 55))], NOW);
    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday']);
  });

  it('answers nothing for no versions', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('keeps the order of versions made in the same second stable', () => {
    const t = at(2026, 10, 14, 9, 0);
    const a = version(t, { id: 'ver_a' });
    const b = version(t, { id: 'ver_b' });
    expect(groupByDay([a, b], NOW)[0]!.versions.map((v) => v.id)).toEqual(['ver_b', 'ver_a']);
    expect(groupByDay([b, a], NOW)[0]!.versions.map((v) => v.id)).toEqual(['ver_b', 'ver_a']);
  });
});

describe('dayLabel', () => {
  it('says Today and Yesterday, then a date, then a date with its year', () => {
    expect(dayLabel(at(2026, 10, 14, 1), NOW)).toBe('Today');
    expect(dayLabel(at(2026, 10, 13, 22), NOW)).toBe('Yesterday');
    expect(dayLabel(at(2026, 8, 5, 22), NOW)).toBe('5 Aug');
    expect(dayLabel(at(2025, 12, 20, 22), NOW)).toBe('20 Dec 2025');
  });
});

describe('versionTitle', () => {
  it('prefers the name a person gave it', () => {
    expect(versionTitle({ kind: 'named', label: 'Sent to legal' })).toBe('Sent to legal');
  });
  it('describes the ones with no name', () => {
    expect(versionTitle({ kind: 'auto', label: null })).toBe('Edited');
    expect(versionTitle({ kind: 'restore', label: null })).toBe('Before restore');
    expect(versionTitle({ kind: 'assist', label: '  ' })).toBe('Automatic edit');
  });
  it('lets a label on any kind through, as the assistant\'s "Before the assistant" is', () => {
    expect(versionTitle({ kind: 'assist', label: 'Before the assistant' })).toBe('Before the assistant');
  });
});

describe('canRename', () => {
  it('is only for named versions', () => {
    expect(canRename({ kind: 'named' })).toBe(true);
    expect(canRename({ kind: 'auto' })).toBe(false);
    expect(canRename({ kind: 'restore' })).toBe(false);
  });
});

describe('authorsLine', () => {
  it('reads like a sentence', () => {
    expect(authorsLine([])).toBe('');
    expect(authorsLine([user('Ada Rowe')])).toBe('Ada Rowe');
    expect(authorsLine([user('Ada Rowe'), user('Ben Okoro')])).toBe('Ada Rowe and Ben Okoro');
    expect(authorsLine([user('Ada Rowe'), user('Ben Okoro'), user('Cy Lee')])).toBe('Ada Rowe and 2 others');
  });
  it('does not repeat a name that appears twice', () => {
    expect(authorsLine([user('Ada Rowe'), { id: 'g:1', name: 'Ada Rowe', kind: 'guest' }])).toBe('Ada Rowe');
  });
});

describe('whenPhrase', () => {
  it('reads inside a sentence', () => {
    expect(whenPhrase(at(2026, 10, 14, 10, 42), NOW)).toBe('today at 10:42');
    expect(whenPhrase(at(2026, 10, 13, 9, 5), NOW)).toBe('yesterday at 09:05');
    expect(whenPhrase(at(2026, 8, 5, 18, 0), NOW)).toBe('5 Aug at 18:00');
    expect(whenPhrase(at(2025, 12, 20, 18, 0), NOW)).toBe('20 Dec 2025 at 18:00');
  });
});
