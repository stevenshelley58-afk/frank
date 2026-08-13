/**
 * W3-2 skills routes — contract tests against a tiny fixture library.
 *
 * The fixture is built in a temp directory and pointed at via
 * `FRANK_SKILLS_ROOT` (the documented test seam); the real Hermes store is
 * never touched. Routes are registered directly on the built server because
 * the `server.ts` composition-root registration is a coordinator hot-file
 * applied at the wave gate — see `.build/tasks/W3-2.md`.
 *
 * What is proven here, per the packet's done-when:
 *   - every skill folder appears with name + description (list);
 *   - `?path=` fetches one skill's SKILL.md content (the packet contract);
 *   - a skill with malformed frontmatter surfaces `frontmatter_error` and
 *     never crashes the request;
 *   - ids cannot escape the root (`..`, absolute, drive-letter, backslash);
 *   - unknown skills 404; a missing library 503s.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { POLICY_VERSION } from '@frank/policy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerSkillRoutes, skillRoutes } from '../routes/skills.js';
import { buildTestServer, TEST_CELL, TEST_NOW } from './harness.js';
import type { TestServer } from './harness.js';

let server: TestServer | undefined;
let fixtureRoot: string;

async function writeSkill(relativeDir: string, body: string): Promise<void> {
  const dir = join(fixtureRoot, relativeDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), body, 'utf8');
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'frank-skills-fixture-'));
  await writeSkill(
    'good',
    [
      '---',
      'name: good-skill',
      'description: A well-formed skill with a description.',
      '---',
      '',
      '# Good Skill',
      '',
      'Body paragraph that proves content is returned.',
    ].join('\n'),
  );
  // Invalid YAML inside a closed fence: gray-matter throws.
  await writeSkill(
    'broken',
    ['---', 'name: broken', 'description: [unclosed', '---', '', '# Broken Skill', '', 'Still readable as raw text.'].join('\n'),
  );
  // No frontmatter at all — description falls back to the first paragraph.
  await writeSkill('nofront', ['# No Frontmatter', '', 'Just a body with a description.', '', 'Second paragraph.'].join('\n'));
  // Multi-segment (categorised) skill.
  await writeSkill('nested/sub/deep', ['---', 'description: Nested skill description.', '---', '', '# Deep', '', 'Deep body.'].join('\n'));
  // A directory that is not a skill (no SKILL.md) — must not appear.
  await mkdir(join(fixtureRoot, 'not-a-skill'), { recursive: true });
  process.env.FRANK_SKILLS_ROOT = fixtureRoot;
});

afterEach(async () => {
  delete process.env.FRANK_SKILLS_ROOT;
  if (server !== undefined) {
    await server.close();
    server = undefined;
  }
  await rm(fixtureRoot, { recursive: true, force: true });
});

function start(): TestServer {
  server = buildTestServer();
  registerSkillRoutes(server.app, {
    cellId: TEST_CELL,
    policyVersion: POLICY_VERSION,
    identity: server.identityProvider,
    now: () => TEST_NOW,
  });
  return server;
}

type SkillSummary = {
  id: string;
  name: string;
  description: string;
  path: string;
  frontmatter_error: string | null;
};

function summaryById(body: { skills: SkillSummary[] }, id: string): SkillSummary {
  const skill = body.skills.find((entry) => entry.id === id);
  if (skill === undefined) throw new Error(`fixture skill ${id} missing from the list`);
  return skill;
}

describe('W3-2 skills list', () => {
  it('registers exactly the two declared route operations', () => {
    expect(skillRoutes).toHaveLength(2);
    expect(skillRoutes.map((route) => route.operationId).sort()).toEqual(['skillsDetail', 'skillsList']);
    expect(new Set(skillRoutes.map((route) => route.operationId)).size).toBe(2);
  });

  it('requires authentication (FRANK-§15.2)', async () => {
    const target = start();
    const response = await target.app.inject({ method: 'GET', url: '/v1/skills' });
    expect(response.statusCode).toBe(401);
  });

  it('lists every skill folder with its name and description, sorted by path', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills',
      headers: { authorization: target.auth(['owner']) },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { skills: SkillSummary[]; total: number; identifiers: unknown };
    expect(body.total).toBe(4);
    expect(body.skills.map((entry) => entry.id)).toEqual(['broken', 'good', 'nested/sub/deep', 'nofront']);

    const good = summaryById(body, 'good');
    expect(good.name).toBe('good');
    expect(good.description).toBe('A well-formed skill with a description.');
    expect(good.path).toBe('good');
    expect(good.frontmatter_error).toBeNull();

    const nested = summaryById(body, 'nested/sub/deep');
    expect(nested.name).toBe('deep');
    expect(nested.description).toBe('Nested skill description.');
    expect(nested.path).toBe('nested/sub/deep');

    // A directory without SKILL.md is not a skill.
    expect(body.skills.some((entry) => entry.id === 'not-a-skill')).toBe(false);
    // The FRANK-§12.1 identifier block rides along.
    expect(body.identifiers).toMatchObject({ cell_id: TEST_CELL, actor_id: 'user/steven' });
  });

  it('falls back to the first paragraph when a skill has no frontmatter', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills',
      headers: { authorization: target.auth(['owner']) },
    });
    const body = response.json() as { skills: SkillSummary[] };
    const nofront = summaryById(body, 'nofront');
    expect(nofront.description).toContain('Just a body with a description.');
    expect(nofront.frontmatter_error).toBeNull();
  });

  it('shows a skill with malformed frontmatter as an error card, not a crash', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { skills: SkillSummary[] };
    const broken = summaryById(body, 'broken');
    expect(broken.name).toBe('broken');
    expect(broken.frontmatter_error).toEqual(expect.any(String));
    expect(broken.frontmatter_error!.length).toBeGreaterThan(0);
  });

  it('returns a 503 when the skills library is missing', async () => {
    process.env.FRANK_SKILLS_ROOT = join(fixtureRoot, 'does-not-exist');
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(503);
  });
});

describe('W3-2 skill detail', () => {
  it('returns the rendered-markdown source via ?path= (packet contract)', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills?path=good',
      headers: { authorization: target.auth(['owner']) },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      id: string;
      name: string;
      description: string;
      path: string;
      content: string;
      frontmatter_error: string | null;
    };
    expect(body.id).toBe('good');
    expect(body.name).toBe('good');
    expect(body.description).toBe('A well-formed skill with a description.');
    // Frontmatter is stripped; the body is what gets rendered.
    expect(body.content).toContain('# Good Skill');
    expect(body.content).toContain('Body paragraph that proves content is returned.');
    expect(body.content).not.toContain('A well-formed skill');
    expect(body.frontmatter_error).toBeNull();
  });

  it('resolves multi-segment paths through ?path=', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills?path=nested/sub/deep',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { path: string; content: string };
    expect(body.path).toBe('nested/sub/deep');
    expect(body.content).toContain('Deep body.');
  });

  it('serves the same detail through GET /v1/skills/:id', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills/good',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: string; content: string };
    expect(body.id).toBe('good');
    expect(body.content).toContain('# Good Skill');
  });

  it('returns raw text plus frontmatter_error for a broken SKILL.md', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills?path=broken',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { content: string; frontmatter_error: string | null };
    expect(body.frontmatter_error).toEqual(expect.any(String));
    // The user can still read the skill; the error card explains the banner.
    expect(body.content).toContain('Still readable as raw text.');
  });

  it('404s for an unknown skill', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills?path=no-such-skill',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(404);
  });

  it('404s for a directory that has no SKILL.md', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills?path=not-a-skill',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('W3-2 path safety', () => {
  const ESCAPE_IDS = [
    '../escape',
    '..',
    'good/../../escape',
    '/etc/passwd',
    'C:/Windows/System32',
    'c:\\Windows\\System32',
    'good\\..\\escape',
    '',
  ];

  it.each(ESCAPE_IDS)('rejects an escaping id (%j) with 400 validation_failed', async (id) => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: `/v1/skills?path=${encodeURIComponent(id)}`,
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(400);
    const problem = response.json() as { type: string };
    expect(problem.type).toMatch(/validation-failed$/);
  });

  it.each(ESCAPE_IDS)('rejects an escaping :id (%j) with 400 validation_failed', async (id) => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: `/v1/skills/${encodeURIComponent(id)}`,
      headers: { authorization: target.auth(['owner']) },
    });
    // `..` decodes to a literal dot-segment request; either a validation
    // refusal (400) or no route match (404) is a refusal to read outside.
    expect([400, 404]).toContain(response.statusCode);
  });

  it('never includes the resolved filesystem path in the response', async () => {
    const target = start();
    const response = await target.app.inject({
      method: 'GET',
      url: '/v1/skills',
      headers: { authorization: target.auth(['owner']) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(fixtureRoot);
  });
});
