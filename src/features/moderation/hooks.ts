import type { Author, IpcError, Post } from '@shared/ipc-types';
import { useCallback, useState } from 'react';

import { createLogger } from '@/lib/logger';
import { displayName } from '@/lib/user-display';

import { setBlocked, setMuted, submitReport } from './api';
import { useModerationStore } from './store';
import type { ReportReason } from './types';

const log = createLogger('moderation');

const EXCERPT_LENGTH = 80;

/** Why a post is folded away, or null when it shows in full. */
export type CollapseReason = 'reported' | 'hidden' | 'muted' | 'blocked' | null;

export interface PostModeration {
  collapse: CollapseReason;
  /** The reason the viewer reported it for, when they did. */
  reportedFor: ReportReason | null;
  isMuted: boolean;
}

/** What the card needs to know about one post, from one subscription. */
export function usePostModeration(post: Post): PostModeration {
  const isHidden = useModerationStore((state) => state.hiddenPostIds.includes(post.id));
  const isRevealed = useModerationStore((state) => state.revealedPostIds.includes(post.id));
  const reportedFor = useModerationStore(
    (state) => state.reports.find((entry) => entry.postId === post.id)?.reason ?? null,
  );
  const isMuted = useModerationStore((state) =>
    state.muted.some((entry) => entry.id === post.author.id),
  );
  const isBlocked = useModerationStore((state) =>
    state.blocked.some((entry) => entry.id === post.author.id),
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
        log.warn('report_failed', { code: result.error.code });
        setError(result.error);
        return false;
      }

      useModerationStore.getState().addReport({
        id: result.data.id,
        postId: post.id,
        reason,
        authorName: displayName(post.author),
        excerpt: post.content.slice(0, EXCERPT_LENGTH),
        status: 'UNDER_REVIEW',
        createdAt: result.data.createdAt,
      });
      return true;
    },
    [post],
  );

  const finish = useCallback(
    async (options: ReportOptions): Promise<void> => {
      const store = useModerationStore.getState();
      if (options.hideAfter) {
        store.hidePost(post.id);
      }
      if (options.blockAuthor) {
        const blocked = await setBlocked(post.author.id, true);
        if (blocked.ok) {
          store.block(post.author);
        }
      }
    },
    [post],
  );

  return { submit, finish, isSending, error };
}

/**
 * Mute and block go through the (sample) API before the store changes, so the
 * list never claims something the server has not accepted.
 */
export function useRestrictions() {
  const mute = useCallback(async (author: Author): Promise<void> => {
    const result = await setMuted(author.id, true);
    if (result.ok) {
      useModerationStore.getState().mute(author);
    }
  }, []);

  const unmute = useCallback(async (userId: string): Promise<void> => {
    const result = await setMuted(userId, false);
    if (result.ok) {
      useModerationStore.getState().unmute(userId);
    }
  }, []);

  const unblock = useCallback(async (userId: string): Promise<void> => {
    const result = await setBlocked(userId, false);
    if (result.ok) {
      useModerationStore.getState().unblock(userId);
    }
  }, []);

  return { mute, unmute, unblock };
}
