/**
 * The HTTP client, living in the main process.
 *
 * Why here and not in the renderer:
 *   - the API's CORS allowlist does not include this app's `app://bundle`
 *     origin, and main-process requests are not subject to CORS at all;
 *   - more importantly, the access token never has to enter the renderer, so
 *     no XSS payload or devtools session can read it (OWASP A02/A04).
 *
 * Two rules are enforced here rather than left to callers:
 *   - transport must be HTTPS; cleartext is only tolerated against loopback in
 *     development;
 *   - a 401 triggers exactly one refresh-and-retry, so an expired access token
 *     is invisible to the caller but a revoked session fails fast (A07);
 *   - concurrent 401s share one refresh. Refresh tokens rotate, so two
 *     parallel exchanges of the same token would have the loser fail — and
 *     then clear the pair the winner had just stored.
 *
 * Two services answer on this client. The Yello API wraps success in an
 * envelope and failure in `{ success:false, code, message, fieldErrors }`; the
 * chat service answers bare JSON and `{ code, message, details }`. Which one a
 * call is for is a per-request option (`service`), and the only thing it
 * changes is how the body is unwrapped — auth, refresh, retry and logging are
 * shared. A Strategy in its smallest spelling: two variants exist today, so
 * the branch is named rather than duplicated into a second client.
 *
 * Request and response bodies are never logged: that is where tokens and PII
 * live (A09).
 */
import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { z } from 'zod';

import { createLogger } from '../../shared/logger';
import { ipcFail, ipcOk, type IpcResult } from '../../shared/ipc-types';

import { noteActiveRefreshToken } from './account-vault';
import { apiEnvelopeSchema, apiErrorEnvelopeSchema } from './envelope';
import { ENDPOINTS } from './endpoints';
import {
  accessToken,
  accessTokenExpiresAt,
  clearTokens,
  refreshToken as storedRefreshToken,
  setTokens,
} from './token-store';

const log = createLogger('api.http');

const REQUEST_TIMEOUT_MS = 20_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const HTTP_UNAUTHORIZED = 401;
const HTTP_NO_CONTENT = 204;

const tokenPairSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.string().optional(),
  refreshToken: z.string().min(1).optional(),
  tokenType: z.string().optional(),
});

/** Falls back to a short window when the API omits an explicit expiry. */
const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

function expiryToEpoch(value: string | undefined): number {
  if (value === undefined) {
    return Date.now() + DEFAULT_ACCESS_TOKEN_TTL_MS;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() + DEFAULT_ACCESS_TOKEN_TTL_MS : parsed;
}

function assertTransportIsSafe(baseUrl: string): void {
  const url = new URL(baseUrl);

  if (url.protocol === 'https:') {
    return;
  }

  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    log.warn('cleartext_base_url_allowed', { reason: 'loopback' });
    return;
  }

  throw new Error('API base URL must use HTTPS outside local development.');
}

let client: AxiosInstance | null = null;
let baseUrl = '';
let chatBase = '';

export type ApiService = 'api' | 'chat';

export function apiBaseUrl(): string {
  return baseUrl;
}

export function chatBaseUrl(): string {
  return chatBase;
}

export function configureHttpClient(apiBase: string, chatBaseOverride?: string): void {
  assertTransportIsSafe(apiBase);
  baseUrl = apiBase;

  chatBase = chatBaseOverride ?? apiBase;
  if (chatBase !== apiBase) {
    assertTransportIsSafe(chatBase);
  }

  const instance = axios.create({
    baseURL: apiBase,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Accept: 'application/json' },
    // 4xx and 5xx are handled as values, not thrown control flow.
    validateStatus: () => true,
  });

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = accessToken();
    if (token !== null) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  client = instance;
}

function requireClient(): AxiosInstance {
  if (client === null) {
    throw new Error('HTTP client used before configureHttpClient().');
  }
  return client;
}

/** The refresh currently in flight, so callers that arrive together share it. */
let refreshInFlight: Promise<boolean> | null = null;

/** Exchanges the stored refresh token for a new pair — once at a time. */
function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= exchangeRefreshToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** How close to expiry a token is treated as already stale. */
const TOKEN_FRESHNESS_MARGIN_MS = 60 * 1000;

/**
 * An access token good for at least the margin, refreshing first if the held
 * one is closer to expiry than that. The socket authenticates with this: a
 * token that dies seconds after the upgrade would just bounce it straight
 * back into a reconnect.
 */
export async function ensureFreshAccessToken(): Promise<string | null> {
  const expiresAt = accessTokenExpiresAt();
  const token = accessToken();
  if (token !== null && expiresAt !== null && expiresAt - Date.now() > TOKEN_FRESHNESS_MARGIN_MS) {
    return token;
  }
  const refreshed = await refreshAccessToken();
  return refreshed ? accessToken() : null;
}

async function exchangeRefreshToken(): Promise<boolean> {
  const refresh = storedRefreshToken();
  if (refresh === null) {
    return false;
  }

  let response;
  try {
    response = await requireClient().post(ENDPOINTS.auth.refresh, { refreshToken: refresh });
  } catch (error) {
    // Unreachable is not revoked: keep the pair for the next attempt (A10).
    const reason = error instanceof AxiosError ? error.code : undefined;
    log.warn('token_refresh_errored', { reason });
    return false;
  }

  const envelope = apiEnvelopeSchema.safeParse(response.data);
  const pair = envelope.success ? tokenPairSchema.safeParse(envelope.data.data) : null;

  if (response.status >= 400 || pair?.success !== true) {
    log.info('token_refresh_failed', { status: response.status });
    // Only a rejection of the token *we* sent means the session is gone; a
    // pair stored by someone else meanwhile is theirs to keep.
    if (storedRefreshToken() === refresh) {
      clearTokens();
    }
    return false;
  }

  adoptTokenPair(pair.data);
  log.info('token_refreshed', {});
  return true;
}

export function adoptTokenPair(pair: z.infer<typeof tokenPairSchema>): number {
  const expiresAt = expiryToEpoch(pair.accessTokenExpiresAt);
  setTokens({
    accessToken: pair.accessToken,
    accessTokenExpiresAt: expiresAt,
    refreshToken: pair.refreshToken ?? null,
  });

  // Refresh tokens rotate, so the remembered copy has to follow the live one.
  // A vault holding a spent token would not be insecure, but the next switch
  // to that account would fail and read to the user as a revoked session.
  if (pair.refreshToken !== undefined) {
    noteActiveRefreshToken(pair.refreshToken);
  }
  return expiresAt;
}

/**
 * Exchanges a specific refresh token without touching the live session.
 *
 * This is what makes switching accounts safe to attempt: the target account's
 * token is proven first, and only a success tears down the session the user
 * currently has. Exchanging through the shared path instead would have a failed
 * switch leave them signed out of both (A10).
 */
export async function exchangeExplicitRefreshToken(
  token: string,
): Promise<z.infer<typeof tokenPairSchema> | null> {
  let response;
  try {
    response = await requireClient().post(
      ENDPOINTS.auth.refresh,
      { refreshToken: token },
      // The interceptor would otherwise attach the *current* account's access
      // token to a call that is about a different account entirely.
      { headers: { Authorization: undefined } },
    );
  } catch (error) {
    const reason = error instanceof AxiosError ? error.code : undefined;
    log.warn('account_refresh_errored', { reason });
    return null;
  }

  if (response.status >= 400) {
    log.info('account_refresh_rejected', { status: response.status });
    return null;
  }

  const envelope = apiEnvelopeSchema.safeParse(response.data);
  const pair = envelope.success ? tokenPairSchema.safeParse(envelope.data.data) : null;
  return pair?.success === true ? pair.data : null;
}

export const tokenPairResponseSchema = tokenPairSchema;

/** The first few failing field paths, joined — field names only, never values. */
function describeIssuePaths(error: z.ZodError): string {
  const paths = error.issues.slice(0, 8).map((issue) => issue.path.join('.') || '(root)');
  return [...new Set(paths)].join(', ');
}

function describeFailure(status: number, body: unknown): IpcResult<never> {
  const parsed = apiErrorEnvelopeSchema.safeParse(body);
  const apiCode = parsed.success ? parsed.data.code : undefined;
  const message = parsed.success ? parsed.data.message : undefined;
  const fieldErrors = parsed.success ? (parsed.data.fieldErrors ?? undefined) : undefined;

  log.warn('api_request_failed', { status, apiCode });

  const code = status === HTTP_UNAUTHORIZED ? 'UNAUTHENTICATED' : 'API';
  return ipcFail(code, message ?? 'The server rejected that request.', {
    ...(apiCode === undefined ? {} : { apiCode }),
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
  });
}

interface RequestOptions<TSchema extends z.ZodType> {
  method: 'get' | 'post' | 'put' | 'delete';
  url: string;
  schema: TSchema;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  /** Skip the refresh-and-retry dance for the auth endpoints themselves. */
  allowRefresh?: boolean;
  /** Which service the path belongs to; decides the origin and the unwrapping. */
  service?: ApiService;
}

/**
 * Performs one API call and returns a Result. The response body is parsed
 * against `schema` before it is handed back (OWASP A08).
 */
export async function apiRequest<TSchema extends z.ZodType>(
  options: RequestOptions<TSchema>,
): Promise<IpcResult<z.infer<TSchema>>> {
  const { method, url, schema, body, params, allowRefresh = true, service = 'api' } = options;

  const config: AxiosRequestConfig = {
    method,
    url,
    baseURL: service === 'chat' ? chatBase : baseUrl,
    ...(body === undefined ? {} : { data: body }),
    ...(params === undefined ? {} : { params }),
  };

  let response;
  try {
    response = await requireClient().request(config);
  } catch (error) {
    const reason = error instanceof AxiosError ? error.code : undefined;
    log.error('api_request_errored', { url, reason });
    return ipcFail('NETWORK', 'Could not reach the Yello service.');
  }

  if (response.status === HTTP_UNAUTHORIZED && allowRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest({ ...options, allowRefresh: false });
    }
  }

  if (response.status >= 400) {
    return describeFailure(response.status, response.data);
  }

  // Deletes answer 204 with no body at all — there is no envelope to unwrap.
  if (response.status === HTTP_NO_CONTENT) {
    const empty = schema.safeParse(undefined);
    if (!empty.success) {
      log.error('api_no_content_unexpected', { url });
      return ipcFail('API', 'The server returned an unexpected response.');
    }
    return ipcOk(empty.data);
  }

  // The chat service answers its payload bare; the API wraps it.
  let raw: unknown = response.data;
  if (service === 'api') {
    const envelope = apiEnvelopeSchema.safeParse(response.data);
    if (!envelope.success) {
      log.error('api_envelope_rejected', { url });
      return ipcFail('API', 'The server returned an unexpected response.');
    }
    raw = envelope.data.data;
  }

  const payload = schema.safeParse(raw);
  if (!payload.success) {
    // The field *paths* that failed, not their values: a count alone makes a
    // rejected response undiagnosable, and the values are the part that could
    // carry PII (A09).
    log.error('api_payload_rejected', {
      url,
      issues: payload.error.issues.length,
      fields: describeIssuePaths(payload.error),
    });
    return ipcFail('API', 'The server returned an unexpected response.');
  }

  return ipcOk(payload.data);
}
