import { heading, list, makeDeck, table } from '../build';
import type { SlideSpec } from '../build';
import type { SlidesTemplate } from '../types';

const t = (text: string) => heading(text, false);

export const workshop: SlidesTemplate = {
  slug: 'workshop',
  title: 'Workshop agenda',
  description: 'A timed agenda, ground rules and what happens next.',
  cover: 1,
  deck: () =>
    makeDeck('ember', 'Northwind Studio · Planning workshop', (theme): SlideSpec[] => [
      {
        layout: 'title',
        text: { ctrTitle: t('Planning workshop.'), 'subTitle:1': 'Northwind Studio · Half a day' }
      },
      {
        layout: 'titleOnly',
        text: { title: t('Agenda.') },
        extra: [
          table(theme, { x: 154, y: 368, w: 1612, h: 0 }, [260, 900, 452], [
            ['Time', 'Session', 'Lead'],
            ['09:00', 'Welcome and goals', 'Maya'],
            ['09:20', 'Where we are', 'Dev'],
            ['10:15', 'Break', ''],
            ['10:30', 'Table sessions', 'Everyone'],
            ['12:00', 'Share back and decide', 'Priya'],
            ['12:45', 'Next steps', 'Sam']
          ], { rowHeight: 68 })
        ],
        notes: ['Say when lunch is. People listen better once they know.']
      },
      {
        layout: 'comparison',
        text: {
          title: t('Ground rules.'),
          'subTitle:1': 'Do',
          'body:2': list('Say what you think', 'Keep to time', 'Write it on the wall'),
          'subTitle:3': 'Do not',
          'body:4': list('Talk over each other', 'Open laptops mid-session', 'Solve it all in the room')
        }
      },
      {
        layout: 'section',
        text: { title: t('Table sessions.'), 'body:1': 'Three tables, thirty minutes each.' }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('How each table works.'),
          'body:1': list('Pick a scribe and a timekeeper', 'Spend ten minutes on the problem', 'Spend twenty on the options', 'Leave with one page and one pick')
        },
        notes: ['Start the timer out loud. Walk between tables; do not sit at one.']
      },
      {
        layout: 'titleContent',
        text: {
          title: t('What happens next.'),
          'body:1': list('Notes go out by the end of the day', 'Each table owns one follow-up', 'We meet in two weeks to check progress')
        }
      }
    ])
};
