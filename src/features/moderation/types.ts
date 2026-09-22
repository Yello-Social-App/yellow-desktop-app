/**
 * Reporting a post, and the viewer's own safety controls: hide, mute, block.
 *
 * The reason is an allowlisted enum and the details are length-capped before
 * anything is sent (OWASP A05/A06) — the schema is the endpoint's own, from
 * shared/ipc-types.ts. Reports are anonymous to the author; the server, not
 * this client, decides what happens to the post.
 */
import {
  REPORT_DETAILS_MAX,
  submitReportRequestSchema,
  type PostReport,
  type ReportReason,
  type ReportStatus,
  type SubmitReportRequest,
} from '@shared/ipc-types';

export { REPORT_DETAILS_MAX };
export type { ReportReason, ReportStatus };

/** Page size for "Your reports" and "Muted accounts"; the server caps it at 50. */
export const SAFETY_LIST_SIZE = 50;

export const REPORT_REASONS: readonly { id: ReportReason; label: string; hint: string }[] = [
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
]

export const reportInputSchema = submitReportRequestSchema;

export type ReportInput = SubmitReportRequest;

/** One of the viewer's reports, as `GET /v1/reports/me` answers it. */
export type ReportEntry = PostReport;

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
