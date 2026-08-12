-- Ordered, idempotent API-owned chat turns. Event cursors are durable and resumable.
CREATE TABLE "frank_domain"."chat_turn" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "conversation_id" uuid NOT NULL, "room_id" uuid,
  "user_message_id" uuid, "assistant_message_id" uuid, "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL, "input" jsonb NOT NULL,
  "state" text NOT NULL CHECK ("state" IN ('queued','running','completed','failed','cancelled')),
  "cancelled_at" timestamptz, "finished_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chat_turn_conversation_cell_fk" FOREIGN KEY("conversation_id","cell_id") REFERENCES "frank_domain"."chat_conversation"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "chat_turn_room_cell_fk" FOREIGN KEY("room_id","cell_id") REFERENCES "frank_domain"."room"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "chat_turn_user_message_cell_fk" FOREIGN KEY("user_message_id","cell_id") REFERENCES "frank_domain"."chat_message"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "chat_turn_assistant_message_cell_fk" FOREIGN KEY("assistant_message_id","cell_id") REFERENCES "frank_domain"."chat_message"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "chat_turn_idempotency_uidx" UNIQUE("cell_id","conversation_id","idempotency_key"),
  CONSTRAINT "chat_turn_request_hash" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'), CONSTRAINT "chat_turn_input_object" CHECK (jsonb_typeof("input") = 'object' AND "input" <> '{}'::jsonb),
  CONSTRAINT "chat_turn_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("idempotency_key")) > 0),
  CONSTRAINT "chat_turn_terminal_finished_paired" CHECK (("state" IN ('completed','failed','cancelled')) = ("finished_at" IS NOT NULL)),
  CONSTRAINT "chat_turn_cancelled_state_paired" CHECK (("state" = 'cancelled') = ("cancelled_at" IS NOT NULL)),
  CONSTRAINT "chat_turn_finished_after_created" CHECK ("finished_at" IS NULL OR "finished_at" >= "created_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turn_id_cell_uidx" ON "frank_domain"."chat_turn"("id","cell_id");--> statement-breakpoint
ALTER TABLE "frank_domain"."harness_session_lineage" ADD CONSTRAINT "harness_session_lineage_turn_cell_fk" FOREIGN KEY("turn_id","cell_id") REFERENCES "frank_domain"."chat_turn"("id","cell_id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE TABLE "frank_domain"."chat_turn_event" (
  "turn_id" uuid NOT NULL, "cell_id" text NOT NULL, "cursor" integer NOT NULL, "kind" text NOT NULL, "payload" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY("turn_id","cursor"),
  CONSTRAINT "chat_turn_event_turn_cell_fk" FOREIGN KEY("turn_id","cell_id") REFERENCES "frank_domain"."chat_turn"("id","cell_id") ON DELETE CASCADE,
  CONSTRAINT "chat_turn_event_cursor_nonnegative" CHECK ("cursor" >= 0), CONSTRAINT "chat_turn_event_payload_object" CHECK (jsonb_typeof("payload") = 'object' AND "payload" <> '{}'::jsonb),
  CONSTRAINT "chat_turn_event_kind_not_blank" CHECK (length(btrim("kind")) > 0 AND length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."chat_turn_receipt" (
  "turn_id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "receipt" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chat_turn_receipt_turn_cell_fk" FOREIGN KEY("turn_id","cell_id") REFERENCES "frank_domain"."chat_turn"("id","cell_id") ON DELETE CASCADE,
  CONSTRAINT "chat_turn_receipt_object" CHECK (jsonb_typeof("receipt") = 'object' AND "receipt" <> '{}'::jsonb), CONSTRAINT "chat_turn_receipt_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."harness_fallback_attempt" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "turn_id" uuid NOT NULL, "attempt" integer NOT NULL, "harness_id" text NOT NULL, "upstream" text, "outcome" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "harness_fallback_attempt_uidx" UNIQUE("turn_id","attempt"), CONSTRAINT "harness_fallback_attempt_turn_cell_fk" FOREIGN KEY("turn_id","cell_id") REFERENCES "frank_domain"."chat_turn"("id","cell_id") ON DELETE CASCADE,
  CONSTRAINT "harness_fallback_attempt_positive" CHECK ("attempt" >= 1), CONSTRAINT "harness_fallback_attempt_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("harness_id")) > 0 AND length(btrim("outcome")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."chat_turn_checkpoint" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "turn_id" uuid NOT NULL, "cursor" integer NOT NULL, "checkpoint" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chat_turn_checkpoint_turn_cell_fk" FOREIGN KEY("turn_id","cell_id") REFERENCES "frank_domain"."chat_turn"("id","cell_id") ON DELETE CASCADE,
  CONSTRAINT "chat_turn_checkpoint_uidx" UNIQUE("turn_id","cursor"), CONSTRAINT "chat_turn_checkpoint_cursor_nonnegative" CHECK ("cursor" >= 0), CONSTRAINT "chat_turn_checkpoint_object" CHECK (jsonb_typeof("checkpoint") = 'object' AND "checkpoint" <> '{}'::jsonb), CONSTRAINT "chat_turn_checkpoint_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."harness_job" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "owner_id" text NOT NULL, "room_id" uuid,
  "idempotency_key" text NOT NULL, "request_hash" text NOT NULL,
  "harness" text NOT NULL CHECK ("harness" = 'hermes'), "task_type" text NOT NULL CHECK ("task_type" = 'browser-research'),
  "scope" jsonb NOT NULL, "input" jsonb NOT NULL, "allowed_tools" jsonb NOT NULL,
  "egress_profile" text NOT NULL CHECK ("egress_profile" IN ('research-public','research-allowlist')),
  "status" text NOT NULL CHECK ("status" IN ('queued','running','completed','failed','cancelled')),
  "cancelled_at" timestamptz, "finished_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "harness_job_room_cell_fk" FOREIGN KEY("room_id","cell_id") REFERENCES "frank_domain"."room"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "harness_job_idempotency_uidx" UNIQUE("cell_id","owner_id","idempotency_key"),
  CONSTRAINT "harness_job_request_hash" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'), CONSTRAINT "harness_job_scope_object" CHECK (jsonb_typeof("scope") = 'object' AND "scope" ? 'cell_id' AND "scope" ? 'owner_id' AND jsonb_typeof("scope"->'cell_id') = 'string' AND jsonb_typeof("scope"->'owner_id') = 'string' AND length(btrim("scope"->>'cell_id')) > 0 AND length(btrim("scope"->>'owner_id')) > 0 AND "scope"->>'cell_id' = "cell_id" AND "scope"->>'owner_id' = "owner_id" AND (NOT ("scope" ? 'project_id') OR (jsonb_typeof("scope"->'project_id') = 'string' AND length(btrim("scope"->>'project_id')) > 0)) AND (NOT ("scope" ? 'room_id') OR (jsonb_typeof("scope"->'room_id') = 'string' AND length(btrim("scope"->>'room_id')) > 0)) AND (("room_id" IS NULL AND NOT ("scope" ? 'room_id')) OR "scope"->>'room_id' = "room_id"::text)),
  CONSTRAINT "harness_job_input_object" CHECK (jsonb_typeof("input") = 'object' AND "input" <> '{}'::jsonb), CONSTRAINT "harness_job_tools_array" CHECK (jsonb_typeof("allowed_tools") = 'array' AND jsonb_array_length("allowed_tools") > 0),
  CONSTRAINT "harness_job_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("owner_id")) > 0 AND length(btrim("idempotency_key")) > 0),
  CONSTRAINT "harness_job_terminal_finished_paired" CHECK (("status" IN ('completed','failed','cancelled')) = ("finished_at" IS NOT NULL)), CONSTRAINT "harness_job_cancelled_state_paired" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)), CONSTRAINT "harness_job_finished_after_created" CHECK ("finished_at" IS NULL OR "finished_at" >= "created_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "harness_job_id_cell_uidx" ON "frank_domain"."harness_job"("id","cell_id");--> statement-breakpoint
CREATE TABLE "frank_domain"."harness_job_event" (
  "job_id" uuid NOT NULL, "cell_id" text NOT NULL, "cursor" integer NOT NULL, "kind" text NOT NULL CHECK ("kind" IN ('progress','artifact','error','terminal')), "payload" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY("job_id","cursor"), CONSTRAINT "harness_job_event_job_cell_fk" FOREIGN KEY("job_id","cell_id") REFERENCES "frank_domain"."harness_job"("id","cell_id") ON DELETE CASCADE,
  CONSTRAINT "harness_job_event_cursor_nonnegative" CHECK ("cursor" >= 0), CONSTRAINT "harness_job_event_payload_object" CHECK (jsonb_typeof("payload") = 'object' AND "payload" <> '{}'::jsonb), CONSTRAINT "harness_job_event_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."harness_job_cancel" (
  "job_id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "requested_by" text NOT NULL,
  "idempotency_key" text NOT NULL, "request_hash" text NOT NULL, "reason" text, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "harness_job_cancel_job_cell_fk" FOREIGN KEY("job_id","cell_id") REFERENCES "frank_domain"."harness_job"("id","cell_id") ON DELETE CASCADE,
  CONSTRAINT "harness_job_cancel_request_hash" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "harness_job_cancel_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("requested_by")) > 0 AND length(btrim("idempotency_key")) > 0 AND ("reason" IS NULL OR length(btrim("reason")) > 0))
);--> statement-breakpoint
CREATE TABLE "frank_domain"."harness_job_receipt" (
  "job_id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "receipt" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "harness_job_receipt_job_cell_fk" FOREIGN KEY("job_id","cell_id") REFERENCES "frank_domain"."harness_job"("id","cell_id") ON DELETE CASCADE, CONSTRAINT "harness_job_receipt_object" CHECK (jsonb_typeof("receipt") = 'object' AND "receipt" <> '{}'::jsonb), CONSTRAINT "harness_job_receipt_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);
