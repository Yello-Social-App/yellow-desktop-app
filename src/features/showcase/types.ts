/**
 * Project showcase shapes — a KhmerCoder-style gallery of what people built.
 *
 * The records come from the API (see @shared/ipc-types). What lives here is
 * the paging, the query a grid is drawn from, and the form's link rule.
 */
import {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_EMOJIS,
  PROJECT_NAME_MAX,
  PROJECT_TAGLINE_MAX,
  PROJECT_TECH_MAX,
  PROJECT_TECH_NAME_MAX,
  PROJECT_URL_MAX,
  type Project,
  type ProjectEmoji,
  type ProjectSort,
  type TechCount,
} from '@shared/ipc-types';

export const PROJECTS_PAGE_SIZE = 20;
export const PROJECT_TECH_CHIPS = 10;

export type ShowcaseSort = ProjectSort;

export interface ProjectQuery {
  sort: ProjectSort;
  tech?: string | undefined;
  featured?: boolean | undefined;
  size?: number | undefined;
}

/**
 * Accepts an https link only. The server refuses anything else, including
 * plain http, so the form says so before a request is spent on it.
 */
export function httpsUrlOrNull(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.href.length <= PROJECT_URL_MAX ? url.href : null;
  } catch {
    return null;
  }
}

export {
  PROJECT_DESCRIPTION_MAX,
  PROJECT_EMOJIS,
  PROJECT_NAME_MAX,
  PROJECT_TAGLINE_MAX,
  PROJECT_TECH_MAX,
  PROJECT_TECH_NAME_MAX,
};
export type { Project, ProjectEmoji, TechCount };
