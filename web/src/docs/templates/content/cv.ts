import { bold, bullets, h2, line, p, para, quiet, title } from '../build';
import type { DocsTemplate } from '../types';

/** A role: its title and where, then its dates, set 6pt below what is above. */
const role = (name: string, where: string) => [
  para({ paraStyle: 'nospacing', spaceBefore: 6 }, bold(name), ` · ${where}`),
  line(quiet('Month year – Month year'))
];

export const cv: DocsTemplate = {
  slug: 'cv',
  title: 'CV',
  description: 'Profile, experience, education and skills.',
  body: [
    title('Your name'),
    line(quiet('Job title · name@example.com · Phone · City', 10.5)),
    h2('Profile'),
    p('Two or three sentences on what you do and what you are looking for.'),
    h2('Experience'),
    ...role('Job title', 'Company'),
    bullets('What you changed, and by how much', 'What you led or shipped'),
    ...role('Job title', 'Company'),
    bullets('What you changed, and by how much'),
    h2('Education'),
    ...role('Degree', 'Institution'),
    h2('Skills'),
    p('Skill · Skill · Skill · Skill'),
    p()
  ],
  page: { margins: { top: 16, right: 18, bottom: 16, left: 18 } }
};
