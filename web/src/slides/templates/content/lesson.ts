import { heading, list, makeDeck } from '../build';
import type { SlideSpec } from '../build';
import type { SlidesTemplate } from '../types';

const t = (text: string) => heading(text, false);

export const lesson: SlidesTemplate = {
  slug: 'lesson',
  title: 'Lesson',
  description: 'Aims, an explanation, an exercise and a recap.',
  cover: 2,
  deck: () =>
    makeDeck('paper', 'Reading a bar chart', (): SlideSpec[] => [
      {
        layout: 'title',
        text: { ctrTitle: t('Reading a bar chart.'), 'subTitle:1': 'Lesson 3 · 20 minutes' }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('By the end you will.'),
          'body:1': list('Read the axes before the bars', 'Compare two bars fairly', 'Spot a chart that misleads')
        },
        notes: ['Read these aloud, and say you will come back to them at the end.']
      },
      {
        layout: 'section',
        text: { title: t('Start with the axes.'), 'body:1': 'What is measured, and in what units.' }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('Axes first.'),
          'body:1': list(
            'The vertical axis says what is counted',
            'The horizontal axis says what is compared',
            'Check where the vertical axis starts',
            ['A chart that starts above zero exaggerates every gap', 1]
          )
        }
      },
      {
        layout: 'quote',
        text: { 'body:1': 'Tell it once, then let them try.', 'subTitle:2': 'The rule for this lesson' }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('Try it.'),
          'body:1': list('Open the chart on your desk', 'Write what each axis measures', 'Find the bar that looks too tall', 'Compare notes with a neighbour')
        },
        notes: ['Give them five minutes. Walk round and ask questions; do not lead.']
      },
      {
        layout: 'bigNumber',
        text: {
          title: t('Recap.'),
          'body:1': list('Axes first, bars second', 'Start at zero, or say you did not', 'Compare like with like'),
          'subTitle:2': list('3', ['things to remember', 1])
        }
      }
    ])
};
