-- Chat persistence — the chat-first shell.
--
-- A CHAT IS THE UNIT OF WORK. There is no separate "task" entity: you start a
-- chat in a project, say what you want, and that chat carries the work, its
-- receipts and its history. So `chat_conversation` holds the Frank-shaped facts
-- a conversation needs — which project it belongs to, which agent answers,
-- which model and thinking mode were chosen, whether it is running right now —
-- and `chat_message` holds the turns.
--
-- These are deliberately NOT the `conversation`/`conversation_message` tables
-- from the generated domain schema. Those are the FRANK-§11.2 /ask thread:
-- envelope-encrypted bodies, blind indexes, citations onto `source`. This is
-- the interactive shell's own store, hand-written in the style of 0003_brain,
-- and it stays plaintext because the UI reads it back on every page load and
-- the encrypted thread has a different lifecycle.
--
-- "Waiting on you" is deliberately NOT here. Per ADR-022 an approval is a work
-- item of kind `decision` in `waiting`, resolved with the existing WORK-004
-- verb commands — a parallel approval table would duplicate the state machine,
-- audit trail and optimistic concurrency work items already enforce.

CREATE TABLE "frank_domain"."chat_conversation" (
    -- FRANK-§11.1: the caller mints the identifier (UUIDv7), never a column
    -- default — a replayed create must be able to assert "this is the id I
    -- already used".
    "id" uuid PRIMARY KEY NOT NULL,
    "cell_id" text NOT NULL,
    "owner_id" text NOT NULL,
    -- 'central' for Frank himself, otherwise the room/project id.
    "project_id" text NOT NULL,
    -- The scoped identity that answers here, e.g. 'lotfile-frank'.
    "agent" text NOT NULL,
    "title" text DEFAULT 'New chat' NOT NULL,
    -- Composer state travels with the conversation, not the browser: reopening
    -- a chat tomorrow should restore the model and thinking mode it was using.
    "model" text DEFAULT 'auto' NOT NULL,
    "thinking" text DEFAULT 'off' NOT NULL,
    -- True while a turn or delegated run is in flight — drives the working dot.
    "running" boolean DEFAULT false NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    -- Denormalised so the sidebar can sort without touching chat_message.
    "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "frank_domain"."chat_message" (
    "id" uuid PRIMARY KEY NOT NULL,
    "cell_id" text NOT NULL,
    "conversation_id" uuid NOT NULL
        REFERENCES "frank_domain"."chat_conversation"("id") ON DELETE CASCADE,
    -- 'user' | 'agent' | 'working' | 'delegation' | 'receipt' | 'thinking'.
    -- A wider set than the /ask thread's message_role enum because the shell
    -- renders structured cards, not just turns; kept as text (with a CHECK) so
    -- a new card kind is a migration-free UI change.
    "kind" text NOT NULL,
    "body" text DEFAULT '' NOT NULL,
    -- Card-specific payload: working steps, delegation target, attachments,
    -- the harness that answered, the context-pack hash.
    "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "chat_message_kind_check" CHECK (
        "kind" IN ('user', 'agent', 'working', 'delegation', 'receipt', 'thinking')
    )
);
--> statement-breakpoint

-- FRANK-§2.4 cell isolation is the leading column of every lookup.
-- The sidebar's query is "this owner's chats in this project, newest first".
CREATE INDEX "chat_conversation_scope_idx"
    ON "frank_domain"."chat_conversation" ("cell_id", "owner_id", "project_id", "last_message_at" DESC);
--> statement-breakpoint

-- "What is running anywhere?" — the living frame's Running card. Partial, so it
-- stays small however long the history grows.
CREATE INDEX "chat_conversation_running_idx"
    ON "frank_domain"."chat_conversation" ("cell_id", "owner_id")
    WHERE "running" = true;
--> statement-breakpoint

-- Reading a thread is always "this conversation, in order".
CREATE INDEX "chat_message_thread_idx"
    ON "frank_domain"."chat_message" ("conversation_id", "created_at");
--> statement-breakpoint
