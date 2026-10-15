import { bold, bullets, field, h2, p, para, quiet, quote, rule, subtitle, title } from '../build';
import type { DocsTemplate } from '../types';

const centred = { textAlign: 'center' } as const;

export const newsletter: DocsTemplate = {
  slug: 'newsletter',
  title: 'Newsletter',
  description: 'A masthead, the headline story, updates and what is coming up.',
  body: [
    title('Newsletter name', centred),
    subtitle('Issue 1 · Month year', centred),
    rule(),
    h2('In this issue'),
    bullets('The headline story', 'An update from the team', 'What is coming up'),
    h2('Headline story'),
    p('Open with the news in one sentence. Then say why it matters to the reader.'),
    p('Add the detail they need, and what they should do next.'),
    quote('A line from the story worth pulling out.'),
    h2('Updates'),
    bullets([bold('Update one. '), 'One sentence on what changed.'], [bold('Update two. '), 'One sentence on what changed.']),
    h2('Coming up'),
    bullets([bold('Date. '), 'The event, and where to find it']),
    rule(),
    para(centred, quiet('Send your news to the editor.'))
  ],
  // The masthead is the first page's header.
  page: { differentFirst: true },
  header: [para(centred, field('title'))],
  footer: [para(centred, field('page'))]
};
