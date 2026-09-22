/**
 * Reporting a post, and the viewer's own safety controls: hide, mute, block.
 *
 * The reason is an allowlisted enum and the details are length-capped before
 * anything is sent (OWASP A05/A06). Reports are anonymous to the author; the
 * server, not this client, decides what happens to the post.
 */
import { z } from 'zod';

export const REPORT_DETAILS_MAX = 300;

export const REPORT_REASONS = [
  {
    id: 'SPAM',
    label: 'Spam or scam',
    hint: 'Fake giveaways, phishing links, asking for passwords or seed phrases',
  },
  {
    id: 'HARASSMENT',
    label: 'Harassment or bullying',
    hint: 'Targeting, insulting or threatening someone',
  },
  { id: 'HATE', label: 'Hate speech', hint: 'Attacks on people for who they are' },
  {
    id: 'VIOLENCE',
    label: 'Violence or dangerous acts',
    hint: 'Threats, self-harm, or promoting harm',
  },
  {
    id: 'SEXUAL',
    label: 'Nudity or sexual content',
    hint: 'Explicit images or sexual solicitation',
  },
  {
    id: 'MISINFORMATION',
    label: 'False information',
    hint: 'Misleading claims that could cause harm',
  },
  {
    id: 'OTHER',
    label: 'Something else',
    hint: 'Intellectual property, impersonation, or another issue',
  },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

const REASON_IDS = REPORT_REASONS.map((reason) => reason.id) as [ReportReason, ...ReportReason[]];

export const reportInputSchema = z.object({
  postId: z.string().min(1).max(64),
  reason: z.enum(REASON_IDS),
  details: z.string().trim().max(REPORT_DETAILS_MAX),
});

export type ReportInput = z.infer<typeof reportInputSchema>;

export type ReportStatus = 'UNDER_REVIEW' | 'ACTION_TAKEN' | 'NO_VIOLATION';

export interface ReportEntry {
  id: string;
  postId: string;
  reason: ReportReason;
  /** Who and what was reported, kept for the viewer's own list only. */
  authorName: string;
  excerpt: string;
  status: ReportStatus;
  createdAt: string;
}

/** Someone the viewer muted or blocked, as their list draws them. */
export interface RestrictedAccount {
  id: string;
  name: string;
  username: string;
  since: string;
}

export function reasonLabel(reason: ReportReason): string {
  return REPORT_REASONS.find((entry) => entry.id === reason)?.label ?? 'Something else';
}

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  UNDER_REVIEW: 'Under review',
  ACTION_TAKEN: 'Removed',
  NO_VIOLATION: 'No violation found',
};
