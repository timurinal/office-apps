/**
 * HTML, parsed without a DOM.
 *
 * `DOMParser` does not exist in a worker, and the converters must run in one (and in the
 * a server-side exporter). So this is a small tolerant tokenizer and tree builder
 * for the HTML people actually have: Word's "save as web page", a copied article, a page
 * saved from a browser, this editor's own export. It is not the HTML5 algorithm. It does
 * not need to be: what comes out of it is walked by the reader, which keeps only an
 * allowlist of elements and a few checked properties, and rebuilds everything else.
 *
 * What it does:
 *   · comments, the doctype, processing instructions and CDATA are skipped;
 *   · `script`, `style` and their kin are removed with their contents, and `title`'s text is kept;
 *   · attributes are read as names and values (quoted either way, or bare); names are lowercased;
 *   · void elements close themselves; `p`, `li`, `td`, `th`, `tr` and the table sections close
 *     their predecessors as a browser would; a stray end tag closes nothing;
 *   · character references are decoded: the numeric forms and the named ones in common use.
 *     A name not in the table is left as the text it was written as.
 *
 * Nothing is fetched and nothing is executed. Depth and size are bounded.
 */

import { MAX_XML_DEPTH } from '../limits';

export interface HNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HNode | string)[];
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Elements whose contents are not markup. */
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript']);

/** Elements dropped along with everything in them. */
const DROP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'audio', 'video', 'head']);

/** A start tag for one of these ends an open `<p>`. */
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', bull: '•', middot: '·', laquo: '«', raquo: '»', deg: '°', plusmn: '±',
  times: '×', divide: '÷', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', lArr: '⇐', rArr: '⇒', hArr: '⇔', minus: '−', ne: '≠', le: '≤', ge: '≥', asymp: '≈', infin: '∞',
  frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²', sup3: '³', micro: 'µ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', pi: 'π', sigma: 'σ',
  omega: 'ω', Omega: 'Ω', lambda: 'λ', mu: 'μ', theta: 'θ', ensp: ' ', emsp: ' ', thinsp: ' ', zwj: '‍', zwnj: '‌', shy: '­',
  iexcl: '¡', iquest: '¿', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è',
  eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Auml: 'Ä',
  Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ouml: 'Ö', Uuml: 'Ü', Ntilde: 'Ñ', check: '✓', hearts: '♥'
};

/** `&amp;`, `&#38;`, `&#x26;` and the names in the table. Anything else is left as written. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});?/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      // Control characters and surrogates are not text; U+0000 is the replacement character.
      if (!Number.isFinite(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) return '';
      return String.fromCodePoint(code);
    }
    // Without the semicolon only the oldest names are references.
    if (!whole.endsWith(';') && !['amp', 'lt', 'gt', 'quot', 'nbsp', 'copy', 'reg'].includes(ref)) return whole;
    return ENTITIES[ref] ?? ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

interface Parsed {
  root: HNode;
  title: string | null;
}

const NAME = /[a-z][a-z0-9:-]*/iy;

export function parseHtml(source: string): Parsed {
  const input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const root: HNode = { tag: '#root', attrs: {}, children: [] };
  const stack: HNode[] = [root];
  let title: string | null = null;
  let dropDepth = 0;
  const top = (): HNode => stack[stack.length - 1]!;

  const pushText = (t: string) => {
    if (dropDepth > 0 || t === '') return;
    const parent = top();
    const last = parent.children[parent.children.length - 1];
    if (typeof last === 'string') parent.children[parent.children.length - 1] = last + t;
    else parent.children.push(t);
  };

  /** Pop up to and including the nearest open `tag`, if there is one below `limit`. */
  const closeTo = (tag: string, stopAt?: ReadonlySet<string>): boolean => {
    for (let i = stack.length - 1; i > 0; i--) {
      const t = stack[i]!.tag;
      if (t === tag) {
        stack.length = i;
        return true;
      }
      if (stopAt?.has(t)) return false;
    }
    return false;
  };
  const SCOPE_LIST = new Set(['ul', 'ol', 'table', 'td', 'th', 'blockquote']);
  const SCOPE_TABLE = new Set(['table']);
  const SCOPE_ROW = new Set(['table', 'tr']);

  const open = (tag: string, attrs: Record<string, string>, selfClosed: boolean) => {
    if (DROP.has(tag)) {
      if (!VOID.has(tag) && !selfClosed) dropDepth++;
      return;
    }
    if (dropDepth > 0) return;
    // Implied end tags, as a browser's parser would apply them.
    if (CLOSES_P.has(tag)) closeTo('p', new Set(['table', 'td', 'th', 'blockquote', 'li']));
    if (tag === 'li') closeTo('li', SCOPE_LIST);
    else if (tag === 'td' || tag === 'th') {
      closeTo('td', SCOPE_ROW);
      closeTo('th', SCOPE_ROW);
    } else if (tag === 'tr') {
      closeTo('td', SCOPE_TABLE);
      closeTo('th', SCOPE_TABLE);
      closeTo('tr', SCOPE_TABLE);
    } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      closeTo('td', SCOPE_TABLE);
      closeTo('th', SCOPE_TABLE);
      closeTo('tr', SCOPE_TABLE);
      closeTo('thead', SCOPE_TABLE);
      closeTo('tbody', SCOPE_TABLE);
      closeTo('tfoot', SCOPE_TABLE);
    } else if (tag === 'dt' || tag === 'dd') {
      closeTo('dt', new Set(['dl']));
      closeTo('dd', new Set(['dl']));
    }
    const node: HNode = { tag, attrs, children: [] };
    top().children.push(node);
    if (!VOID.has(tag) && !selfClosed && stack.length < MAX_XML_DEPTH) stack.push(node);
  };

  let i = 0;
  const n = input.length;
  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt < 0) {
      pushText(decodeEntities(input.slice(i)));
      break;
    }
    if (lt > i) pushText(decodeEntities(input.slice(i, lt)));
    i = lt;

    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', i)) {
      const end = input.indexOf(']]>', i + 9);
      pushText(input.slice(i + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (input[i + 1] === '!' || input[i + 1] === '?') {
      const end = input.indexOf('>', i + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }

    // An end tag.
    if (input[i + 1] === '/') {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(input);
      const end = input.indexOf('>', i + 2);
      if (!m) {
        // "</ >" and "</3": text, as a browser would have it.
        pushText('<');
        i += 1;
        continue;
      }
      const tag = m[0].toLowerCase();
      i = end < 0 ? n : end + 1;
      if (DROP.has(tag)) {
        if (dropDepth > 0) dropDepth--;
      } else if (dropDepth === 0) closeTo(tag);
      continue;
    }

    // A start tag.
    NAME.lastIndex = i + 1;
    const m = NAME.exec(input);
    if (!m) {
      pushText('<');
      i += 1;
      continue;
    }
    const tag = m[0].toLowerCase();
    let j = i + 1 + m[0].length;
    const attrs: Record<string, string> = {};
    let selfClosed = false;
    // Attributes, up to the closing `>` that is not inside quotes.
    for (;;) {
      while (j < n && /\s/.test(input[j]!)) j++;
      if (j >= n) break;
      const c = input[j]!;
      if (c === '>') {
        j++;
        break;
      }
      if (c === '/') {
        selfClosed = input[j + 1] === '>';
        j++;
        continue;
      }
      const start = j;
      while (j < n && !/[\s=>/]/.test(input[j]!)) j++;
      const name = input.slice(start, j).toLowerCase();
      while (j < n && /\s/.test(input[j]!)) j++;
      let value = '';
      if (input[j] === '=') {
        j++;
        while (j < n && /\s/.test(input[j]!)) j++;
        const q = input[j];
        if (q === '"' || q === "'") {
          const end = input.indexOf(q, j + 1);
          value = input.slice(j + 1, end < 0 ? n : end);
          j = end < 0 ? n : end + 1;
        } else {
          const s2 = j;
          while (j < n && !/[\s>]/.test(input[j]!)) j++;
          value = input.slice(s2, j);
        }
      }
      if (name && !(name in attrs)) attrs[name] = decodeEntities(value);
      if (j === start) j++;
    }
    i = j;

    if (RAW.has(tag) && !selfClosed) {
      // Everything up to the matching end tag is text and not markup.
      const close = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = input.slice(i);
      const m2 = close.exec(rest);
      const body = m2 ? rest.slice(0, m2.index) : rest;
      i += m2 ? m2.index + m2[0].length : rest.length;
      if (tag === 'title' && title === null) title = decodeEntities(body).replace(/\s+/g, ' ').trim() || null;
      else if (tag === 'textarea' && dropDepth === 0) pushText(decodeEntities(body));
      continue;
    }
    open(tag, attrs, selfClosed);
  }
  return { root, title };
}

// ── walking ─────────────────────────────────────────────────────────────────

export const isNode = (c: HNode | string): c is HNode => typeof c !== 'string';

export const elementsOf = (n: HNode): HNode[] => n.children.filter(isNode);

export function findFirst(n: HNode, tag: string): HNode | null {
  for (const c of elementsOf(n)) {
    if (c.tag === tag) return c;
    const f = findFirst(c, tag);
    if (f) return f;
  }
  return null;
}

export function textOfNode(n: HNode | string): string {
  return typeof n === 'string' ? n : n.children.map(textOfNode).join('');
}

/** A `style` attribute as lowercase property to value. Values are only ever compared and parsed, never written back. */
export function parseStyle(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const k = decl.slice(0, colon).trim().toLowerCase();
    const v = decl.slice(colon + 1).trim();
    if (k && v && v.length < 400) out[k] = v;
  }
  return out;
}
