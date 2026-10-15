import { heading, list, makeDeck } from '../build';
import type { SlideSpec } from '../build';
import type { SlidesTemplate } from '../types';

const t = (text: string) => heading(text, true);

export const pitch: SlidesTemplate = {
  slug: 'pitch',
  title: 'Pitch',
  description: 'The problem, the answer and the ask, in seven slides.',
  deck: () =>
    makeDeck('midnight', 'Northwind Learn', (): SlideSpec[] => [
      {
        layout: 'title',
        text: { ctrTitle: t('Northwind Learn.'), 'subTitle:1': 'Courses your team actually finishes.' }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('The problem.'),
          'body:1': list('Onboarding means weeks of shadowing', 'Training lives in slides nobody reopens', 'Nobody can say who finished what')
        },
        notes: ['Pick the one your audience has felt. Say it as a story, in one breath.']
      },
      {
        layout: 'bigNumber',
        text: {
          title: t('The answer.'),
          'body:1': list('Write a course in plain text', 'Review it with your team', 'Publish it where people already work'),
          'subTitle:2': list('3', ['steps from draft to learner', 1])
        }
      },
      {
        layout: 'comparison',
        text: {
          title: t('What changes.'),
          'subTitle:1': 'Today',
          'body:2': list('Slides emailed around', 'Progress in a spreadsheet', 'Updates made by hand'),
          'subTitle:3': 'With Northwind Learn',
          'body:4': list('One course, one link', 'Progress tracked for you', 'Update once, everyone sees it')
        }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('Who it is for.'),
          'body:1': list('Teams that train their own people', 'A named owner for training', 'No budget for a course factory')
        }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('The ask.'),
          'body:1': list('Two pilot teams this quarter', 'One owner on your side', 'A decision by the end of the month')
        },
        notes: ['Say the ask in one sentence, then stop talking.']
      },
      {
        layout: 'title',
        text: { ctrTitle: t('Thank you.'), 'subTitle:1': 'you@northwind.example' }
      }
    ])
};
