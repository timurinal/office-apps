import { bold, bullets, checklist, h2, numbered, p, table, title } from '../build';
import type { DocsTemplate } from '../types';

export const meetingNotes: DocsTemplate = {
  slug: 'meeting-notes',
  title: 'Meeting notes',
  description: 'Agenda, notes, decisions and actions.',
  body: [
    title('Meeting notes'),
    table([[bold('Date'), ''], [bold('Attendees'), ''], [bold('Facilitator'), '']], { header: false, widths: [140] }),
    h2('Agenda'),
    numbered('Review last week’s actions', 'Updates', 'Open questions'),
    h2('Notes'),
    p(),
    h2('Decisions'),
    bullets('What was decided, and by whom'),
    h2('Actions'),
    checklist('Action, owner, due date', 'Action, owner, due date'),
    p()
  ]
};
