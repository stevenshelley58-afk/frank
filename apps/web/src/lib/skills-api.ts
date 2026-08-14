import type { ApiFetch, Identifiers } from './api';

/**
 * W3-2 skills page client — read-only browser over the Hermes skill library.
 *
 * Both calls go through the authenticated web BFF (`/api/v1/*` rewrite inside
 * `makeApiFetch`), so no token material ever appears in this module.
 */

export interface SkillSummary {
  /** Relative path from the skills root; the stable identity. */
  id: string;
  /** Folder name. */
  name: string;
  /** Frontmatter `description`, or the first paragraph of the body. */
  description: string;
  /** Relative path from the skills root (same value as `id`). */
  path: string;
  /** Non-null when the SKILL.md frontmatter could not be parsed. */
  frontmatter_error: string | null;
}

export interface SkillsListResponse {
  skills: SkillSummary[];
  total: number;
  identifiers: Identifiers;
}

export interface SkillDetail extends SkillSummary {
  /** The SKILL.md body (frontmatter stripped), ready for react-markdown. */
  content: string;
}

/** List every skill. One small read per skill on the server; no content. */
export async function listSkills(api: ApiFetch): Promise<SkillsListResponse> {
  const response = await api('/v1/skills', { cache: 'no-store' });
  return (await response.json()) as SkillsListResponse;
}

/**
 * Fetch one skill's rendered-markdown source. `path` is the relative skill
 * path (e.g. `creative/ascii-art`) — encoded, so multi-segment ids survive
 * the BFF proxy as a single query value.
 */
export async function getSkill(api: ApiFetch, path: string): Promise<SkillDetail> {
  const response = await api(`/v1/skills?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  return (await response.json()) as SkillDetail;
}
