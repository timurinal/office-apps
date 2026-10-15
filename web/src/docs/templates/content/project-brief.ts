import { bold, bullets, checklist, h2, p, table, title } from '../build';
import type { DocsTemplate } from '../types';

export const projectBrief: DocsTemplate = {
  slug: 'project-brief',
  title: 'Project brief',
  description: 'Goal, scope, milestones and risks on one page.',
  body: [
    title('Project brief'),
    table([[bold('Owner'), ''], [bold('Status'), 'Draft'], [bold('Start'), ''], [bold('Due'), '']], { header: false, widths: [140] }),
    h2('Goal'),
    p('What this project changes, in a sentence or two.'),
    h2('Scope'),
    bullets([bold('In: '), 'What the project covers'], [bold('Out: '), 'What it leaves alone']),
    h2('Milestones'),
    table([
      ['Milestone', 'Owner', 'Due'],
      ['', '', ''],
      ['', '', ''],
      ['', '', '']
    ]),
    h2('Risks'),
    bullets('What could go wrong, and what we will do about it'),
    h2('Next steps'),
    checklist('Book the kick-off', 'Confirm the owner'),
    p()
  ]
};
