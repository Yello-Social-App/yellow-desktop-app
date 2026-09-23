/**
 * Story operations, as seen by the renderer: one allowlisted IPC call each,
 * and the one place a story refusal is turned into words.
 */
import type {
  CreateStoryRequest,
  IpcError,
  StagedImage,
  Story,
  StoryFeedPage,
  StoryPage,
  StoryReplyAccepted,
  StoryType,
  StoryViewerPage,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import { STORY_ARCHIVE_PAGE_SIZE, STORY_FEED_PAGE_SIZE, STORY_VIEWERS_PAGE_SIZE } from './types';

export type StoriesError = IpcError;

/** The API's code for a story that is missing, expired, hidden or behind a block. */
export const STORY_NOT_FOUND = 'RESOURCE_NOT_FOUND';

/**
 * What to tell the user. Branches on the API's code, never its message; a
 * field error is the most specific thing the server said, so it goes first.
 */
export function storyErrorMessage(error: IpcError): string {
  const fieldMessage = Object.values(error.fieldErrors ?? {})
    .flat()
    .find((message) => message !== '');
  if (fieldMessage !== undefined) {
    return fieldMessage;
  }
  switch (error.apiCode) {
    case 'INVALID_IMAGE':
      return 'That photo couldn’t be used. Try a smaller JPEG or PNG, up to 16 megapixels.';
    case 'PAYLOAD_TOO_LARGE':
      return 'That photo is too large. Photos must be 5 MB or smaller.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'You’re doing that a lot. Wait a minute, then try again.';
    case STORY_NOT_FOUND:
      return 'This story isn’t available anymore.';
    case 'CANNOT_REPLY_TO_OWN_STORY':
      return 'You can’t reply to your own story.';
    default:
      return error.message;
  }
}

export async function fetchStoryFeed(page: number): Promise<Result<StoryFeedPage, StoriesError>> {
  const result = await ipc.storyFeed({ page, size: STORY_FEED_PAGE_SIZE });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchMyStories(): Promise<Result<Story[], StoriesError>> {
  const result = await ipc.myStories();
  return result.ok ? ok(result.data.stories) : fail(result.error);
}

export async function fetchUserStories(userId: string): Promise<Result<Story[], StoriesError>> {
  const result = await ipc.userStories({ userId });
  return result.ok ? ok(result.data.stories) : fail(result.error);
}

export async function fetchStory(storyId: string): Promise<Result<Story, StoriesError>> {
  const result = await ipc.getStory({ storyId });
  return result.ok ? ok(result.data.story) : fail(result.error);
}

export async function createStory(draft: CreateStoryRequest): Promise<Result<Story, StoriesError>> {
  const result = await ipc.createStory(draft);
  return result.ok ? ok(result.data.story) : fail(result.error);
}

export async function markStorySeen(storyId: string): Promise<Result<true, StoriesError>> {
  const result = await ipc.markStorySeen({ storyId });
  return result.ok ? ok(true) : fail(result.error);
}

export async function fetchStoryViewers(
  storyId: string,
  page: number,
): Promise<Result<StoryViewerPage, StoriesError>> {
  const result = await ipc.storyViewers({ storyId, page, size: STORY_VIEWERS_PAGE_SIZE });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchStoryArchive(
  type: StoryType | undefined,
  page: number,
): Promise<Result<StoryPage, StoriesError>> {
  const result = await ipc.storyArchive({
    page,
    size: STORY_ARCHIVE_PAGE_SIZE,
    ...(type === undefined ? {} : { type }),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function deleteStory(storyId: string): Promise<Result<true, StoriesError>> {
  const result = await ipc.deleteStory({ storyId });
  return result.ok ? ok(true) : fail(result.error);
}

export async function replyToStory(
  storyId: string,
  text: string,
  clientId: string,
): Promise<Result<StoryReplyAccepted, StoriesError>> {
  const result = await ipc.replyToStory({ storyId, text, clientId });
  return result.ok ? ok(result.data) : fail(result.error);
}

/**
 * Opens the OS picker for one story photo and stages it for preview. `null`
 * when the picker was dismissed, which is not an error.
 */
export async function stageStoryImage(): Promise<Result<StagedImage | null, StoriesError>> {
  const result = await ipc.stageImages({ purpose: 'story' });
  return result.ok ? ok(result.data.images[0] ?? null) : fail(result.error);
}

/** Frees a staged photo the user replaced, removed, or never posted. */
export async function discardStoryImage(token: string): Promise<void> {
  await ipc.discardImages({ tokens: [token] });
}
