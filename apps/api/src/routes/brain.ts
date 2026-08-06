/**
 * /v1/brain/search and /v1/brain/save — S8 Second Brain.
 *
 * The Second Brain is a MODULE: a cell-wide knowledge store every room reads
 * from and writes to. Two operations matter: save_to_brain (insert) and
 * search_brain (ranked full-text search).
 *
 * The brain_entry table was added by hand-written migration 0003_brain.sql
 * (not yet in the drizzle schema), so queries use sql template literals
 * through the FrankDatabase handle directly.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { newId, type FrankDatabase } from '@frank/adapter-postgres';
import { sql } from 'drizzle-orm';

import { identifiersOf } from '../context.js';
import { defineRoute, identifiersSchema } from '../schema/registry.js';
import { registerRoute } from '../plugins/route-handler.js';
import type { RouteHandlerDependencies } from '../plugins/route-handler.js';

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const brainSearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  room_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const brainEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  room_id: z.string().nullable(),
  rank: z.number(),
  snippet: z.string().nullable(),
  created_at: z.string(),
});

const brainSearchResponseSchema = z.object({
  results: z.array(brainEntrySchema),
  count: z.number(),
  query: z.string(),
  identifiers: identifiersSchema,
});

const brainSaveBodySchema = z.object({
  title: z.string().min(1).max(500),
  body: z.string().min(1).max(50000),
  tags: z.array(z.string().max(100)).max(20).default([]),
  room_id: z.string().optional(),
  classification: z.enum(['open', 'internal', 'private', 'secret']).default('internal'),
});

const brainSaveResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  identifiers: identifiersSchema,
});

/* ------------------------------------------------------------------ */
/* Route definitions                                                   */
/* ------------------------------------------------------------------ */

export const brainSearchRoute = defineRoute({
  operationId: 'brainSearch',
  method: 'GET',
  path: '/v1/brain/search',
  group: '/v1/brain',
  summary: 'Full-text search across the cell knowledge store',
  description:
    'Ranked full-text search over brain_entry rows scoped to the caller cell. ' +
    'Returns title-weighted results with ts_headline snippets.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'reviewer', 'service_identity'],
  capability: 'brain.search.read',
  dataClasses: ['internal'],
  standingPolicyEligible: true,
  policyOperation: 'brain.search.read',
  idempotency: 'safe',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'internal_error'],
  rateLimit: { requestsPerMinute: 300, burst: 50 },
  auditObligations: [],
  query: brainSearchQuerySchema,
  response: brainSearchResponseSchema,
  successStatus: 200,
});

export const brainSaveRoute = defineRoute({
  operationId: 'brainSave',
  method: 'POST',
  path: '/v1/brain/save',
  group: '/v1/brain',
  summary: 'Save a knowledge entry to the Second Brain',
  description:
    'Inserts a new brain_entry. The tsvector trigger indexes it for search immediately.',
  actorRoles: ['owner', 'operator', 'builder', 'member', 'service_identity'],
  capability: 'brain.entry.write',
  dataClasses: ['internal'],
  standingPolicyEligible: true,
  policyOperation: 'brain.entry.write',
  idempotency: 'required_key',
  consistency: 'read_own_writes',
  errors: ['unauthenticated', 'forbidden', 'internal_error'],
  rateLimit: { requestsPerMinute: 120, burst: 20 },
  auditObligations: ['create'],
  body: brainSaveBodySchema,
  response: brainSaveResponseSchema,
  successStatus: 201,
});

export const brainRoutes = [brainSearchRoute, brainSaveRoute];

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export interface BrainRouteDependencies extends RouteHandlerDependencies {
  readonly db: FrankDatabase;
}

export function registerBrainRoutes(
  app: FastifyInstance,
  dependencies: BrainRouteDependencies,
): void {
  registerRoute(app, dependencies, brainSearchRoute, async ({ query, context }) => {
    const { cellId } = context;
    const { q, room_id, limit } = query;

    const results = await dependencies.db.execute(
      room_id
        ? sql`SELECT id, title, body, tags, room_id, created_at,
                     ts_rank(search_tsv, plainto_tsquery('simple', ${q})) AS rank,
                     ts_headline('simple', body, plainto_tsquery('simple', ${q}),
                       'MaxWords=40, MinWords=15, ShortWord=3, MaxFragments=2') AS snippet
              FROM frank_domain.brain_entry
              WHERE cell_id = ${cellId} AND room_id = ${room_id}
                AND search_tsv @@ plainto_tsquery('simple', ${q})
              ORDER BY rank DESC
              LIMIT ${limit}`
        : sql`SELECT id, title, body, tags, room_id, created_at,
                     ts_rank(search_tsv, plainto_tsquery('simple', ${q})) AS rank,
                     ts_headline('simple', body, plainto_tsquery('simple', ${q}),
                       'MaxWords=40, MinWords=15, ShortWord=3, MaxFragments=2') AS snippet
              FROM frank_domain.brain_entry
              WHERE cell_id = ${cellId}
                AND search_tsv @@ plainto_tsquery('simple', ${q})
              ORDER BY rank DESC
              LIMIT ${limit}`
    );

    const rows = results.rows as Array<{
      id: string; title: string; body: string; tags: string[];
      room_id: string | null; rank: number; snippet: string | null; created_at: Date;
    }>;

    return {
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        tags: r.tags ?? [],
        room_id: r.room_id,
        rank: Number(r.rank),
        snippet: r.snippet,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      })),
      count: rows.length,
      query: q,
      identifiers: identifiersOf(context),
    };
  });

  registerRoute(app, dependencies, brainSaveRoute, async ({ body, context, reply }) => {
    const { cellId, principal } = context;
    const { title, body: entryBody, tags, room_id, classification } = body;
    const ownerId = principal?.principalId ?? context.cellId;

    // Render tags as a Postgres text[] array literal. Interpolating a JS array
    // directly makes drizzle emit one param per element (a record), which the
    // text[] column rejects — so build a single quoted literal instead.
    const tagsLiteral = '{' + tags.map((t) => '"' + t.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';

    const inserted = await dependencies.db.execute(
      // FRANK-§11.1: the caller mints the identifier (UUIDv7) so a replayed
      // save can assert "this is the id I already used".
      sql`INSERT INTO frank_domain.brain_entry (id, cell_id, owner_id, room_id, title, body, tags, classification)
          VALUES (${newId()}, ${cellId}, ${ownerId}, ${room_id ?? null}, ${title}, ${entryBody}, ${tagsLiteral}::text[], ${classification})
          RETURNING id, title, created_at`
    );

    const row = inserted.rows[0] as { id: string; title: string; created_at: Date };
    void reply.code(201);

    return {
      id: row.id,
      title: row.title,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      identifiers: identifiersOf(context),
    };
  });
}
