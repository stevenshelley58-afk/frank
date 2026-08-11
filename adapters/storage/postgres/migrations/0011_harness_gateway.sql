-- Durable harness configuration, room routing, session lineage and observed capability state.
-- This migration intentionally uses the interactive-shell chat tables from 0010, not /ask.
CREATE UNIQUE INDEX "room_id_cell_uidx" ON "frank_domain"."room" ("id", "cell_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversation_id_cell_uidx" ON "frank_domain"."chat_conversation" ("id", "cell_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_id_cell_uidx" ON "frank_domain"."chat_message" ("id", "cell_id");--> statement-breakpoint
CREATE INDEX "chat_conversation_cell_project_idx" ON "frank_domain"."chat_conversation" ("cell_id", "project_id");--> statement-breakpoint
CREATE INDEX "chat_message_cell_conversation_idx" ON "frank_domain"."chat_message" ("cell_id", "conversation_id", "created_at");--> statement-breakpoint
ALTER TABLE "frank_domain"."chat_conversation" ADD CONSTRAINT "chat_conversation_identity_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("owner_id")) > 0 AND length(btrim("project_id")) > 0 AND length(btrim("agent")) > 0);--> statement-breakpoint
ALTER TABLE "frank_domain"."chat_message" ADD CONSTRAINT "chat_message_identity_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("kind")) > 0);--> statement-breakpoint

CREATE TABLE "frank_domain"."harness_config_revision" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "harness_id" text NOT NULL,
  "revision" integer NOT NULL, "config" jsonb NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('draft','active','superseded','rolled_back')),
  "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" text NOT NULL, "rollback_of" uuid,
  CONSTRAINT "harness_config_revision_uidx" UNIQUE("cell_id","harness_id","revision"),
  CONSTRAINT "harness_config_revision_id_cell_harness_uidx" UNIQUE("id","cell_id","harness_id"),
  CONSTRAINT "harness_config_revision_rollback_fk" FOREIGN KEY("rollback_of","cell_id","harness_id") REFERENCES "frank_domain"."harness_config_revision"("id","cell_id","harness_id") ON DELETE RESTRICT,
  CONSTRAINT "harness_config_revision_positive" CHECK ("revision" >= 1),
  CONSTRAINT "harness_config_revision_config_object" CHECK (jsonb_typeof("config") = 'object' AND "config" <> '{}'::jsonb),
  CONSTRAINT "harness_config_revision_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("harness_id")) > 0 AND length(btrim("created_by")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "harness_config_revision_active_uidx" ON "frank_domain"."harness_config_revision"("cell_id","harness_id") WHERE "status" = 'active';--> statement-breakpoint

CREATE TABLE "frank_domain"."room_route_policy" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "room_id" uuid NOT NULL, "revision" integer NOT NULL,
  "profile" text NOT NULL, "aliases" jsonb NOT NULL, "shadow_mode" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "room_route_policy_revision_uidx" UNIQUE("cell_id","room_id","revision"),
  CONSTRAINT "room_route_policy_room_cell_fk" FOREIGN KEY("room_id","cell_id") REFERENCES "frank_domain"."room"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "room_route_policy_positive" CHECK ("revision" >= 1),
  CONSTRAINT "room_route_policy_aliases_object" CHECK (jsonb_typeof("aliases") = 'object' AND "aliases" <> '{}'::jsonb),
  CONSTRAINT "room_route_policy_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("profile")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "room_route_policy_active_uidx" ON "frank_domain"."room_route_policy"("cell_id","room_id") WHERE "active";--> statement-breakpoint

CREATE TABLE "frank_domain"."harness_session_lineage" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "harness_id" text NOT NULL, "parent_session_id" uuid,
  "external_session_id" text, "checkpoint" jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "harness_session_lineage_id_cell_harness_uidx" UNIQUE("id","cell_id","harness_id"),
  CONSTRAINT "harness_session_lineage_parent_fk" FOREIGN KEY("parent_session_id","cell_id","harness_id") REFERENCES "frank_domain"."harness_session_lineage"("id","cell_id","harness_id") ON DELETE RESTRICT,
  CONSTRAINT "harness_session_lineage_checkpoint_object" CHECK ("checkpoint" IS NULL OR jsonb_typeof("checkpoint") = 'object'),
  CONSTRAINT "harness_session_lineage_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("harness_id")) > 0 AND ("external_session_id" IS NULL OR length(btrim("external_session_id")) > 0))
);--> statement-breakpoint

CREATE TABLE "frank_domain"."model_snapshot" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "model_alias" text NOT NULL, "provider" text NOT NULL,
  "capabilities" jsonb NOT NULL, "price" jsonb NOT NULL, "observed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "model_snapshot_capabilities_object" CHECK (jsonb_typeof("capabilities") = 'object' AND "capabilities" <> '{}'::jsonb),
  CONSTRAINT "model_snapshot_price_object" CHECK (jsonb_typeof("price") = 'object' AND "price" <> '{}'::jsonb),
  CONSTRAINT "model_snapshot_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("model_alias")) > 0 AND length(btrim("provider")) > 0)
);--> statement-breakpoint

CREATE TABLE "frank_domain"."harness_health_observation" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "harness_id" text NOT NULL, "healthy" boolean NOT NULL,
  "failure_class" text, "detail" text, "latency_ms" integer, "expires_at" timestamptz NOT NULL, "observed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "harness_health_latency_nonnegative" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
  CONSTRAINT "harness_health_ttl_strict" CHECK ("expires_at" > "observed_at" AND "expires_at" <= "observed_at" + interval '5 minutes'),
  CONSTRAINT "harness_health_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("harness_id")) > 0 AND ("failure_class" IS NULL OR length(btrim("failure_class")) > 0))
);--> statement-breakpoint
CREATE INDEX "harness_health_ttl_idx" ON "frank_domain"."harness_health_observation"("cell_id","harness_id","expires_at");--> statement-breakpoint

CREATE TABLE "frank_domain"."harness_activation_audit" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "harness_id" text NOT NULL, "revision_id" uuid NOT NULL,
  "action" text NOT NULL CHECK ("action" IN ('promote','rollback')), "created_at" timestamptz NOT NULL DEFAULT now(), "created_by" text NOT NULL,
  CONSTRAINT "harness_activation_audit_revision_cell_harness_fk" FOREIGN KEY("revision_id","cell_id","harness_id") REFERENCES "frank_domain"."harness_config_revision"("id","cell_id","harness_id") ON DELETE RESTRICT,
  CONSTRAINT "harness_activation_audit_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("harness_id")) > 0 AND length(btrim("created_by")) > 0)
);
