import type { Post } from '@shared/ipc-types';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useReportPost } from '@/features/moderation/hooks';
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  reasonLabel,
  type ReportReason,
} from '@/features/moderation/types';
import { cn } from '@/lib/cn';
import { handleOf } from '@/lib/user-display';

interface ReportPostDialogProps {
  post: Post;
  onClose: () => void;
}

/**
 * Reason → details → confirmation.
 *
 * The steps are a plain `step` value rather than a State object: three screens
 * with one way forward and one way back do not earn a machine. Hiding the post
 * and blocking its author are applied on close, not on submit — both fold the
 * card this dialog lives in (see `useReportPost().finish`).
 */
export function ReportPostDialog({ post, onClose }: ReportPostDialogProps) {
  const [step, setStep] = useState<'reason' | 'details' | 'done'>('reason');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [hideAfter, setHideAfter] = useState(true);
  const [blockAuthor, setBlockAuthor] = useState(false);
  const report = useReportPost(post);
  const detailsId = useId();
  const handle = handleOf(post.author);

  const close = (): void => {
    if (step === 'done') {
      void report.finish({ hideAfter, blockAuthor });
    }
    onClose();
  };

  if (step === 'done' && reason !== null) {
    const followUps = [
      hideAfter ? 'this post will be hidden from your feed' : null,
      blockAuthor ? `${handle} will be blocked` : null,
    ].filter((line): line is string => line !== null);

    return (
      <Modal
        isOpen
        onClose={close}
        size="sm"
        title="Thanks, we got your report"
        footer={<Button onClick={close}>Done</Button>}
      >
        <div className="gap-sm flex flex-col items-center py-2 text-center">
          <span className="bg-tertiary-fixed text-tertiary flex size-12 items-center justify-center rounded-2xl">
            <ShieldCheck aria-hidden className="size-6" />
          </span>
          <p className="text-on-surface-variant text-[14px] leading-relaxed">
            Our safety team reviews reports for{' '}
            <span className="text-on-surface">{reasonLabel(reason).toLowerCase()}</span> within 24
            hours. You can follow it in Settings → Privacy &amp; safety.
          </p>
          {followUps.length > 0 && (
            <p className="text-outline text-[13px]">
              When you close this, {followUps.join(' and ')}.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  if (step === 'details' && reason !== null) {
    return (
      <Modal
        isOpen
        onClose={close}
        title="Anything else we should know?"
        footer={
          <>
            <Button
              variant="ghost"
              leadingIcon={<ChevronLeft className="size-4" />}
              disabled={report.isSending}
              onClick={() => {
                setStep('reason');
              }}
            >
              Back
            </Button>
            <Button
              variant="danger"
              isLoading={report.isSending}
              onClick={() => {
                void report.submit(reason, details).then((sent) => {
                  if (sent) {
                    setStep('done');
                  }
                });
              }}
            >
              Submit report
            </Button>
          </>
        }
      >
        <div className="gap-md flex flex-col">
          <p className="text-on-surface-variant gap-sm flex items-center text-[13px]">
            Reason:
            <span className="bg-error-container text-on-error-container rounded-md px-2 py-0.5 font-medium">
              {reasonLabel(reason)}
            </span>
          </p>

          <div className="gap-xs flex flex-col">
            <label htmlFor={detailsId} className="text-on-surface text-[14px] font-medium">
              Details <span className="text-outline text-[13px] font-normal">Optional</span>
            </label>
            <textarea
              id={detailsId}
              value={details}
              maxLength={REPORT_DETAILS_MAX}
              onChange={(event) => {
                setDetails(event.target.value);
              }}
              placeholder="e.g. They’ve posted this in three communities today"
              className="bg-surface-container-lowest border-outline-strong text-on-surface focus:border-outline h-24 resize-none rounded-xl border px-3.5 py-3 text-[14px] leading-normal outline-none"
            />
            <span className="text-outline self-end text-[12px] tabular-nums">
              {details.length} / {REPORT_DETAILS_MAX}
            </span>
          </div>

          <div className="bg-surface-container-low border-outline-variant gap-md p-md flex flex-col rounded-xl border">
            <ToggleRow
              checked={hideAfter}
              onChange={setHideAfter}
              title="Hide this post from my feed"
              hint="You can show it again any time."
            />
            <ToggleRow
              checked={blockAuthor}
              onChange={setBlockAuthor}
              title={`Also block ${handle}`}
              hint="They won’t be able to message you or see your posts."
            />
          </div>

          {report.error !== null && (
            <p role="alert" className="text-error text-[13px]">
              {report.error.message}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen
      onClose={close}
      title="Why are you reporting this post?"
      description={`Your report is anonymous. ${handle} won’t know who sent it.`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={reason === null}
            onClick={() => {
              setStep('details');
            }}
          >
            Next
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Reason" className="-mx-2 flex flex-col gap-1">
        {REPORT_REASONS.map((option) => {
          const isSelected = option.id === reason;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                setReason(option.id);
              }}
              className={cn(
                'transition-tone flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left',
                isSelected
                  ? 'bg-surface-container-high border-outline-strong'
                  : 'hover:bg-surface-container-low border-transparent',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 size-[18px] shrink-0 rounded-full',
                  isSelected
                    ? 'border-primary-container border-[5px]'
                    : 'border-outline-strong border-2',
                )}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-on-surface text-[14px] font-medium">{option.label}</span>
                <span className="text-outline text-[12px] leading-snug">{option.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

interface ToggleRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  hint: string;
}

function ToggleRow({ checked, onChange, title, hint }: ToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="accent-primary-container mt-0.5 size-4 cursor-pointer"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-on-surface text-[14px] font-medium">{title}</span>
        <span className="text-outline text-[12px]">{hint}</span>
      </span>
    </label>
  );
}
