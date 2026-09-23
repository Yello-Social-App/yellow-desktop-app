import { Check, Info } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { OtpInput } from '@/components/ui/OtpInput';
import type { AuthError } from '@/features/auth/api';
import {
  useChangePassword,
  useCooldown,
  useCurrentUser,
  useRequestChangePasswordCode,
  type Cooldown,
} from '@/features/auth/hooks';
import {
  OTP_LENGTH,
  REGISTER_PASSWORD_MIN_LENGTH,
  changePasswordFormSchema,
  currentPasswordFormSchema,
  type ChangePasswordFormValues,
  type CurrentPasswordFormValues,
} from '@/features/auth/types';
import { useZodForm } from '@/hooks/use-zod-form';
import { OTP_RESEND_COOLDOWN_MS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { ApiErrorNotice } from '@/routes/auth/components/ApiErrorNotice';
import { PasswordField } from '@/routes/auth/components/PasswordField';

import { SuccessNote } from './SettingsSection';

/** The server kills a code on its fifth wrong try; every later try is OTP_INVALID too. */
const MAX_WRONG_CODES = 5;

const CURRENT_INITIAL = { currentPassword: '' };
const CHANGE_INITIAL = { code: '', newPassword: '', confirmPassword: '' };

/** The first message the server attached to one field, if it named that field. */
function serverFieldError(error: AuthError | null, field: string): string | undefined {
  return error?.fieldErrors?.[field]?.[0];
}

type Step = 'password' | 'code' | 'done';

interface Draft {
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_DRAFT: Draft = { newPassword: '', confirmPassword: '' };

/**
 * What the change-password endpoint requires of a new password (the same as
 * `newPasswordRule`), plus the one thing that only makes it stronger.
 */
function passwordChecks(password: string): { label: string; met: boolean; required: boolean }[] {
  return [
    {
      label: `At least ${String(REGISTER_PASSWORD_MIN_LENGTH)} characters`,
      met: password.length >= REGISTER_PASSWORD_MIN_LENGTH,
      required: true,
    },
    {
      label: 'Upper and lower case letters',
      met: /[a-z]/.test(password) && /[A-Z]/.test(password),
      required: true,
    },
    { label: 'A number', met: /[0-9]/.test(password), required: true },
    { label: 'A symbol, to make it stronger', met: /[^A-Za-z0-9]/.test(password), required: false },
  ];
}

/**
 * Settings → Change password: prove the current password, then enter the
 * emailed code with the new one.
 *
 * Three steps, one after another, held as a plain union in state — they share
 * nothing but the password kept for resends and the resend countdown, which
 * live here so a step can be left and returned to.
 *
 * The current password is held in a ref only for "Resend code": the endpoint
 * that sends a code re-checks it each time. It is dropped when the flow ends
 * or starts over, and never logged.
 */
export function ChangePasswordSettings() {
  const user = useCurrentUser();
  const [step, setStep] = useState<Step>('password');
  const [restartReason, setRestartReason] = useState<string | null>(null);
  const heldPassword = useRef<string | null>(null);
  const cooldown = useCooldown(OTP_RESEND_COOLDOWN_MS);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const email = user?.email;

  return (
    <div className="grid items-start gap-5 @3xl:grid-cols-[460px_minmax(0,1fr)]">
      {step === 'password' && (
        <CurrentPasswordStep
          email={email}
          notice={restartReason}
          onCodeSent={(password) => {
            heldPassword.current = password;
            setRestartReason(null);
            cooldown.start();
            setStep('code');
          }}
        />
      )}

      {step === 'code' && (
        <CodeStep
          email={email}
          cooldown={cooldown}
          heldPassword={() => heldPassword.current}
          onDraftChange={setDraft}
          onChanged={() => {
            heldPassword.current = null;
            setDraft(EMPTY_DRAFT);
            setStep('done');
          }}
          onRestart={(reason) => {
            heldPassword.current = null;
            setDraft(EMPTY_DRAFT);
            setRestartReason(reason);
            setStep('password');
          }}
        />
      )}

      {step === 'done' && (
        <Card className="flex flex-col gap-3 p-5">
          <SuccessNote>Password changed.</SuccessNote>
          <p className="text-on-surface-variant text-[14px]">
            You’re still signed in here. Every other device and browser was signed out and needs the
            new password to get back in.
          </p>
        </Card>
      )}

      {step !== 'done' && <PasswordRules draft={draft} />}
    </div>
  );
}

/** The checklist beside the form, ticking as the new password is typed. */
function PasswordRules({ draft }: { draft: Draft }) {
  const matches = draft.confirmPassword !== '' && draft.confirmPassword === draft.newPassword;
  const checks = [
    ...passwordChecks(draft.newPassword),
    { label: 'Both new passwords match', met: matches, required: true },
  ];

  return (
    <Card as="section" aria-label="Password requirements" className="flex flex-col gap-3 p-5">
      <h2 className="text-on-surface text-[14px] font-semibold">Your new password needs</h2>
      <ul className="flex flex-col gap-3">
        {checks.map((check) => (
          <li
            key={check.label}
            className={cn(
              'flex items-center gap-2.5 text-[13px]',
              check.met ? 'text-on-surface' : 'text-outline',
            )}
          >
            <span
              className={cn(
                'flex size-[18px] shrink-0 items-center justify-center rounded-full',
                check.met
                  ? 'bg-tertiary text-on-tertiary'
                  : 'bg-surface-container-highest text-transparent',
              )}
            >
              <Check aria-hidden className="size-3" strokeWidth={3} />
            </span>
            {check.label}
            <span className="sr-only">{check.met ? ', done' : ', not yet'}</span>
          </li>
        ))}
      </ul>
      <div className="bg-outline-variant my-1 h-px" />
      <p className="text-outline text-[12px] leading-normal">
        Changing your password signs out every other device. This one stays signed in. Passwords
        found in known data breaches are turned down.
      </p>
    </Card>
  );
}

const STRENGTH_NAMES = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const STRENGTH_BARS = ['', 'bg-error', 'bg-coral', 'bg-[#facc15]', 'bg-tertiary'] as const;
const STRENGTH_TEXT = ['', 'text-error', 'text-coral', 'text-[#facc15]', 'text-tertiary'] as const;

/** Four bars under the new password: one per check it passes. */
function StrengthMeter({ password }: { password: string }) {
  const score = password === '' ? 0 : passwordChecks(password).filter((c) => c.met).length;
  return (
    <div className="-mt-sm flex flex-col gap-1.5">
      <div aria-hidden className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cn(
              'h-1 rounded-sm',
              bar <= score ? STRENGTH_BARS[score] : 'bg-surface-container-highest',
            )}
          />
        ))}
      </div>
      <p className="text-on-surface-variant text-[12px]" aria-live="polite">
        Strength:{' '}
        <span className={score === 0 ? 'text-outline' : STRENGTH_TEXT[score]}>
          {score === 0 ? '—' : STRENGTH_NAMES[score]}
        </span>
      </p>
    </div>
  );
}

interface CurrentPasswordStepProps {
  email: string | undefined;
  /** Why the user is back on this step, when the code step sent them. */
  notice: string | null;
  onCodeSent: (currentPassword: string) => void;
}

function CurrentPasswordStep({ email, notice, onCodeSent }: CurrentPasswordStepProps) {
  const form = useZodForm<typeof CURRENT_INITIAL, CurrentPasswordFormValues>(
    currentPasswordFormSchema,
    CURRENT_INITIAL,
  );
  const { submit, isSubmitting, error, clearError } = useRequestChangePasswordCode();

  // A wrong password is this field's error, not a banner — and not a sign-out:
  // it is a 400, and the session is untouched.
  const isWrongPassword = error?.apiCode === 'CURRENT_PASSWORD_INCORRECT';
  const fieldError =
    form.errors.currentPassword ??
    (isWrongPassword
      ? 'That isn’t your current password.'
      : serverFieldError(error, 'currentPassword'));
  const bannerError = isWrongPassword || fieldError !== undefined ? null : error;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validated = form.validate();
    if (!validated.ok) {
      return;
    }
    const { currentPassword } = validated.data;
    void submit(currentPassword).then((result) => {
      if (result?.ok === true) {
        onCodeSent(currentPassword);
      }
    });
  };

  return (
    <Card className="p-5">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <p className="text-on-surface-variant flex items-start gap-2 text-[13px]">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {email === undefined
            ? 'We’ll email you a code to confirm it’s you.'
            : `We’ll email a code to ${email} to confirm it’s you.`}
        </p>
        {notice !== null && (
          <p role="alert" className="text-on-surface-variant text-[14px]">
            {notice}
          </p>
        )}

        <PasswordField
          label="Current password"
          autoComplete="current-password"
          value={form.values.currentPassword}
          error={fieldError}
          onChange={(value) => {
            form.setField('currentPassword', value);
            clearError();
          }}
        />

        {bannerError !== null && <ApiErrorNotice error={bannerError} />}

        <div>
          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Email me a code'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface CodeStepProps {
  email: string | undefined;
  cooldown: Cooldown;
  heldPassword: () => string | null;
  /** Reports the new password as typed, for the checklist beside the form. */
  onDraftChange: (draft: Draft) => void;
  onChanged: () => void;
  onRestart: (reason: string | null) => void;
}

function CodeStep({
  email,
  cooldown,
  heldPassword,
  onDraftChange,
  onChanged,
  onRestart,
}: CodeStepProps) {
  const codeId = useId();
  const form = useZodForm<typeof CHANGE_INITIAL, ChangePasswordFormValues>(
    changePasswordFormSchema,
    CHANGE_INITIAL,
  );
  const change = useChangePassword();
  const resend = useRequestChangePasswordCode();
  const [wrongCodes, setWrongCodes] = useState(0);
  const [hasResent, setHasResent] = useState(false);
  const [sameAsCurrent, setSameAsCurrent] = useState(false);

  const isCodeDead = wrongCodes >= MAX_WRONG_CODES;
  const codeError = form.errors.code ?? serverFieldError(change.error, 'code');
  const newPasswordError =
    form.errors.newPassword ??
    (sameAsCurrent ? 'Choose a password you aren’t using now.' : undefined) ??
    serverFieldError(change.error, 'newPassword');
  const isFieldError =
    serverFieldError(change.error, 'code') !== undefined ||
    serverFieldError(change.error, 'newPassword') !== undefined;
  const bannerError = isCodeDead || isFieldError ? null : change.error;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isCodeDead) {
      return;
    }
    const validated = form.validate();
    if (!validated.ok) {
      return;
    }
    // A courtesy check against the password typed a moment ago; the server
    // rejects it anyway, without spending the code.
    if (validated.data.newPassword === heldPassword()) {
      setSameAsCurrent(true);
      return;
    }

    void change.submit(validated.data.code, validated.data.newPassword).then((result) => {
      if (result === null) {
        return;
      }
      if (result.ok) {
        onChanged();
        return;
      }
      switch (result.error.apiCode) {
        case 'OTP_INVALID':
          setWrongCodes((count) => count + 1);
          form.setField('code', '');
          break;
        case 'OTP_TOO_MANY_ATTEMPTS':
          onRestart('That code had too many wrong tries. Enter your password to get a new one.');
          break;
        default:
          break;
      }
    });
  };

  const handleResend = (): void => {
    const password = heldPassword();
    if (cooldown.seconds > 0 || resend.isSubmitting) {
      return;
    }
    if (password === null) {
      onRestart(null);
      return;
    }
    setHasResent(false);
    void resend.submit(password).then((result) => {
      if (result?.ok === true) {
        // Past the 60-second window, so this was a fresh code: the count of
        // wrong tries starts again with it.
        cooldown.start();
        setWrongCodes(0);
        setHasResent(true);
        change.clearError();
      } else if (result?.ok === false && result.error.apiCode === 'CURRENT_PASSWORD_INCORRECT') {
        // Changed somewhere else meanwhile: the held password is no longer it.
        onRestart('Your password changed since you started. Enter the current one again.');
      }
    });
  };

  return (
    <Card className="p-5">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <p className="text-on-surface-variant text-[14px]">
          We sent a {OTP_LENGTH}-digit code to{' '}
          {email === undefined ? (
            'your email'
          ) : (
            <strong className="text-on-surface">{email}</strong>
          )}
          . It expires in five minutes.
        </p>

        <FormField id={codeId} label="Verification code" error={codeError}>
          <OtpInput
            id={codeId}
            length={OTP_LENGTH}
            value={form.values.code}
            isInvalid={codeError !== undefined}
            disabled={change.isSubmitting || isCodeDead}
            onChange={(code) => {
              form.setField('code', code);
            }}
          />
        </FormField>

        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={form.values.newPassword}
          error={newPasswordError}
          onChange={(value) => {
            form.setField('newPassword', value);
            onDraftChange({ newPassword: value, confirmPassword: form.values.confirmPassword });
            setSameAsCurrent(false);
            change.clearError();
          }}
        />

        <StrengthMeter password={form.values.newPassword} />

        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={form.values.confirmPassword}
          error={form.errors.confirmPassword}
          onChange={(value) => {
            form.setField('confirmPassword', value);
            onDraftChange({ newPassword: form.values.newPassword, confirmPassword: value });
          }}
        />

        {isCodeDead && (
          <p role="alert" className="text-error text-[14px]">
            That code has had too many wrong tries. Send a new code to carry on.
          </p>
        )}
        {bannerError !== null && <ApiErrorNotice error={bannerError} />}
        {resend.error !== null && <ApiErrorNotice error={resend.error} />}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" isLoading={change.isSubmitting} disabled={isCodeDead}>
            {change.isSubmitting ? 'Changing…' : 'Change password'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={change.isSubmitting}
            onClick={() => {
              onRestart(null);
            }}
          >
            Start over
          </Button>
        </div>

        <div aria-live="polite" className="text-on-surface-variant flex flex-col gap-1 text-[13px]">
          {hasResent && <p>A new code is on its way.</p>}
          <p>
            Didn’t get it?{' '}
            <button
              type="button"
              disabled={resend.isSubmitting || cooldown.seconds > 0}
              onClick={handleResend}
              className="font-label text-label text-primary hover:text-primary-fixed-dim disabled:text-on-surface-variant transition-tone disabled:cursor-not-allowed"
            >
              {cooldown.seconds > 0
                ? `Resend in ${String(cooldown.seconds)}s`
                : resend.isSubmitting
                  ? 'Sending…'
                  : isCodeDead
                    ? 'Send a new code'
                    : 'Resend code'}
            </button>
          </p>
        </div>
      </form>
    </Card>
  );
}
