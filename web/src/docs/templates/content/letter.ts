import { inFont, line, p, para } from '../build';
import type { DocsTemplate } from '../types';

const right = { paraStyle: 'nospacing', textAlign: 'right' } as const;

export const letter: DocsTemplate = {
  slug: 'letter',
  title: 'Letter',
  description: 'Sender, date, recipient and a salutation.',
  body: inFont(
    [
      para(right, 'Your name'),
      para(right, 'Street address'),
      para(right, 'Town and postcode'),
      para({ ...right, spaceBefore: 18 }, 'Date'),
      para({ paraStyle: 'nospacing', spaceBefore: 18 }, 'Recipient name'),
      line('Organisation'),
      line('Street address'),
      line('Town and postcode'),
      para({ spaceBefore: 18 }, 'Dear Name,'),
      p('Say why you are writing in the first sentence. Keep the rest to what the reader needs in order to act.'),
      p('Thank you for your time.'),
      p('Yours sincerely,'),
      para({ spaceBefore: 30 }, 'Your name')
    ],
    'Georgia'
  )
};
