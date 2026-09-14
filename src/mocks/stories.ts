import type { Story } from '@/features/stories/types';

import { hoursAgo, samplePerson } from './people';

export const SAMPLE_STORIES: readonly Story[] = [
  {
    id: 'st-1',
    author: samplePerson(0),
    slides: [
      {
        id: 'st-1a',
        cover: 'cover-1',
        text: 'Meetup this Saturday 🎤 4 talks, free coffee',
        createdAt: hoursAgo(2),
      },
      {
        id: 'st-1b',
        cover: 'cover-4',
        text: 'Slides are up. Link in the community.',
        createdAt: hoursAgo(1),
      },
    ],
    isSeen: false,
  },
  {
    id: 'st-2',
    author: samplePerson(4),
    slides: [
      {
        id: 'st-2a',
        cover: 'cover-2',
        text: 'khtok v2 just hit 1k stars ⭐ thank you',
        createdAt: hoursAgo(3),
      },
    ],
    isSeen: false,
  },
  {
    id: 'st-3',
    author: samplePerson(3),
    slides: [
      {
        id: 'st-3a',
        cover: 'cover-3',
        text: 'Redesigning the onboarding — before/after tomorrow',
        createdAt: hoursAgo(6),
      },
    ],
    isSeen: false,
  },
  {
    id: 'st-4',
    author: samplePerson(6),
    slides: [
      {
        id: 'st-4a',
        cover: 'cover-6',
        text: 'CI: 22 min → 6 min. Post is up.',
        createdAt: hoursAgo(8),
      },
    ],
    isSeen: true,
  },
  {
    id: 'st-5',
    author: samplePerson(7),
    slides: [
      {
        id: 'st-5a',
        cover: 'cover-5',
        text: 'shipit now does zero-downtime restarts 🚀',
        createdAt: hoursAgo(12),
      },
    ],
    isSeen: true,
  },
  {
    id: 'st-6',
    author: samplePerson(1),
    slides: [
      {
        id: 'st-6a',
        cover: 'cover-7',
        text: 'Server Components finally clicked. Thread in React Cambodia.',
        createdAt: hoursAgo(15),
      },
    ],
    isSeen: false,
  },
];
