/**
 * Auth form contracts.
 *
 * These mirror the API's own validation rules (register: 12–128 char password,
 * 3–32 char username matching ^[a-zA-Z0-9_.]+$) so a submission that would be
 * rejected server-side is caught before it leaves the window (OWASP A05).
 * The server still validates — this is a courtesy, not the control.
 */
import { z } from 'zod';

export const LOGIN_PASSWORD_MIN_LENGTH = 1;
export const REGISTER_PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const FULL_NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;
export const OTP_LENGTH = 6;

export const loginFormSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(LOGIN_PASSWORD_MIN_LENGTH, 'Enter your password.'),
  rememberMe: z.boolean(),
});

export const registerFormSchema = z
  .object({
    fullName: z.string().max(FULL_NAME_MAX_LENGTH, 'That name is too long.'),
    username: z
      .string()
      .min(USERNAME_MIN_LENGTH, `Use at least ${USERNAME_MIN_LENGTH} characters.`)
      .max(USERNAME_MAX_LENGTH, 'That username is too long.')
      .regex(/^[a-zA-Z0-9_.]+$/, 'Letters, numbers, dots and underscores only.'),
    email: z.email('Enter a valid email address.').max(EMAIL_MAX_LENGTH),
    password: z
      .string()
      .min(REGISTER_PASSWORD_MIN_LENGTH, `Use at least ${REGISTER_PASSWORD_MIN_LENGTH} characters.`)
      .max(PASSWORD_MAX_LENGTH, 'That password is too long.'),
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, 'Accept the terms to continue.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const verifyOtpFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^[0-9]{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code.`),
});

/** Step two of a reset: the new password, confirmed. The token is held in main. */
export const resetPasswordFormSchema = z
  .object({
    newPassword: z
      .string()
      .min(REGISTER_PASSWORD_MIN_LENGTH, `Use at least ${REGISTER_PASSWORD_MIN_LENGTH} characters.`)
      .max(PASSWORD_MAX_LENGTH, 'That password is too long.'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export type LoginFormValues = z.infer<typeof loginFormSchema>;
export type RegisterFormValues = z.infer<typeof registerFormSchema>;
export type VerifyOtpFormValues = z.infer<typeof verifyOtpFormSchema>;
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;
