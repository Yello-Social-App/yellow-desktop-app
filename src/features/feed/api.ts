/**
 * Feed and post operations, as seen by the renderer: one allowlisted IPC call
 * each.
 *
 * Reactions are addressed by `{targetType, targetId}` because the API attaches
 * them to comments as well as posts; the write helper here fixes the target
 * type so feed callers keep passing a post id and nothing more. The read
 * helpers take it, since the who-reacted sheet also opens on community posts.
 */
import type {
  FeedResponse,
  IpcError,
  Post,
  ReactionSummary,
  ReactionType,
  ReactorPage,
  SaveState,
  ShareLinkCopiedResponse,
  StagedImage,
  UpdatePostRequest,
} from '@shared/ipc-types';

import { ipc } from '@/lib/ipc';
import { fail, ok, type Result } from '@/lib/result';

import {
  FEED_PAGE_SIZE,
  PRIMARY_REACTION,
  REACTORS_PAGE_SIZE,
  type ComposePostInput,
  type PostTargetType,
} from './types';

export type FeedError = IpcError;

export async function fetchFeed(cursor?: string): Promise<Result<FeedResponse, FeedError>> {
  const result = await ipc.listFeed({
    size: FEED_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}

/** `imageTokens` are handles from `stageImages`, in the order they appear. */
export async function publishPost(
  input: ComposePostInput,
  imageTokens: readonly string[] = [],
): Promise<Result<Post, FeedError>> {
  const result = await ipc.createPost({
    content: input.content,
    visibility: input.visibility ?? 'PUBLIC',
    imageTokens: [...imageTokens],
  });
  return result.ok ? ok(result.data.post) : fail(result.error);
}

export interface StagedImages {
  images: StagedImage[];
  /** Files chosen but turned away because the post is already at the limit. */
  skipped: number;
}

/**
 * Opens the OS picker and stages what was chosen for preview. Resolves to an
 * empty list when the picker was dismissed, which is not an error.
 *
 * The per-post limit is enforced in the main process, which is the side that
 * knows what is staged — so everything that comes back here is attachable.
 * `limit` is how an editor says it has less room, because of the images the
 * post already carries.
 */
export async function stagePostImages(limit?: number): Promise<Result<StagedImages, FeedError>> {
  const result = await ipc.stageImages(limit === undefined ? undefined : { limit });
  return result.ok
    ? ok({ images: result.data.images, skipped: result.data.skipped })
    : fail(result.error);
}

/** Frees bytes the user removed from the composer, or never posted. */
export async function discardPostImages(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) {
    return;
  }
  await ipc.discardImages({ tokens: [...tokens] });
}

export async function fetchPost(postId: string): Promise<Result<Post, FeedError>> {
  const result = await ipc.getPost({ postId });
  return result.ok ? ok(result.data.post) : fail(result.error);
}

/** Every field optional; `imageTokens` are staged handles to append. */
export async function editPost(
  postId: string,
  changes: Omit<UpdatePostRequest, 'postId'>,
): Promise<Result<Post, FeedError>> {
  const result = await ipc.updatePost({ postId, ...changes });
  return result.ok ? ok(result.data.post) : fail(result.error);
}

export async function deletePost(postId: string): Promise<Result<true, FeedError>> {
  const result = await ipc.deletePost({ postId });
  return result.ok ? ok(true) : fail(result.error);
}

export async function repost(postId: string, content?: string): Promise<Result<Post, FeedError>> {
  const result = await ipc.repost({ postId, ...(content === undefined ? {} : { content }) });
  return result.ok ? ok(result.data.post) : fail(result.error);
}

/**
 * Puts the link on the clipboard, which happens in the main process: the
 * renderer has no clipboard permission of its own — see the default-deny policy
 * in electron/security/permissions.ts — and never names what gets copied.
 */
export async function copyShareLink(
  postId: string,
): Promise<Result<ShareLinkCopiedResponse, FeedError>> {
  const result = await ipc.copyPostShareLink({ postId });
  return result.ok ? ok(result.data) : fail(result.error);
}

/**
 * Flips the viewer's save of a post and answers with where it landed — which,
 * for a toggle, is the only trustworthy account of it.
 */
export async function toggleSave(postId: string): Promise<Result<SaveState, FeedError>> {
  const result = await ipc.togglePostSave({ postId });
  return result.ok ? ok(result.data) : fail(result.error);
}

/* -- reactions -- */

/**
 * Adds, changes or removes in one call: the server compares `type` with the
 * viewer's current reaction. Sending the type already held removes it.
 */
export async function toggleReaction(
  postId: string,
  type: ReactionType = PRIMARY_REACTION,
): Promise<Result<ReactionSummary, FeedError>> {
  const result = await ipc.toggleReaction({ targetType: 'POST', targetId: postId, type });
  return result.ok ? ok(result.data) : fail(result.error);
}

export async function fetchReactionSummary(
  targetType: PostTargetType,
  postId: string,
): Promise<Result<ReactionSummary, FeedError>> {
  const result = await ipc.reactionSummary({ targetType, targetId: postId });
  return result.ok ? ok(result.data) : fail(result.error);
}

/** Who reacted, newest first; `type` narrows to one reaction. */
export async function fetchReactors(
  targetType: PostTargetType,
  postId: string,
  page: number,
  type?: ReactionType,
): Promise<Result<ReactorPage, FeedError>> {
  const result = await ipc.listReactors({
    targetType,
    targetId: postId,
    page,
    size: REACTORS_PAGE_SIZE,
    ...(type === undefined ? {} : { type }),
  });
  return result.ok ? ok(result.data) : fail(result.error);
}
