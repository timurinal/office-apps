import { heading, list, makeDeck, table } from '../build';
import type { SlideSpec } from '../build';
import type { SlidesTemplate } from '../types';

const t = (text: string) => heading(text, true);

export const kickoff: SlidesTemplate = {
  slug: 'kickoff',
  title: 'Project kick-off',
  description: 'What we ship, who owns it and when, in six slides.',
  // The slide the card draws: bullets beside a figure, as on the Slides board.
  cover: 1,
  deck: () =>
    makeDeck('violet', 'Northwind Studio · Q4 kick-off', (theme): SlideSpec[] => [
      {
        layout: 'title',
        text: { ctrTitle: t('Q4 kick-off.'), 'subTitle:1': 'Northwind Studio · Learning team' },
        notes: ['Welcome people, then say what the hour is for: agree what we ship in Q4 and who owns each piece.']
      },
      {
        layout: 'bigNumber',
        text: {
          title: t('What we ship in Q4.'),
          'body:1': list('The course library, for every team', 'Onboarding inside Learn', 'Completion reports each Monday', 'Forty courses on day one'),
          'subTitle:2': list('40', ['courses at launch', 1])
        },
        notes: ['Start with the forty. Everything else on this slide is how we get there. Pause for questions before milestones.']
      },
      {
        layout: 'titleContent',
        text: {
          title: t('Who owns what.'),
          'body:1': list('Maya: course library and review', 'Dev: onboarding inside Learn', 'Priya: completion reports', 'Sam: launch and support')
        }
      },
      {
        layout: 'comparison',
        text: {
          title: t('In and out of scope.'),
          'subTitle:1': 'In scope',
          'body:2': list('Forty launch courses', 'Onboarding inside Learn', 'Weekly completion reports'),
          'subTitle:3': 'Out of scope',
          'body:4': list('Custom branding for each team', 'A mobile app', 'Translations after launch')
        },
        notes: ['Be firm here. Anything on the right goes on the Q1 list.']
      },
      {
        layout: 'titleOnly',
        text: { title: t('Milestones.') },
        extra: [
          table(theme, { x: 154, y: 368, w: 1612, h: 0 }, [760, 400, 452], [
            ['Milestone', 'Owner', 'Due'],
            ['Course library reviewed', 'Maya', '28 Oct'],
            ['Onboarding in beta', 'Dev', '18 Nov'],
            ['Reports live', 'Priya', '2 Dec'],
            ['Launch', 'Sam', '15 Dec']
          ])
        ]
      },
      {
        layout: 'title',
        text: { ctrTitle: t('Let’s ship it.'), 'subTitle:1': 'First check-in on Monday.' }
      }
    ])
};
