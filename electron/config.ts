/**
 * Main-process configuration.
 *
 * The API base URL lives here rather than in a VITE_* variable because the HTTP
 * client runs in the main process. Resolution order:
 *
 *   1. YELLO_API_BASE_URL — a full URL, wins outright (ad-hoc overrides);
 *   2. YELLO_API_TARGET   — a name from API_TARGETS below (`local`, `dev`, `prod`);
 *   3. DEFAULT_API_TARGET.
 *
 * `npm run dev:local` / `dev:prod` and `package:prod` set the target for you;
 * `npm run dev` uses the default. To point at a new server, edit API_TARGETS.
 */
export const API_TARGETS = {
  local: 'http://localhost:8080',
  dev: 'https://dev.yello-api.cachewraith.com',
  prod: 'https://yello-api.cachewraith.com',
} as const;

export type ApiTarget = keyof typeof API_TARGETS;

const DEFAULT_API_TARGET: ApiTarget = 'dev';

/**
 * Where uploaded media (avatars, post images) is served from. This is the R2
 * bucket the API redirects to, a different origin than the API itself, so it
 * needs its own CSP `img-src` entry. Comma-separated so more than one CDN can be
 * allowed without a code change; operator-overridable per environment.
 */
const DEFAULT_IMAGE_BASE_URLS = 'https://pub-bbc7c2fe34614a5794960788c8da82e1.r2.dev';

function isApiTarget(value: string): value is ApiTarget {
  return Object.prototype.hasOwnProperty.call(API_TARGETS, value);
}

export function apiTargetFromEnvironment(): ApiTarget {
  const configured = process.env.YELLO_API_TARGET;
  if (configured === undefined || configured === '') {
    return DEFAULT_API_TARGET;
  }
  if (!isApiTarget(configured)) {
    throw new Error(
      `Unknown YELLO_API_TARGET "${configured}". Expected one of: ${Object.keys(API_TARGETS).join(', ')}.`,
    );
  }
  return configured;
}

export function apiBaseUrlFromEnvironment(): string {
  const configured = process.env.YELLO_API_BASE_URL;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  return API_TARGETS[apiTargetFromEnvironment()];
}

/** The distinct image origins to allow, as an array (empty entries dropped). */
export function imageBaseUrlsFromEnvironment(): string[] {
  const configured = process.env.YELLO_IMAGE_BASE_URLS;
  const raw = configured === undefined || configured === '' ? DEFAULT_IMAGE_BASE_URLS : configured;
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}
