import { bold, chart, heading, list, makeDeck, para, plain, table } from '../build';
import type { SlideSpec } from '../build';
import type { SlidesTemplate } from '../types';

const t = (text: string) => heading(text, false);

export const quarterlyReport: SlidesTemplate = {
  slug: 'quarterly-report',
  title: 'Quarterly report',
  description: 'Results, a table and a chart for the quarter.',
  cover: 2,
  deck: () =>
    makeDeck('harbour', 'Northwind Studio · Q3 report', (theme): SlideSpec[] => [
      {
        layout: 'title',
        text: { ctrTitle: t('Q3 report.'), 'subTitle:1': 'Northwind Studio · July to September' },
        notes: ['The figures in this deck are samples. Replace each one with yours before you present.']
      },
      {
        layout: 'bigNumber',
        text: {
          title: t('Q3 at a glance.'),
          'body:1': list('Four teams published courses', 'Every course went through review', 'Completion held above 70%'),
          'subTitle:2': list('34', ['courses published', 1])
        }
      },
      {
        layout: 'titleOnly',
        text: { title: t('Courses by month.') },
        extra: [
          chart(
            { x: 154, y: 368, w: 1040, h: 560 },
            {
              chart: 'column',
              categories: ['July', 'August', 'September'],
              series: [
                { name: 'Published', values: [9, 11, 14] },
                { name: 'In review', values: [4, 6, 5] }
              ]
            },
            'Courses by month',
            'Column chart of courses published and in review each month. Published: 9 in July, 11 in August, 14 in September. In review: 4, 6 and 5.'
          ),
          {
            type: 'shape',
            shape: 'rect',
            x: 1254,
            y: 368,
            w: 512,
            h: 560,
            name: 'Takeaway',
            fill: { kind: 'none' },
            text: { type: 'doc', content: [plain(bold('Best month')), para('September, with 14 published.', { bullet: { kind: 'none' }, spaceBefore: 6 })] },
            textBox: { anchor: 'top', insets: { l: 0, t: 0, r: 0, b: 0 }, autofit: 'shrink', wrap: true }
          }
        ],
        notes: ['Replace the sample figures with your own before you present.']
      },
      {
        layout: 'titleOnly',
        text: { title: t('By team.') },
        extra: [
          table(theme, { x: 154, y: 368, w: 1612, h: 0 }, [592, 340, 340, 340], [
            ['Team', 'Courses', 'Learners', 'Completed'],
            ['Product', '12', '140', '82%'],
            ['Support', '9', '96', '76%'],
            ['Sales', '8', '88', '71%'],
            ['People', '5', '52', '90%']
          ], { align: ['left', 'right', 'right', 'right'] })
        ]
      },
      {
        layout: 'comparison',
        text: {
          title: t('What changed.'),
          'subTitle:1': 'Went well',
          'body:2': list('Review got faster', 'More teams published', 'Completion stayed high'),
          'subTitle:3': 'Did not go to plan',
          'body:4': list('Onboarding slipped two weeks', 'Reports are still made by hand')
        }
      },
      {
        layout: 'titleContent',
        text: {
          title: t('Next quarter.'),
          'body:1': list('Launch the library to every team', 'Automate the Monday report', 'Plan translations')
        }
      }
    ])
};
