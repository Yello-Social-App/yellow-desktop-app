import { create } from 'zustand';

import { SAMPLE_COMMUNITIES, SAMPLE_COMMUNITY_POSTS } from '@/mocks/communities';

import type { Community, CommunityPost } from './types';

interface CommunitiesState {
  communities: Community[];
  posts: CommunityPost[];
  toggleJoin: (slug: string) => void;
  vote: (postId: string, direction: -1 | 1) => void;
  publish: (
    post: Pick<CommunityPost, 'communitySlug' | 'title' | 'body' | 'tag' | 'author'>,
  ) => void;
}

/** In-memory for the session; seeded from the sample data. */
export const useCommunitiesStore = create<CommunitiesState>((set) => ({
  communities: [...SAMPLE_COMMUNITIES],
  posts: [...SAMPLE_COMMUNITY_POSTS],

  toggleJoin: (slug) => {
    set((state) => ({
      communities: state.communities.map((c) =>
        c.slug === slug
          ? { ...c, isJoined: !c.isJoined, members: c.members + (c.isJoined ? -1 : 1) }
          : c,
      ),
    }));
  },

  // Voting the same way again clears it; the other way flips it.
  vote: (postId, direction) => {
    set((state) => ({
      posts: state.posts.map((post) => {
        if (post.id !== postId) {
          return post;
        }
        const next = post.viewerVote === direction ? 0 : direction;
        return { ...post, viewerVote: next, score: post.score - post.viewerVote + next };
      }),
    }));
  },

  publish: (draft) => {
    set((state) => ({
      posts: [
        {
          ...draft,
          id: `cp-local-${Date.now().toString(36)}`,
          score: 1,
          commentCount: 0,
          createdAt: new Date().toISOString(),
          viewerVote: 1,
        },
        ...state.posts,
      ],
    }));
  },
}));
