import { describe, expect, it, vi } from 'vitest';

import type { ApiFetch } from './api';
import { getSkill, listSkills, type SkillDetail } from './skills-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function apiOf(handler: (path: string) => Response): ApiFetch {
  return vi.fn(async (path: string) => handler(path)) as unknown as ApiFetch;
}

const SUMMARY = {
  id: 'creative/ascii-art',
  name: 'ascii-art',
  description: 'ASCII art via pyfiglet.',
  path: 'creative/ascii-art',
  frontmatter_error: null,
};

describe('skills-api', () => {
  it('lists skills through /v1/skills', async () => {
    const api = apiOf((path) => {
      expect(path).toBe('/v1/skills');
      return jsonResponse({ skills: [SUMMARY], total: 1, identifiers: { cell_id: 'cell-steven' } });
    });

    const result = await listSkills(api);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.name).toBe('ascii-art');
    expect(result.total).toBe(1);
  });

  it('fetches one skill via ?path= with the relative path encoded', async () => {
    const api = apiOf((path) => {
      // The encoded slash keeps the multi-segment id a single query value.
      expect(path).toBe('/v1/skills?path=creative%2Fascii-art');
      return jsonResponse({ ...SUMMARY, content: '# ASCII Art\n\nBody.', identifiers: { cell_id: 'cell-steven' } } as SkillDetail);
    });

    const detail = await getSkill(api, 'creative/ascii-art');
    expect(detail.content).toContain('# ASCII Art');
    expect(detail.path).toBe('creative/ascii-art');
  });

  it('fetches a top-level skill id without encoding noise', async () => {
    const api = apiOf((path) => {
      expect(path).toBe('/v1/skills?path=hello-world');
      return jsonResponse({ ...SUMMARY, id: 'hello-world', name: 'hello-world', path: 'hello-world', content: '# Hi', identifiers: { cell_id: 'cell-steven' } });
    });

    const detail = await getSkill(api, 'hello-world');
    expect(detail.id).toBe('hello-world');
  });
});
