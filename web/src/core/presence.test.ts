// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { colorFor } from './color';
import { peersFrom, readUser, samePeers, splitVisible } from './presence';

const state = (name: string, color = colorFor(name)) => ({ user: { name, color } });
/** The account site's avatar route, as `accountOrigin()` names it on localhost. */
const PICTURES = `http://${window.location.hostname}:8787/api/account/avatar/avatars`;

describe('peersFrom', () => {
  it('lists each person once however many tabs they have open', () => {
    const peers = peersFrom(
      new Map<number, unknown>([
        [1, state('Ada Rowe')],
        [2, state('Ada Rowe')],
        [3, state('Ben Okoro')]
      ]),
      99
    );
    expect(peers.map((p) => p.name)).toEqual(['Ada Rowe', 'Ben Okoro']);
    expect(peers[0]!.tabs).toBe(2);
  });

  it('puts this browser first and marks it, from any of its tabs', () => {
    const peers = peersFrom(
      new Map<number, unknown>([
        [5, state('Ben Okoro')],
        [7, state('Ada Rowe')],
        [9, state('Ada Rowe')]
      ]),
      9
    );
    expect(peers[0]).toMatchObject({ name: 'Ada Rowe', self: true, tabs: 2 });
    expect(peers[1]).toMatchObject({ name: 'Ben Okoro', self: false });
  });

  it('does not let one person hide another by claiming their colour', () => {
    // Same name, different colour: two people who happen to share a name.
    const peers = peersFrom(
      new Map<number, unknown>([
        [1, state('Sam', '#5d5294')],
        [2, state('Sam', '#b93c59')]
      ]),
      0
    );
    expect(peers).toHaveLength(2);
  });

  it('skips clients that have not said who they are', () => {
    const peers = peersFrom(
      new Map<number, unknown>([
        [1, {}],
        [2, null],
        [3, { user: null }],
        [4, { user: { color: '#5d5294' } }]
      ]),
      0
    );
    // Only the last has a user at all, and its missing name becomes "Someone".
    expect(peers.map((p) => p.name)).toEqual(['Someone']);
  });

  it('orders the others by name so the row does not shuffle', () => {
    const peers = peersFrom(
      new Map<number, unknown>([
        [3, state('Zed')],
        [1, state('Amy')],
        [2, state('Bo')]
      ]),
      0
    );
    expect(peers.map((p) => p.name)).toEqual(['Amy', 'Bo', 'Zed']);
  });
});

describe('readUser', () => {
  it('replaces a colour that is not six-digit hex with one derived from the name', () => {
    const u = readUser({ user: { name: 'Ada', color: 'red; background: url(x)' } });
    expect(u?.color).toBe(colorFor('Ada'));
  });

  it('trims and caps a name', () => {
    expect(readUser({ user: { name: '  Ada  ', color: '#5d5294' } })?.name).toBe('Ada');
    expect(readUser({ user: { name: 'x'.repeat(200), color: '#5d5294' } })?.name).toHaveLength(64);
  });

  it('answers null for anything that is not a state', () => {
    expect(readUser(undefined)).toBeNull();
    expect(readUser('Ada')).toBeNull();
    expect(readUser({ user: 'Ada' })).toBeNull();
  });
});

describe('splitVisible', () => {
  it('shows everyone when they fit', () => {
    expect(splitVisible([1, 2, 3], 4)).toEqual({ shown: [1, 2, 3], hidden: 0 });
  });
  it('counts the rest', () => {
    expect(splitVisible([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], hidden: 2 });
  });
});

describe('samePeers', () => {
  const ada = { clientId: 1, name: 'Ada Rowe', color: '#aabbcc', avatar: null, self: true, tabs: 1 };
  const ben = { clientId: 2, name: 'Ben Okoro', color: '#112233', avatar: null, self: false, tabs: 1 };

  it('is the same list when nobody came or went, whatever they were doing', () => {
    expect(samePeers([ada, ben], [{ ...ada }, { ...ben }])).toBe(true);
    expect(samePeers([], [])).toBe(true);
  });

  it('is a different list when somebody comes, goes, opens another tab, or is another person', () => {
    expect(samePeers([ada], [ada, ben])).toBe(false);
    expect(samePeers([ada, ben], [ada])).toBe(false);
    expect(samePeers([ada, ben], [ada, { ...ben, tabs: 2 }])).toBe(false);
    expect(samePeers([ada, ben], [ada, { ...ben, name: 'Bea Okoro' }])).toBe(false);
    expect(samePeers([ada, ben], [{ ...ada, self: false }, ben])).toBe(false);
  });

  it("is a different list when somebody's picture arrives", () => {
    expect(samePeers([ada, ben], [ada, { ...ben, avatar: `${PICTURES}/usr_ben/0f6c1d2e-8a3b-4c5d-9e7f-0123456789ab` }])).toBe(false);
  });
});

describe('the picture', () => {
  const ben = `${PICTURES}/usr_ben/0f6c1d2e-8a3b-4c5d-9e7f-0123456789ab`;

  it('is read from the state the room stamped', () => {
    expect(readUser({ user: { name: 'Ben Okoro', avatar: ben } })?.avatar).toBe(ben);
    expect(readUser({ user: { name: 'Ben Okoro' } })?.avatar).toBeNull();
  });

  it('is only ever the account site\'s avatar route', () => {
    for (const bad of [
      'https://tracker.example/pixel.gif',
      `${PICTURES.replace('8787', '8788')}/usr_ben/abc`,
      `${PICTURES}/usr_ben/abc?x=1`,
      `${PICTURES}/../../account`,
      `${PICTURES}/usr_ben`,
      'javascript:alert(1)',
      42
    ]) {
      expect(readUser({ user: { name: 'Ben Okoro', avatar: bad } })?.avatar).toBeNull();
    }
  });

  it('is one per person, from whichever of their tabs has it', () => {
    const peers = peersFrom(
      new Map<number, unknown>([
        [1, { user: { name: 'Ben Okoro', color: '#112233' } }],
        [2, { user: { name: 'Ben Okoro', color: '#112233', avatar: ben } }]
      ]),
      99
    );
    expect(peers).toHaveLength(1);
    expect(peers[0]!.avatar).toBe(ben);
  });
});
