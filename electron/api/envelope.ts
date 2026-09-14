/**
 * The Yello API's response envelope.
 *
 * Success is `{ success, data, timestamp }`; failure is
 * `{ success, code, message, fieldErrors, path, timestamp }`. The chat
 * service's failure body — `{ code, message, details }` — is a subset, so the
 * one error schema reads both; `details` is deliberately not surfaced.
 *
 * The envelope is parsed in two steps — outer shape first, then the payload
 * against the caller's schema — so each layer reports its own failure and the
 * generic stays simple.
 */
import { z } from 'zod';

export const apiEnvelopeSchema = z.object({
  success: z.boolean().optional(),
  data: z.unknown(),
  timestamp: z.string().optional(),
});

export const apiErrorEnvelopeSchema = z.object({
  success: z.literal(false).optional(),
  code: z.string().max(64).optional(),
  message: z.string().max(500).optional(),
  fieldErrors: z.record(z.string(), z.array(z.string())).nullish(),
  path: z.string().max(500).optional(),
});

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
