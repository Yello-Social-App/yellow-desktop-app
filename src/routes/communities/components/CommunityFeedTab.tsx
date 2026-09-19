import { useCommunityPostFeed } from '@/features/communities/hooks';

import { PostFeed } from './PostFeed';

/** Home's Communities tab: hot posts from the communities the viewer joined. */
export function CommunityFeedTab() {
  const feed = useCommunityPostFeed('joined', 'hot');

  return (
    <PostFeed
      feed={feed}
      empty={
        <p className="text-on-surface-variant py-10 text-center text-[14px]">
          Join a community to see its posts here.
        </p>
      }
    />
  );
}
