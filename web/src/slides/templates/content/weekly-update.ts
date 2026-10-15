import { heading, list, makeDeck, table } from '../build';
import type { SlideSpec } from '../build';
import type { SlidesTemplate } from '../types';

const t = (text: string) => heading(text, false);

export const weeklyUpdate: SlidesTemplate = {
  slug: 'weekly-update',
  title: 'Weekly update',
  description: 'Progress, what is done and next, status and what you need.',
  cover: 1,
  deck: () =>
    makeDeck('fern', 'Learning team · Week 42', (theme): SlideSpec[] => [
      {
        layout: 'title',
        text: { ctrTitle: t('Weekly update.'), 'subTitle:1': 'Learning team · Week 42' }
      },
      {
        layout: 'bigNumber',
        text: {
          title: t('Where we are.'),
          'body:1': list('Review is on track for 28 October', 'Onboarding beta starts in two weeks', 'Reports have a layout'),
          'subTitle:2': list('34', ['of 40 courses reviewed', 1])
        },
        notes: ['One number, then the three things behind it.']
      },
      {
        layout: 'comparison',
        text: {
          title: t('This week.'),
          'subTitle:1': 'Done',
          'body:2': list('Course library review finished', 'Onboarding draft shared with ten testers', 'Report layout agreed'),
          'subTitle:3': 'Next',
          'body:4': list('Fix the three review comments', 'Start the beta with two teams', 'Send the first report')
        }
      },
      {
        layout: 'titleOnly',
        text: { title: t('Status.') },
        extra: [
          table(theme, { x: 154, y: 368, w: 1612, h: 0 }, [520, 340, 752], [
            ['Project', 'Status', 'Note'],
            ['Course library', 'On track', '34 of 40 reviewed'],
            ['Onboarding', 'At risk', 'Waiting on tester feedback'],
            ['Reports', 'On track', 'Layout agreed'],
            ['Launch', 'Not started', 'Planning begins in week 45']
          ])
        ]
      },
      {
        layout: 'titleContent',
        text: {
          title: t('Help needed.'),
          'body:1': list('Two more testers for onboarding by Wednesday', 'A decision on the launch date', ['Either 8 or 15 December', 1])
        },
        notes: ['Ask for one thing per bullet, and name who you are asking.']
      }
    ])
};
