/**
 * The special characters dialog's list: the ones people reach for, in groups, each with a
 * name. The name is what the search matches and what the dialog says under the pointer.
 *
 * Not the whole of Unicode. A document that needs a rare character pastes it, and a list of
 * a thousand is a list nobody searches.
 */

export interface CharEntry {
  ch: string;
  name: string;
}

export interface CharGroup {
  id: string;
  label: string;
  chars: CharEntry[];
}

const e = (ch: string, name: string): CharEntry => ({ ch, name });

export const CHAR_GROUPS: readonly CharGroup[] = [
  {
    id: 'common',
    label: 'Common',
    chars: [
      e('©', 'Copyright'), e('®', 'Registered trademark'), e('™', 'Trademark'), e('§', 'Section'), e('¶', 'Paragraph'),
      e('†', 'Dagger'), e('‡', 'Double dagger'), e('•', 'Bullet'), e('‣', 'Triangular bullet'), e('…', 'Ellipsis'),
      e('–', 'En dash'), e('—', 'Em dash'), e('‘', 'Left single quote'), e('’', 'Right single quote'), e('“', 'Left double quote'),
      e('”', 'Right double quote'), e('«', 'Left guillemet'), e('»', 'Right guillemet'), e('¡', 'Inverted exclamation mark'), e('¿', 'Inverted question mark'),
      e('°', 'Degree'), e('′', 'Prime'), e('″', 'Double prime'), e('№', 'Numero'), e('·', 'Middle dot'),
      e(' ', 'Non-breaking space'), e('‰', 'Per mille'), e('µ', 'Micro')
    ]
  },
  {
    id: 'maths',
    label: 'Maths',
    chars: [
      e('±', 'Plus or minus'), e('×', 'Multiplication'), e('÷', 'Division'), e('≠', 'Not equal'), e('≈', 'Approximately equal'),
      e('≤', 'Less than or equal'), e('≥', 'Greater than or equal'), e('∞', 'Infinity'), e('√', 'Square root'), e('∑', 'Sum'),
      e('∏', 'Product'), e('∫', 'Integral'), e('∂', 'Partial differential'), e('∆', 'Increment'), e('π', 'Pi'),
      e('¼', 'One quarter'), e('½', 'One half'), e('¾', 'Three quarters'), e('²', 'Squared'), e('³', 'Cubed'),
      e('⁰', 'Superscript zero'), e('∈', 'Element of'), e('∉', 'Not an element of'), e('∩', 'Intersection'), e('∪', 'Union'),
      e('⊂', 'Subset'), e('⊃', 'Superset'), e('∴', 'Therefore'), e('∵', 'Because'), e('¬', 'Not'),
      e('∧', 'And'), e('∨', 'Or'), e('∀', 'For all'), e('∃', 'There exists'), e('∅', 'Empty set')
    ]
  },
  {
    id: 'arrows',
    label: 'Arrows',
    chars: [
      e('←', 'Left arrow'), e('↑', 'Up arrow'), e('→', 'Right arrow'), e('↓', 'Down arrow'), e('↔', 'Left right arrow'),
      e('↕', 'Up down arrow'), e('⇐', 'Left double arrow'), e('⇑', 'Up double arrow'), e('⇒', 'Right double arrow'), e('⇓', 'Down double arrow'),
      e('⇔', 'Left right double arrow'), e('↩', 'Return arrow'), e('↪', 'Hooked right arrow'), e('↵', 'Enter arrow'), e('➜', 'Heavy right arrow'),
      e('➤', 'Arrowhead')
    ]
  },
  {
    id: 'currency',
    label: 'Currency',
    chars: [
      e('€', 'Euro'), e('£', 'Pound'), e('¥', 'Yen'), e('¢', 'Cent'), e('₹', 'Indian rupee'),
      e('₩', 'Won'), e('₽', 'Rouble'), e('₺', 'Turkish lira'), e('₪', 'Shekel'), e('₫', 'Dong'),
      e('฿', 'Baht'), e('₿', 'Bitcoin'), e('¤', 'Currency')
    ]
  },
  {
    id: 'letters',
    label: 'Letters',
    chars: [
      e('á', 'a acute'), e('à', 'a grave'), e('â', 'a circumflex'), e('ä', 'a diaeresis'), e('ã', 'a tilde'),
      e('å', 'a ring'), e('æ', 'ae'), e('ç', 'c cedilla'), e('é', 'e acute'), e('è', 'e grave'),
      e('ê', 'e circumflex'), e('ë', 'e diaeresis'), e('í', 'i acute'), e('ì', 'i grave'), e('î', 'i circumflex'),
      e('ï', 'i diaeresis'), e('ñ', 'n tilde'), e('ó', 'o acute'), e('ò', 'o grave'), e('ô', 'o circumflex'),
      e('ö', 'o diaeresis'), e('õ', 'o tilde'), e('ø', 'o slash'), e('œ', 'oe'), e('ß', 'Sharp s'),
      e('ú', 'u acute'), e('ù', 'u grave'), e('û', 'u circumflex'), e('ü', 'u diaeresis'), e('ý', 'y acute'),
      e('ÿ', 'y diaeresis'), e('Á', 'A acute'), e('É', 'E acute'), e('Ö', 'O diaeresis'), e('Ü', 'U diaeresis'),
      e('Ç', 'C cedilla'), e('Ñ', 'N tilde'), e('Æ', 'AE'), e('Ø', 'O slash'), e('Å', 'A ring')
    ]
  },
  {
    id: 'greek',
    label: 'Greek',
    chars: [
      e('α', 'alpha'), e('β', 'beta'), e('γ', 'gamma'), e('δ', 'delta'), e('ε', 'epsilon'),
      e('ζ', 'zeta'), e('η', 'eta'), e('θ', 'theta'), e('λ', 'lambda'), e('μ', 'mu'),
      e('ν', 'nu'), e('ξ', 'xi'), e('ρ', 'rho'), e('σ', 'sigma'), e('τ', 'tau'),
      e('φ', 'phi'), e('χ', 'chi'), e('ψ', 'psi'), e('ω', 'omega'), e('Γ', 'Gamma'),
      e('Δ', 'Delta'), e('Θ', 'Theta'), e('Λ', 'Lambda'), e('Ξ', 'Xi'), e('Π', 'Pi'),
      e('Σ', 'Sigma'), e('Φ', 'Phi'), e('Ψ', 'Psi'), e('Ω', 'Omega')
    ]
  },
  {
    id: 'symbols',
    label: 'Symbols',
    chars: [
      e('✓', 'Check mark'), e('✗', 'Ballot x'), e('★', 'Black star'), e('☆', 'White star'), e('♠', 'Spade'),
      e('♣', 'Club'), e('♥', 'Heart'), e('♦', 'Diamond'), e('♪', 'Musical note'), e('☺', 'Smiling face'),
      e('✉', 'Envelope'), e('☎', 'Telephone'), e('⚠', 'Warning'), e('☀', 'Sun'), e('☁', 'Cloud'),
      e('❤', 'Heavy heart'), e('✂', 'Scissors'), e('✎', 'Pencil'), e('⌘', 'Command'), e('⌥', 'Option'),
      e('⇧', 'Shift'), e('⏎', 'Return')
    ]
  }
];

/** Every group's characters, for the "All" view and the search. */
export const ALL_CHARS: readonly CharEntry[] = CHAR_GROUPS.flatMap((g) => g.chars);

/** What matches `query`: the character itself, or any word of its name starting with it. */
export function searchChars(query: string, group: string | 'all' = 'all'): CharEntry[] {
  const q = query.trim().toLowerCase();
  const pool = group === 'all' ? ALL_CHARS : (CHAR_GROUPS.find((g) => g.id === group)?.chars ?? []);
  const seen = new Set<string>();
  const out = pool.filter((c) => !seen.has(c.ch) && seen.add(c.ch));
  if (!q) return out;
  return out.filter((c) => c.ch === query.trim() || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || c.name.toLowerCase().includes(q));
}
