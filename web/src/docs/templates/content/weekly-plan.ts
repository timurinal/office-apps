import { bold, checklist, h2, p, table, title } from '../build';
import type { DocsTemplate } from '../types';

const blank = ['', '', '', '', ''];

export const weeklyPlan: DocsTemplate = {
  slug: 'weekly-plan',
  title: 'Weekly plan',
  description: 'Priorities and a week on one landscape page.',
  body: [
    title('Weekly plan'),
    p(bold('Week of  ')),
    h2('Priorities'),
    checklist('The most important thing', 'The second thing', 'The third thing'),
    h2('Schedule'),
    table(
      [
        ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        [bold('Morning'), ...blank],
        [bold('Afternoon'), ...blank],
        [bold('Evening'), ...blank]
      ],
      { widths: [110] }
    ),
    h2('Notes'),
    p()
  ],
  page: { orientation: 'landscape', margins: { top: 16, right: 18, bottom: 16, left: 18 } }
};
