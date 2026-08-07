-- HITL-01 — the workbench decision link (master plan §8F, ADR-022).
--
-- A workbench run may need a human decision mid-flight. HITL-01's rule is that
-- the decision is a NORMAL decision work item (kind `decision`, state
-- `waiting`) — indistinguishable in the API from any other ADR-022 approval —
-- and the workbench PAUSES (state `waiting`) until it is resolved. This table
-- is the ONLY workbench-specific fact: which decision work item belongs to
-- which paused run, and how it was resolved. All canonical state (the decision
-- item's own lifecycle, audit, outbox) stays on `work_item`.
--
-- ## At most one open decision per workbench
--
-- `workbench_decision_pending_uidx` (partial unique index on `workbench_id`
-- WHERE `resolved_at IS NULL`) means a run can hold exactly ONE outstanding
-- decision. A second `requestDecision` while one is open fails at the database
-- — matching the single-pause semantics of WB/HITL-02.
--
-- ## Resolution semantics (HITL-02)
--
-- Resolution arrives through the normal command envelope on the decision work
-- item (`POST /v1/work/{id}/commands/ready` approves, `cancel` denies). When
-- that transition lands, the resolver transitions the linked workbench in the
-- same breath: ready -> workbench resumes (`waiting` -> `running`), cancel ->
-- safe-fail (`waiting` -> `failed` with an honest receipt). `resolution`
-- records which path was taken; `resolved_at` when.
--
-- ## Linkage
--
-- `workbench_id` cascades (a dropped workbench takes its decision links),
-- `decision_work_item_id` restricts (a decision work item that a workbench
-- references is never dropped silently — same convention as 0004's
-- `workbench_work_item_id` FK).

CREATE TABLE "frank_domain"."workbench_decision" (
	"workbench_id" uuid NOT NULL,
	"decision_work_item_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	-- NULL until the decision is resolved through the command envelope.
	"resolved_at" timestamp with time zone,
	-- 'ready' (approved) or 'cancel' (denied); NULL until resolved.
	"resolution" text,
	CONSTRAINT "workbench_decision_pk" PRIMARY KEY("workbench_id","decision_work_item_id"),
	CONSTRAINT "workbench_decision_resolution_valid" CHECK ("resolution" is null or "resolution" in ('ready','cancel'))
);--> statement-breakpoint

ALTER TABLE "frank_domain"."workbench_decision" ADD CONSTRAINT "workbench_decision_workbench_id_workbench_id_fk" FOREIGN KEY ("workbench_id") REFERENCES "frank_domain"."workbench"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."workbench_decision" ADD CONSTRAINT "workbench_decision_decision_work_item_id_work_item_id_fk" FOREIGN KEY ("decision_work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

-- At most one OPEN decision per workbench (single-pause semantics).
CREATE UNIQUE INDEX "workbench_decision_pending_uidx" ON "frank_domain"."workbench_decision" USING btree ("workbench_id") WHERE "resolved_at" is null;--> statement-breakpoint
-- Find a workbench from its decision item (the resolution path).
CREATE UNIQUE INDEX "workbench_decision_item_uidx" ON "frank_domain"."workbench_decision" USING btree ("decision_work_item_id");

-- ---------------------------------------------------------------------------
-- ROLLBACK (per WB-01 rule: migrations include rollback instructions)
--
-- Reverse order, one statement each; then remove this file and the
-- `0005_workbench_decision` entry from migrations/meta/_journal.json:
--
--   DROP INDEX "frank_domain"."workbench_decision_item_uidx";
--   DROP INDEX "frank_domain"."workbench_decision_pending_uidx";
--   ALTER TABLE "frank_domain"."workbench_decision" DROP CONSTRAINT "workbench_decision_decision_work_item_id_work_item_id_fk";
--   ALTER TABLE "frank_domain"."workbench_decision" DROP CONSTRAINT "workbench_decision_workbench_id_workbench_id_fk";
--   DROP TABLE "frank_domain"."workbench_decision";
-- ---------------------------------------------------------------------------
