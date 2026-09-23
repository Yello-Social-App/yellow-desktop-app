import type { Author, IpcError, Post } from '@shared/ipc-types';
import { useCallback, useEffect, useState } from 'react';

import { useCurrentUser } from '@/features/auth/hooks';
import { useFriendsStore } from '@/features/friends/store';
import { LOCAL_BLOCKED_STATUS } from '@/features/friends/types';
import { createLogger } from '@/lib/logger';

import { setMuted, setPostHidden, submitReport } from './api';
import { useModerationStore } from './store';
import type { ReportReason } from './types';

const log = createLogger('moderation');

/**
 * Reads the viewer's reports and mutes once per signed-in account, so every
 * post card can tell "you reported this" without a request of its own.
 * Mounted from the app shell.
 */
export function useSafetySync(): void {
  const userId = useCurrentUser()?.id;
  const loadReports = useModerationStore((state) => state.loadReports);
  const loadMuted = useModerationStore((state) => state.loadMuted);

  useEffect(() => {
    if (userId === undefined) {
      return;
    }
    void loadReports();
    void loadMuted();
  }, [userId, loadReports, loadMuted]);
}

/** Why a post is folded away, or null when it shows in full. */
export type CollapseReason = 'reported' | 'hidden' | 'muted' | 'blocked' | null;

export interface PostModeration {
  collapse: CollapseReason;
  /** The reason the viewer reported it for, when they did. */
  reportedFor: ReportReason | null;
  isMuted: boolean;
}

/** What the card needs to know about one post, from one subscription each. */
export function usePostModeration(post: Post): PostModeration {
  const isHidden = useModerationStore((state) => state.hiddenPostIds.includes(post.id));
  const isRevealed = useModerationStore((state) => state.revealedPostIds.includes(post.id));
  const reportedFor = useModerationStore(
    (state) => state.reports.find((entry) => entry.postId === post.id)?.reason ?? null,
  );
  const isMuted = useModerationStore((state) =>
    state.muted.some((entry) => entry.id === post.author.id),
  );
  const isBlocked = useFriendsStore(
    (state) =>
      state.statuses[post.author.id] === LOCAL_BLOCKED_STATUS ||
      state.lists.blocked.entries.some((entry) => entry.user.id === post.author.id),
  );

  let collapse: CollapseReason = null;
  if (!isRevealed) {
    if (isHidden) {
      collapse = reportedFor === null ? 'hidden' : 'reported';
    } else if (isBlocked) {
      collapse = 'blocked';
    } else if (isMuted) {
      collapse = 'muted';
    }
  }

  return { collapse, reportedFor, isMuted };
}

export interface ReportOptions {
  hideAfter: boolean;
  blockAuthor: boolean;
}

export interface ReportPost {
  submit: (reason: ReportReason, details: string) => Promise<boolean>;
  /**
   * Applies the follow-ups the reporter ticked. Run when the dialog closes, not
   * on submit: hiding or blocking folds the card away, and the dialog lives in
   * the card — the confirmation would vanish before it was read.
   */
  finish: (options: ReportOptions) => Promise<void>;
  isSending: boolean;
  error: IpcError | null;
}

export function useReportPost(post: Post): ReportPost {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<IpcError | null>(null);

  const submit = useCallback(
    async (reason: ReportReason, details: string): Promise<boolean> => {
      setIsSending(true);
      setError(null);
      const result = await submitReport({ postId: post.id, reason, details });
      setIsSending(false);
      if (!result.ok) {
        // The details are the reporter's words: never logged (A09).
        log.warn('report_failed', { code: result.error.code, apiCode: result.error.apiCode });
        setError(result.error);
        return false;
      }

      const store = useModerationStore.getState();
      if (result.data.kind === 'created') {
        store.addReport(result.data.report);
      } else {
        // The open report the server already holds is the one to show; read
        // it back rather than inventing a row for it.
        void store.loadReports();
      }
      return true;
    },
    [post],
  );

  const finish = useCallback(
    async (options: ReportOptions): Promise<void> => {
      if (options.hideAfter) {
        await hide(post.id);
      }
      if (options.blockAuthor) {
        await useFriendsStore.getState().block(post.author.id);
      }
    },
    [post],
  );

  return { submit, finish, isSending, error };
}

/**
 * Folds the post at once, then tells the server so the hide follows the
 * account to other devices. If that call fails the post stays folded here —
 * what the viewer asked for — and only the other devices miss out.
 */
async function hide(postId: string): Promise<void> {
  useModerationStore.getState().hidePost(postId);
  const result = await setPostHidden(postId, true);
  if (!result.ok) {
    log.warn('hide_failed', { code: result.error.code });
  }
}

/**
 * Mute goes through the API before the store changes, so the list never
 * claims something the server has not accepted. Block and unblock are the
 * friends store's, which does the same.
 */
export function useRestrictions() {
  const mute = useCallback(async (author: Author): Promise<void> => {
    const result = await setMuted(author.id, true);
    if (result.ok) {
      useModerationStore.getState().mute(author);
    } else {
      log.warn('mute_failed', { code: result.error.code, apiCode: result.error.apiCode });
    }
  }, []);

  const unmute = useCallback(async (userId: string): Promise<void> => {
    const result = await setMuted(userId, false);
    if (result.ok) {
      useModerationStore.getState().unmute(userId);
    } else {
      log.warn('unmute_failed', { code: result.error.code });
    }
  }, []);

  const unblock = useCallback(
    (userId: string): Promise<boolean> => useFriendsStore.getState().unblock(userId),
    [],
  );

  const hidePost = useCallback(async (postId: string): Promise<void> => {
    await hide(postId);
  }, []);

  /**
   * Shows a folded post. Only a post the viewer hid has anything to undo on
   * the server; one folded for its muted or blocked author is revealed here
   * alone and the mute or block stands.
   */
  const showPost = useCallback(async (postId: string): Promise<void> => {
    const store = useModerationStore.getState();
    const wasHidden = store.hiddenPostIds.includes(postId);
    store.showPost(postId);
    if (wasHidden) {
      const result = await setPostHidden(postId, false);
      if (!result.ok) {
        log.warn('unhide_failed', { code: result.error.code });
      }
    }
  }, []);

  return { mute, unmute, unblock, hidePost, showPost };
}
