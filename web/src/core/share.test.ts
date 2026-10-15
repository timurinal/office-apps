import { describe, expect, it } from 'vitest';
import {
  endOfLocalDay,
  expiryFor,
  expiryNote,
  forgetLinkUrl,
  localDateString,
  parseInvitee,
  recallLinkUrl,
  rememberLinkUrl
} from './share';

describe('parseInvitee', () => {
  it('reads an address as an email, lower-cased', () => {
    expect(parseInvitee('Ben@Office.Test')).toEqual({ email: 'ben@office.test' });
  });

  it('reads anything else as a handle, with or without the @', () => {
    expect(parseInvitee('@ada.rowe')).toEqual({ handle: 'ada.rowe' });
    expect(parseInvitee('  Ada.Rowe ')).toEqual({ handle: 'ada.rowe' });
  });

  it('refuses what cannot be either', () => {
    expect(parseInvitee('')).toBeNull();
    expect(parseInvitee('   ')).toBeNull();
    expect(parseInvitee('ada rowe')).toBeNull();
    expect(parseInvitee('@@ada')).toBeNull();
    expect(parseInvitee('ada@')).toBeNull();
    expect(parseInvitee('<script>')).toBeNull();
  });
});

describe('expiryFor', () => {
  const NOW = 1_800_000_000;

  it('is null for never', () => {
    expect(expiryFor('never', NOW)).toBeNull();
  });

  it('counts the presets from now', () => {
    expect(expiryFor('1d', NOW)).toBe(NOW + 86_400);
    expect(expiryFor('7d', NOW)).toBe(NOW + 7 * 86_400);
    expect(expiryFor('30d', NOW)).toBe(NOW + 30 * 86_400);
  });

  it('ends a chosen date at the end of that day, in the reader\'s zone', () => {
    const tomorrow = localDateString(NOW + 86_400);
    const end = expiryFor('custom', NOW, tomorrow)!;
    expect(end).toBeGreaterThan(NOW);
    expect(localDateString(end)).toBe(tomorrow);
    expect(new Date(end * 1000).getHours()).toBe(23);
  });

  it('holds back a date that is missing or already gone', () => {
    expect(expiryFor('custom', NOW)).toBeUndefined();
    expect(expiryFor('custom', NOW, '')).toBeUndefined();
    expect(expiryFor('custom', NOW, localDateString(NOW - 2 * 86_400))).toBeUndefined();
  });
});

describe('endOfLocalDay', () => {
  it('refuses a date that is not on the calendar', () => {
    expect(endOfLocalDay('2026-02-31')).toBeNull();
    expect(endOfLocalDay('2026-13-01')).toBeNull();
    expect(endOfLocalDay('tomorrow')).toBeNull();
    expect(endOfLocalDay('2026-2-3')).toBeNull();
  });
  it('accepts a leap day only in a leap year', () => {
    expect(endOfLocalDay('2028-02-29')).not.toBeNull();
    expect(endOfLocalDay('2027-02-29')).toBeNull();
  });
});

describe('expiryNote', () => {
  const NOW = Math.floor(new Date(2026, 9, 14, 12).getTime() / 1000);
  it('says when it ends, or that it ended', () => {
    expect(expiryNote(Math.floor(new Date(2026, 9, 21, 23).getTime() / 1000), NOW)).toBe('Ends 21 Oct');
    expect(expiryNote(Math.floor(new Date(2026, 9, 2, 23).getTime() / 1000), NOW)).toBe('Ended 2 Oct');
  });
});

describe('the remembered link', () => {
  it('keeps the one copy for as long as the page lives, per document', () => {
    rememberLinkUrl('doc_a', 'https://office.example.com/l/abc');
    expect(recallLinkUrl('doc_a')).toBe('https://office.example.com/l/abc');
    expect(recallLinkUrl('doc_b')).toBeUndefined();
    forgetLinkUrl('doc_a');
    expect(recallLinkUrl('doc_a')).toBeUndefined();
  });
});
