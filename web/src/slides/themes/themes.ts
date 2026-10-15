/**
 * The eight themes a deck can start from, and the look each one gives its master and layouts.
 *
 * A theme is eleven colours and two typefaces (`ThemeJSON`). What a theme cannot say is how it
 * is *used*: which ground a title slide draws on, how big its titles are. That is the `Look`,
 * kept beside it and keyed by the theme's id, so a theme that came from an imported file (an id
 * this file has never seen) gets `deriveLook` instead of failing.
 *
 * The slots read the same way in every theme:
 *
 *   light   lt1 the ground    dk1 the ink      dk2 the quiet ink      lt2 a tint for surfaces
 *   dark    dk1 the ground    lt1 the ink      lt2 the quiet ink      dk2 a raised surface
 *
 * Every pairing the layouts use (ink on ground, quiet ink on ground, ink on a hero ground) holds
 * 4.5 to 1, and `themes.test.ts` computes each one.
 *
 * Colours come from the design system's ramps (`tokens/colors.css`) and from the Slides board,
 * and fonts from the ones the app hosts (Inter) or that every machine has
 * (`docs/core/fonts.ts`), so a deck looks the same where it is opened.
 */

import type { Color, ThemeJSON, ThemeSlot } from '../model/deck';
import { contrast, resolveColor } from './color';

export const DEFAULT_THEME_ID = 'violet';

export const THEMES: readonly ThemeJSON[] = [
  {
    id: 'violet',
    name: 'Violet',
    colors: {
      dk1: '#292b31', lt1: '#fbfaff', dk2: '#595d6c', lt2: '#f0eefe',
      accent1: '#796cbf', accent2: '#17c6bb', accent3: '#ac89b6', accent4: '#e8a33d', accent5: '#6f78bd', accent6: '#d94f6f',
      hlink: '#5d5294', folHlink: '#886193'
    },
    fonts: { major: 'Trebuchet MS', minor: 'Inter' }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    colors: {
      dk1: '#12142e', lt1: '#f3f5fe', dk2: '#1f2250', lt2: '#b2b6ca',
      accent1: '#b5abfc', accent2: '#17c6bb', accent3: '#d2a8e0', accent4: '#f0b45a', accent5: '#8c9aee', accent6: '#f27a96',
      hlink: '#8aeae2', folHlink: '#d2cefd'
    },
    fonts: { major: 'Inter', minor: 'Inter' }
  },
  {
    id: 'paper',
    name: 'Paper',
    colors: {
      dk1: '#2b2118', lt1: '#faf6ee', dk2: '#6b5b4b', lt2: '#f0e8d8',
      accent1: '#b4532a', accent2: '#6b7a3a', accent3: '#c28a2b', accent4: '#8c4a5a', accent5: '#3f6b73', accent6: '#9a6b3f',
      hlink: '#8a3d1b', folHlink: '#7a5a6b'
    },
    fonts: { major: 'Georgia', minor: 'Georgia' }
  },
  {
    id: 'fern',
    name: 'Fern',
    colors: {
      dk1: '#14231b', lt1: '#f7fbf8', dk2: '#4d6055', lt2: '#e4f1ea',
      accent1: '#1e8255', accent2: '#43a873', accent3: '#82d1a8', accent4: '#c9a227', accent5: '#2f6f8f', accent6: '#a65a3a',
      hlink: '#176842', folHlink: '#5d5294'
    },
    fonts: { major: 'Trebuchet MS', minor: 'Inter' }
  },
  {
    id: 'harbour',
    name: 'Harbour',
    colors: {
      dk1: '#0f1f3a', lt1: '#f8faff', dk2: '#4a5a78', lt2: '#ebf1fe',
      accent1: '#2f55a6', accent2: '#6b93e8', accent3: '#9dbcfb', accent4: '#e0a030', accent5: '#17898f', accent6: '#c4506a',
      hlink: '#2f55a6', folHlink: '#5d5294'
    },
    fonts: { major: 'Inter', minor: 'Inter' }
  },
  {
    id: 'ember',
    name: 'Ember',
    colors: {
      dk1: '#2a160b', lt1: '#fffaf6', dk2: '#6a4a38', lt2: '#fdefe7',
      accent1: '#c0501c', accent2: '#ea7a3f', accent3: '#f9a874', accent4: '#8a5a12', accent5: '#2f7f8a', accent6: '#9a4116',
      hlink: '#9a4116', folHlink: '#6a4a38'
    },
    fonts: { major: 'Trebuchet MS', minor: 'Inter' }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    colors: {
      dk1: '#111214', lt1: '#ffffff', dk2: '#55585f', lt2: '#f0f1f3',
      accent1: '#2e3036', accent2: '#5a5d66', accent3: '#878b95', accent4: '#b4b8c1', accent5: '#3e4149', accent6: '#d4d7dd',
      hlink: '#111214', folHlink: '#55585f'
    },
    fonts: { major: 'Arial', minor: 'Arial' }
  },
  {
    id: 'billboard',
    name: 'Billboard',
    colors: {
      dk1: '#0d0d0d', lt1: '#ffffff', dk2: '#4a4a4a', lt2: '#f2f0ea',
      accent1: '#d9381e', accent2: '#ffbf1f', accent3: '#1a3de0', accent4: '#00a37a', accent5: '#7a3cf0', accent6: '#ff7a59',
      hlink: '#1a3de0', folHlink: '#7a3cf0'
    },
    fonts: { major: 'Inter', minor: 'Inter' }
  }
];

export const themeById = (id: string): ThemeJSON | undefined => THEMES.find((t) => t.id === id);

/** What a theme draws on, and how big it writes. Resolved against the theme, so it follows it. */
export interface Look {
  dark: boolean;
  /** The ground of the title slide, with the ink, quiet ink and accent that sit on it. */
  hero: { bg: Color; ink: Color; muted: Color; accent: Color };
  /** Title size in points, and the title slide's. */
  title: number;
  cover: number;
  /** Titles in bold. */
  bold: boolean;
  /** The card behind a figure, and the ink on it. */
  card: { bg: Color; ink: Color };
}

export const slot = (theme: ThemeSlot, lum?: number): Color => (lum === undefined ? { theme } : { theme, lum });

const LOOKS: Record<string, Look> = {
  // White on the 600 violet is 4.46 to 1; three per cent darker clears 4.5 and is not a different violet.
  violet: {
    dark: false,
    hero: { bg: slot('accent1', -0.03), ink: '#ffffff', muted: '#ffffff', accent: slot('accent2') },
    title: 42, cover: 66, bold: true,
    card: { bg: slot('accent1', -0.03), ink: '#ffffff' }
  },
  midnight: {
    dark: true,
    hero: { bg: slot('dk2'), ink: slot('lt1'), muted: slot('lt2'), accent: slot('accent2') },
    title: 40, cover: 66, bold: true,
    card: { bg: slot('accent1'), ink: slot('dk1') }
  },
  paper: {
    dark: false,
    hero: { bg: slot('dk1'), ink: slot('lt1'), muted: '#d8cdb8', accent: slot('accent3') },
    title: 40, cover: 64, bold: false,
    card: { bg: slot('accent1'), ink: '#ffffff' }
  },
  fern: {
    dark: false,
    hero: { bg: slot('accent1'), ink: '#ffffff', muted: '#ffffff', accent: slot('accent3') },
    title: 40, cover: 66, bold: true,
    card: { bg: slot('accent1'), ink: '#ffffff' }
  },
  harbour: {
    dark: false,
    hero: { bg: slot('accent1'), ink: '#ffffff', muted: '#ebf1fe', accent: slot('accent3') },
    title: 40, cover: 66, bold: true,
    card: { bg: slot('accent1'), ink: '#ffffff' }
  },
  ember: {
    dark: false,
    hero: { bg: slot('accent1'), ink: '#ffffff', muted: '#ffffff', accent: slot('accent3') },
    title: 42, cover: 66, bold: true,
    card: { bg: slot('accent1'), ink: '#ffffff' }
  },
  graphite: {
    dark: false,
    hero: { bg: slot('dk1'), ink: '#ffffff', muted: '#c8cbd2', accent: '#ffffff' },
    title: 38, cover: 64, bold: true,
    card: { bg: slot('dk1'), ink: '#ffffff' }
  },
  billboard: {
    dark: false,
    hero: { bg: slot('accent1'), ink: '#ffffff', muted: '#ffffff', accent: slot('accent2') },
    title: 54, cover: 88, bold: true,
    card: { bg: slot('dk1'), ink: '#ffffff' }
  }
};

/**
 * A look for a theme this file does not know: light, with the title slide on the accent when white
 * reads on it and on the ink when it does not. It is what an imported theme gets if it is ever
 * given a master from here.
 */
function deriveLook(theme: ThemeJSON): Look {
  const white = '#ffffff';
  const onAccent = contrast(white, theme.colors.accent1) >= 4.5;
  const bg: Color = onAccent ? slot('accent1') : slot('dk1');
  return {
    dark: false,
    hero: { bg, ink: white, muted: white, accent: slot('accent2') },
    title: 40, cover: 66, bold: true,
    card: { bg, ink: white }
  };
}

export const lookOf = (theme: ThemeJSON): Look => LOOKS[theme.id] ?? deriveLook(theme);

/** What a theme's own muted and surface slots are, by the convention in this file's header. */
export function tonesOf(theme: ThemeJSON): { ground: Color; ink: Color; muted: Color; surface: Color; accent: Color } {
  const dark = lookOf(theme).dark;
  return {
    ground: slot(dark ? 'dk1' : 'lt1'),
    ink: slot(dark ? 'lt1' : 'dk1'),
    muted: slot(dark ? 'lt2' : 'dk2'),
    surface: slot(dark ? 'dk2' : 'lt2'),
    accent: slot('accent1')
  };
}

/**
 * What the Design tab's gallery draws for a theme: its ground, ink and accents, and its fonts.
 * Colours are `#rrggbb`, resolved, so the gallery needs no theme maths.
 */
export interface ThemePreview {
  id: string;
  name: string;
  dark: boolean;
  /** The ground of an ordinary slide, and the ink on it. */
  ground: string;
  ink: string;
  /** The title slide's ground and the ink on it. */
  hero: string;
  heroInk: string;
  /** accent1 to accent6, in order. */
  accents: string[];
  major: string;
  minor: string;
}

export function previewOf(theme: ThemeJSON): ThemePreview {
  const look = lookOf(theme);
  const tones = tonesOf(theme);
  return {
    id: theme.id,
    name: theme.name,
    dark: look.dark,
    ground: resolveColor(tones.ground, theme),
    ink: resolveColor(tones.ink, theme),
    hero: resolveColor(look.hero.bg, theme),
    heroInk: resolveColor(look.hero.ink, theme),
    accents: (['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((s) => theme.colors[s]),
    major: theme.fonts.major,
    minor: theme.fonts.minor
  };
}
