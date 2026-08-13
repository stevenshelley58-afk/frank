-- W1-2 (memory system removal): the legacy brain_* tables were created
-- outside the tracked migration history by the deleted @frank/memory
-- (mem0) system. Rename them to legacy_brain_* so nothing references the
-- old names. Row counts verified on prod DB 2026-08-13: brain_assertions 0,
-- brain_entities 0, brain_links 0, brain_memories 0, brain_sources 0.
ALTER TABLE "brain_assertions" RENAME TO "legacy_brain_assertions";--> statement-breakpoint
ALTER TABLE "brain_entities" RENAME TO "legacy_brain_entities";--> statement-breakpoint
ALTER TABLE "brain_links" RENAME TO "legacy_brain_links";--> statement-breakpoint
ALTER TABLE "brain_memories" RENAME TO "legacy_brain_memories";--> statement-breakpoint
ALTER TABLE "brain_sources" RENAME TO "legacy_brain_sources";
