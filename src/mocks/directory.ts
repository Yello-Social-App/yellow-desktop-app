import type { DirectoryPerson } from '@/features/people/types';

import { hoursAgo, samplePerson } from './people';

const sokchea = samplePerson(0);
const dara = samplePerson(1);
const piseth = samplePerson(3);
const kanha = samplePerson(4);
const rithy = samplePerson(5);
const mealea = samplePerson(6);
const bora = samplePerson(7);

/**
 * Everyone the sample search can find. Sample person 2 (Vanna) is left out:
 * the other sample surfaces use that name for the viewer.
 */
export const SAMPLE_DIRECTORY: readonly DirectoryPerson[] = [
  {
    user: dara,
    friendStatus: 'FRIENDS',
    mutualFriends: [],
    isSuggested: false,
    since: hoursAgo(24 * 190),
  },
  {
    user: sokchea,
    friendStatus: 'FRIENDS',
    mutualFriends: [],
    isSuggested: false,
    since: hoursAgo(24 * 420),
  },
  {
    user: {
      id: 'sample-sodara',
      username: 'sodara.m',
      fullName: 'Sodara Meas',
      avatarUrl: undefined,
    },
    friendStatus: 'REQUEST_RECEIVED',
    mutualFriends: [dara],
    isSuggested: false,
    since: hoursAgo(5),
  },
  {
    user: kanha,
    friendStatus: 'NONE',
    mutualFriends: [dara, sokchea, piseth],
    isSuggested: true,
  },
  {
    user: mealea,
    friendStatus: 'NONE',
    mutualFriends: [dara, bora],
    isSuggested: true,
  },
  {
    user: piseth,
    friendStatus: 'NONE',
    mutualFriends: [sokchea, kanha],
    isSuggested: true,
  },
  {
    user: rithy,
    friendStatus: 'NONE',
    mutualFriends: [sokchea],
    isSuggested: true,
  },
  {
    user: bora,
    friendStatus: 'NONE',
    mutualFriends: [],
    sharedCommunitySlug: 'khmercoders',
    isSuggested: true,
  },
  {
    user: {
      id: 'sample-sreyneang',
      username: 'sreyneang',
      fullName: 'Sreyneang Tan',
      avatarUrl: undefined,
    },
    friendStatus: 'NONE',
    mutualFriends: [],
    sharedCommunitySlug: 'laravel-kh',
    isSuggested: true,
  },
  {
    user: {
      id: 'sample-visal',
      username: 'visal.dev',
      fullName: 'Visal Prak',
      avatarUrl: undefined,
    },
    friendStatus: 'NONE',
    mutualFriends: [],
    sharedCommunitySlug: 'khmercoders',
    isSuggested: true,
  },
  {
    user: {
      id: 'sample-dararith',
      username: 'dararith',
      fullName: 'Dararith Pov',
      avatarUrl: undefined,
    },
    friendStatus: 'NONE',
    mutualFriends: [dara, sokchea, kanha, piseth, mealea, bora],
    isSuggested: false,
  },
  {
    user: {
      id: 'sample-chandara',
      username: 'chandara',
      fullName: 'Chandara Ly',
      avatarUrl: undefined,
    },
    friendStatus: 'REQUEST_SENT',
    mutualFriends: [dara],
    isSuggested: false,
    since: hoursAgo(30),
  },
  {
    user: {
      id: 'sample-dany',
      username: 'dany.design',
      fullName: 'Dany Sam',
      avatarUrl: undefined,
    },
    friendStatus: 'NONE',
    mutualFriends: [],
    isSuggested: false,
  },
];
