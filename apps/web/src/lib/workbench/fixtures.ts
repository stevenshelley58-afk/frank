/**
 * Fixtures for the workbench surfaces — dev/mock mode only.
 *
 * Shapes are EXACTLY the frozen contract's SSE envelope:
 *   { seq, type, at, payload }
 * with `type` from the fixed event list. Used by the dev preview route and
 * the unit tests so the UI is verifiable without the WB backend.
 */

import type { WorkbenchEvent, WorkbenchRecord } from './types';

/** Now-relative base so the demo's elapsed clock looks live on load. */
const T0 = Date.now() - 200_000;

function at(offsetSec: number): string {
  return new Date(T0 + offsetSec * 1000).toISOString().replace('.000Z', 'Z');
}

/** A realistic run that has reached step 3/5 and is mid-note. */
export const RUNNING_SNAPSHOT: WorkbenchEvent[] = [
  { seq: 1, type: 'workbench_created', at: at(0), payload: { workItemId: 'wi-2231' } },
  { seq: 2, type: 'provisioning_started', at: at(2), payload: {} },
  { seq: 3, type: 'provisioned', at: at(9), payload: {} },
  {
    seq: 4,
    type: 'plan_published',
    at: at(12),
    payload: {
      steps: [
        { title: 'Pull the Meta ad library export' },
        { title: 'Normalize into research DB' },
        { title: 'Tag creatives with LLM' },
        { title: 'Score swipe-file candidates' },
        { title: 'Publish digest + receipt' },
      ],
    },
  },
  { seq: 5, type: 'step_updated', at: at(14), payload: { step: 1, state: 'doing', note: 'Fetching actor run…' } },
  { seq: 6, type: 'step_updated', at: at(95), payload: { step: 1, state: 'done', note: '1,204 ads fetched.' } },
  { seq: 7, type: 'step_updated', at: at(97), payload: { step: 2, state: 'doing', note: 'Upserting rows…' } },
  { seq: 8, type: 'step_updated', at: at(180), payload: { step: 2, state: 'done', note: 'Deduped 83 dupes.' } },
  { seq: 9, type: 'step_updated', at: at(182), payload: { step: 3, state: 'doing', note: 'Tagging batch 1/4…' } },
  {
    seq: 10,
    type: 'artifact_registered',
    at: at(190),
    payload: { id: 'art-9', name: 'raw-ads.jsonl', kind: 'data', path: '/artifacts/raw-ads.jsonl' },
  },
];

/** Live events streamed after the snapshot in the dev preview. */
export const RUNNING_LIVE: WorkbenchEvent[] = [
  { seq: 11, type: 'step_updated', at: at(196), payload: { step: 3, state: 'done', note: 'All 4 batches tagged.' } },
  { seq: 12, type: 'step_updated', at: at(198), payload: { step: 4, state: 'doing', note: 'Scoring swipe-file candidates…' } },
  {
    seq: 13,
    type: 'artifact_registered',
    at: at(200),
    payload: { id: 'art-10', name: 'scores.csv', kind: 'data', path: '/artifacts/scores.csv' },
  },
  { seq: 14, type: 'step_updated', at: at(202), payload: { step: 4, state: 'done', note: 'Top 12 scored.' } },
  { seq: 15, type: 'step_updated', at: at(203), payload: { step: 5, state: 'doing', note: 'Composing digest…' } },
  {
    seq: 16,
    type: 'receipt_published',
    at: at(206),
    payload: {
      receipt: {
        workbenchId: 'wb-demo-running',
        workItemId: 'wi-2231',
        whatDone: 'Ingested the Meta ad library export, tagged 1,121 creatives, scored the swipe file.',
        found: '38% of new creatives reuse the UGC-hook pattern; 12 candidates score above 0.8.',
        decisions: ['Kept the 83 near-duplicates out of the research DB.'],
        assumptions: ['Actor run cost assumed under $2 (within the standing limit).'],
        evidence: ['/artifacts/raw-ads.jsonl', '/artifacts/scores.csv'],
        completedAt: at(206),
      },
    },
  },
  { seq: 17, type: 'completed', at: at(207), payload: {} },
];

/** Snapshot for a run that hit a decision request and is paused/waiting. */
export const WAITING_SNAPSHOT: WorkbenchEvent[] = [
  { seq: 1, type: 'workbench_created', at: at(0), payload: { workItemId: 'wi-2240' } },
  { seq: 2, type: 'provisioning_started', at: at(1), payload: {} },
  { seq: 3, type: 'provisioned', at: at(6), payload: {} },
  {
    seq: 4,
    type: 'plan_published',
    at: at(8),
    payload: { steps: [{ title: 'Draft the ChannelPort launch email' }, { title: 'Send via the bound channel' }] },
  },
  { seq: 5, type: 'step_updated', at: at(10), payload: { step: 1, state: 'doing', note: 'Drafting…' } },
  { seq: 6, type: 'step_updated', at: at(60), payload: { step: 1, state: 'done', note: 'Draft ready.' } },
  {
    seq: 7,
    type: 'decision_requested',
    at: at(61),
    payload: {
      workItemId: 'wi-2241',
      question: 'Send the ChannelPort launch email to the full list (12,400 recipients) now?',
      whyNow: 'The send window closes at 11:00 UTC; the draft is final and approval is the only gate left.',
      nextSafeAction: 'Approve or reject the send from the decision work item — the workbench stays paused.',
      evidence: ['/drafts/channelport-launch-email.md'],
    },
  },
  { seq: 8, type: 'paused', at: at(61), payload: { reason: 'Waiting on decision wi-2241' } },
];

/** Completed run used to exercise the receipt + terminal state display. */
export const DONE_SNAPSHOT: WorkbenchEvent[] = [
  { seq: 1, type: 'workbench_created', at: at(0), payload: { workItemId: 'wi-2204' } },
  { seq: 2, type: 'provisioned', at: at(4), payload: {} },
  {
    seq: 3,
    type: 'plan_published',
    at: at(5),
    payload: { steps: [{ title: 'Rotate the Apify actor key' }, { title: 'Re-run the trigger' }] },
  },
  { seq: 4, type: 'step_updated', at: at(6), payload: { step: 1, state: 'doing', note: 'Rotating…' } },
  { seq: 5, type: 'step_updated', at: at(30), payload: { step: 1, state: 'done' } },
  { seq: 6, type: 'step_updated', at: at(31), payload: { step: 2, state: 'doing', note: 'Triggering…' } },
  { seq: 7, type: 'step_updated', at: at(70), payload: { step: 2, state: 'done', note: 'Run accepted.' } },
  {
    seq: 8,
    type: 'receipt_published',
    at: at(71),
    payload: {
      receipt: {
        workbenchId: 'wb-demo-done',
        workItemId: 'wi-2204',
        whatDone: 'Rotated the Apify actor key and re-ran the research trigger.',
        found: 'Trigger accepted; next fetch due in 20 minutes.',
        decisions: [],
        assumptions: ['Old key revoked immediately (no grace window).'],
        evidence: ['/audit/apify-key-rotation'],
        completedAt: at(71),
      },
    },
  },
  { seq: 9, type: 'completed', at: at(72), payload: {} },
];

/** GET /v1/rooms/:roomId/workbenches fixture (GAP shapes, permissive). */
export const ROOM_WORKBENCHES: WorkbenchRecord[] = [
  {
    id: 'wb-demo-running',
    workItemId: 'wi-2231',
    state: 'running',
    version: 17,
    roomId: 'blockwise',
    task: { id: 'task-31', title: 'Ingest Meta ad library export into research DB' },
    createdAt: at(0),
  },
  {
    id: 'wb-demo-waiting',
    workItemId: 'wi-2240',
    state: 'paused',
    version: 8,
    roomId: 'blockwise',
    task: { id: 'task-40', title: 'ChannelPort launch email' },
    createdAt: at(0),
  },
  {
    id: 'wb-demo-done',
    workItemId: 'wi-2204',
    state: 'completed',
    version: 9,
    roomId: 'blockwise',
    task: { id: 'task-04', title: 'Rotate Apify key + re-run trigger' },
    createdAt: at(0),
  },
];
