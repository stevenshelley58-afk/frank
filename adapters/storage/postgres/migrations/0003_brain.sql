-- S8 — the Second Brain: a cell-wide knowledge store with full-text search.
--
-- The Second Brain is a MODULE, not a room: a resource every room's Frank reads
-- from and writes to from anywhere. It holds KNOWING (facts, notes, context)
-- while rooms are for DOING. Two operations matter: save_to_brain (insert) and
-- search_brain (ranked full-text search).
--
-- This migration is the hand-written invariants layer in the style of
-- 0001/0002: it adds what the generated domain schema does not express —
-- a tsvector column, a GIN index over it, and a trigger that keeps the
-- index column in sync with title/body/tags on every insert and update.

CREATE TABLE "frank_domain"."brain_entry" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "cell_id" text NOT NULL,
    "owner_id" text NOT NULL,
    "room_id" text,
    "title" text NOT NULL,
    "body" text NOT NULL,
    "tags" text[] DEFAULT '{}' NOT NULL,
    "classification" text DEFAULT 'internal' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- FRANK-§2.4 cell isolation, plus per-owner scoping: the primary lookup for a
-- room's Frank is "what do I (and my cell) know?".
CREATE INDEX "brain_entry_cell_owner_idx" ON "frank_domain"."brain_entry" ("cell_id", "owner_id");
--> statement-breakpoint

-- Optional room scoping — entries are findable by the room they came from.
CREATE INDEX "brain_entry_room_idx" ON "frank_domain"."brain_entry" ("cell_id", "room_id");
--> statement-breakpoint

-- The full-text index column. A stored tsvector (not an expression index) so the
-- ranked search query can ts_rank it and ts_headline it without recomputing the
-- parse on every row. Kept in sync by the trigger below.
ALTER TABLE "frank_domain"."brain_entry" ADD COLUMN "search_tsv" tsvector;
--> statement-breakpoint

CREATE INDEX "brain_entry_search_idx" ON "frank_domain"."brain_entry" USING gin ("search_tsv");
--> statement-breakpoint

-- Backfill the index column for any rows present before the trigger existed.
UPDATE "frank_domain"."brain_entry"
SET "search_tsv" =
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("body", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(array_to_string("tags", ' '), '')), 'A');
--> statement-breakpoint

-- Keep search_tsv aligned with the text it indexes, on insert and update.
CREATE OR REPLACE FUNCTION "frank_domain"."brain_entry_search_tsv"()
RETURNS trigger AS $$
BEGIN
    NEW."search_tsv" :=
        setweight(to_tsvector('simple', coalesce(NEW."title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(NEW."body", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(array_to_string(NEW."tags", ' '), '')), 'A');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "brain_entry_search_tsv_trigger"
BEFORE INSERT OR UPDATE OF "title", "body", "tags" ON "frank_domain"."brain_entry"
FOR EACH ROW EXECUTE FUNCTION "frank_domain"."brain_entry_search_tsv"();
