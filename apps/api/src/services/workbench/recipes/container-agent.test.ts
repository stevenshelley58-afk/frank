import { describe, expect, it } from 'vitest';

import { missingPublicationDuties } from './container-agent.js';

const plan = `FRANK_PLAN_BEGIN
1. Inspect the project
2. Execute the task
3. Verify the result
FRANK_PLAN_END`;
const receipt = `FRANK_RECEIPT_BEGIN
{"summary":"Verified the result.","assumptions":[],"evidence":["/workspace/out/report.md"]}
FRANK_RECEIPT_END`;

describe('container agent publication repair', () => {
  it('identifies both contractual blocks when a model answers conversationally', () => {
    expect(missingPublicationDuties('Finished.')).toEqual([
      'a 3-10 step FRANK_PLAN block',
      'a valid one-line JSON FRANK_RECEIPT block',
    ]);
  });

  it('asks only for the receipt when the plan was already published', () => {
    expect(missingPublicationDuties(plan)).toEqual([
      'a valid one-line JSON FRANK_RECEIPT block',
    ]);
  });

  it('accepts a complete plan and receipt transcript', () => {
    expect(missingPublicationDuties(`${plan}\n${receipt}`)).toEqual([]);
  });
});
