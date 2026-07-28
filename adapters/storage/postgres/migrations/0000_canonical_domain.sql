CREATE SCHEMA "frank_domain";
--> statement-breakpoint
CREATE TYPE "frank_domain"."actor_kind" AS ENUM('user', 'agent', 'agent_team', 'external_system', 'service');--> statement-breakpoint
CREATE TYPE "frank_domain"."conflict_state" AS ENUM('none', 'local_ahead', 'remote_ahead', 'diverged', 'unresolvable');--> statement-breakpoint
CREATE TYPE "frank_domain"."data_class" AS ENUM('open', 'internal', 'private', 'sensitive', 'secret');--> statement-breakpoint
CREATE TYPE "frank_domain"."policy_result" AS ENUM('allow', 'allow_with_limits', 'hold_for_review', 'deny');--> statement-breakpoint
CREATE TYPE "frank_domain"."trust_label" AS ENUM('policy-trusted', 'owner-authenticated', 'verified-source', 'external-untrusted', 'generated-untrusted');--> statement-breakpoint
CREATE TYPE "frank_domain"."source_kind" AS ENUM('text', 'voice', 'image', 'document', 'url', 'email', 'calendar_event', 'message', 'x_bookmark', 'youtube_video', 'transcript', 'code', 'receipt', 'statement', 'forwarded', 'other');--> statement-breakpoint
CREATE TYPE "frank_domain"."source_lifecycle" AS ENUM('active', 'unavailable', 'tombstoned', 'deletion_pending', 'deleted');--> statement-breakpoint
CREATE TYPE "frank_domain"."dependency_kind" AS ENUM('blocks', 'relates_to', 'duplicates', 'caused_by');--> statement-breakpoint
CREATE TYPE "frank_domain"."work_kind" AS ENUM('task', 'decision', 'bug', 'milestone', 'follow_up', 'routine', 'agent_job');--> statement-breakpoint
CREATE TYPE "frank_domain"."work_priority" AS ENUM('none', 'low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "frank_domain"."work_state" AS ENUM('inbox', 'planned', 'ready', 'scheduled', 'waiting', 'blocked', 'active', 'reviewing', 'done', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "frank_domain"."conversation_kind" AS ENUM('ask', 'delegation', 'review', 'system', 'buzz');--> statement-breakpoint
CREATE TYPE "frank_domain"."conversation_state" AS ENUM('open', 'awaiting_input', 'archived', 'deleted');--> statement-breakpoint
CREATE TYPE "frank_domain"."message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "frank_domain"."delivery_state" AS ENUM('queued', 'sending', 'delivered', 'failed', 'suppressed', 'expired');--> statement-breakpoint
CREATE TYPE "frank_domain"."notification_channel" AS ENUM('in_app', 'push', 'email', 'sms', 'webhook', 'desktop');--> statement-breakpoint
CREATE TYPE "frank_domain"."notification_severity" AS ENUM('info', 'warning', 'action_required', 'critical');--> statement-breakpoint
CREATE TYPE "frank_domain"."notification_state" AS ENUM('pending', 'suppressed', 'delivered', 'read', 'acknowledged', 'dismissed', 'escalated', 'failed');--> statement-breakpoint
CREATE TYPE "frank_domain"."attribution_state" AS ENUM('attributed', 'partial', 'unattributed');--> statement-breakpoint
CREATE TYPE "frank_domain"."budget_action" AS ENUM('warn', 'slow', 'reroute', 'stop');--> statement-breakpoint
CREATE TYPE "frank_domain"."budget_scope" AS ENUM('day', 'month', 'project', 'automation', 'agent', 'provider', 'cell');--> statement-breakpoint
CREATE TYPE "frank_domain"."cost_category" AS ENUM('model', 'media', 'hosting', 'storage', 'connector', 'sandbox', 'egress', 'other');--> statement-breakpoint
CREATE TYPE "frank_domain"."cost_confidence" AS ENUM('recorded', 'estimated', 'projected');--> statement-breakpoint
CREATE TYPE "frank_domain"."cost_unit" AS ENUM('input_token', 'output_token', 'cached_input_token', 'request', 'image', 'second', 'minute', 'gb_month', 'gb_transferred', 'item', 'flat');--> statement-breakpoint
CREATE TYPE "frank_domain"."outbox_status" AS ENUM('pending', 'publishing', 'published', 'quarantined');--> statement-breakpoint
CREATE TABLE "frank_domain"."capture_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"request_idempotency_key" text NOT NULL,
	"source_id" uuid NOT NULL,
	"work_item_id" uuid,
	"channel" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"captured_by_kind" "frank_domain"."actor_kind" NOT NULL,
	"captured_by_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"replay_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"kind" "frank_domain"."source_kind" NOT NULL,
	"origin_uri" text,
	"author_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"captured_by_kind" "frank_domain"."actor_kind" NOT NULL,
	"captured_by_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"source_created_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"data_class" "frank_domain"."data_class" NOT NULL,
	"trust" "frank_domain"."trust_label" NOT NULL,
	"rights_policy" jsonb NOT NULL,
	"retention_policy" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"capture_idempotency_key" text NOT NULL,
	"raw_artifact_uri" text NOT NULL,
	"raw_artifact_sha256" text NOT NULL,
	"raw_artifact_bytes" bigint,
	"media_type" text,
	"current_version_id" uuid,
	"lifecycle" "frank_domain"."source_lifecycle" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"external_provider_id" text,
	"external_account_id" text,
	"external_id" text,
	"sync_cursor" text,
	"observed_version" text,
	"conflict_state" "frank_domain"."conflict_state" DEFAULT 'none' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."source_tombstone" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"policy_ref" jsonb NOT NULL,
	"erased_content_hash" text NOT NULL,
	"deletion_manifest_uri" text,
	"erased_at" timestamp with time zone NOT NULL,
	"erased_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."source_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content_hash" text NOT NULL,
	"raw_artifact_uri" text NOT NULL,
	"raw_artifact_sha256" text NOT NULL,
	"raw_artifact_bytes" bigint,
	"media_type" text,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"kind" "frank_domain"."work_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"state" "frank_domain"."work_state" DEFAULT 'inbox' NOT NULL,
	"priority" "frank_domain"."work_priority" DEFAULT 'none' NOT NULL,
	"owner_kind" "frank_domain"."actor_kind" NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" uuid,
	"goal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_id" uuid,
	"policy_ref" jsonb NOT NULL,
	"recurrence_series_id" uuid,
	"recurrence_rule" text,
	"recurrence_timezone" text,
	"occurrence_key" text,
	"scheduled_for_at" timestamp with time zone,
	"scheduled_for_timezone" text,
	"due_at" timestamp with time zone,
	"due_timezone" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"why_now" text,
	"definition_of_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_safe_action" text,
	"data_class" "frank_domain"."data_class" DEFAULT 'private' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "work_item_no_self_parent" CHECK ("frank_domain"."work_item"."parent_id" is null or "frank_domain"."work_item"."parent_id" <> "frank_domain"."work_item"."id"),
	CONSTRAINT "work_item_version_positive" CHECK ("frank_domain"."work_item"."version" >= 1),
	CONSTRAINT "work_item_scheduled_zone_paired" CHECK (("frank_domain"."work_item"."scheduled_for_at" is null) = ("frank_domain"."work_item"."scheduled_for_timezone" is null)),
	CONSTRAINT "work_item_due_zone_paired" CHECK (("frank_domain"."work_item"."due_at" is null) = ("frank_domain"."work_item"."due_timezone" is null)),
	CONSTRAINT "work_item_recurrence_zone_paired" CHECK (("frank_domain"."work_item"."recurrence_rule" is null) = ("frank_domain"."work_item"."recurrence_timezone" is null))
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_item_artifact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"uri" text NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text,
	"data_class" "frank_domain"."data_class" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_item_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"assignee_kind" "frank_domain"."actor_kind" NOT NULL,
	"assignee_id" text NOT NULL,
	"role" text DEFAULT 'collaborator' NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"assigned_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_item_comment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"author_kind" "frank_domain"."actor_kind" NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"data_class" "frank_domain"."data_class" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_item_dependency" (
	"cell_id" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"kind" "frank_domain"."dependency_kind" DEFAULT 'blocks' NOT NULL,
	"allows_cycle" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "work_item_dependency_work_item_id_depends_on_id_kind_pk" PRIMARY KEY("work_item_id","depends_on_id","kind"),
	CONSTRAINT "work_item_dependency_no_self" CHECK ("frank_domain"."work_item_dependency"."work_item_id" <> "frank_domain"."work_item_dependency"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_item_source_ref" (
	"cell_id" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"relation" text DEFAULT 'origin' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_item_source_ref_work_item_id_source_id_relation_pk" PRIMARY KEY("work_item_id","source_id","relation")
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_item_transition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"work_item_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_state" "frank_domain"."work_state" NOT NULL,
	"to_state" "frank_domain"."work_state" NOT NULL,
	"actor_kind" "frank_domain"."actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"audit_entry_id" uuid,
	"correlation_id" text NOT NULL,
	"resulting_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."work_state_transition" (
	"from_state" "frank_domain"."work_state" NOT NULL,
	"to_state" "frank_domain"."work_state" NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "work_state_transition_from_state_to_state_pk" PRIMARY KEY("from_state","to_state"),
	CONSTRAINT "work_state_transition_no_self" CHECK ("frank_domain"."work_state_transition"."from_state" <> "frank_domain"."work_state_transition"."to_state")
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"kind" "frank_domain"."conversation_kind" NOT NULL,
	"title" text,
	"state" "frank_domain"."conversation_state" DEFAULT 'open' NOT NULL,
	"parent_conversation_id" uuid,
	"root_conversation_id" uuid,
	"run_id" uuid,
	"work_item_id" uuid,
	"data_class" "frank_domain"."data_class" DEFAULT 'private' NOT NULL,
	"policy_ref" jsonb NOT NULL,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."conversation_attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"source_id" uuid,
	"uri" text NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text,
	"bytes" integer,
	"data_class" "frank_domain"."data_class" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."conversation_citation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_version_id" uuid,
	"locator" jsonb NOT NULL,
	"quote_sha256" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."conversation_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "frank_domain"."message_role" NOT NULL,
	"author_kind" "frank_domain"."actor_kind" NOT NULL,
	"author_id" text NOT NULL,
	"body_encrypted" text NOT NULL,
	"body_blind_index" text,
	"body_blind_index_key_version" integer,
	"data_class" "frank_domain"."data_class" NOT NULL,
	"trust" "frank_domain"."trust_label" NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"model_ref" text,
	"tool_invocation_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."conversation_participant" (
	"cell_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"participant_kind" "frank_domain"."actor_kind" NOT NULL,
	"participant_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"kind" text NOT NULL,
	"severity" "frank_domain"."notification_severity" DEFAULT 'info' NOT NULL,
	"state" "frank_domain"."notification_state" DEFAULT 'pending' NOT NULL,
	"recipient_kind" "frank_domain"."actor_kind" NOT NULL,
	"recipient_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data_class" "frank_domain"."data_class" DEFAULT 'internal' NOT NULL,
	"subject_kind" text,
	"subject_id" text,
	"work_item_id" uuid,
	"deep_link" text,
	"dedupe_key" text NOT NULL,
	"not_before_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"escalate_after_seconds" integer,
	"escalated_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."notification_delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "frank_domain"."notification_channel" NOT NULL,
	"state" "frank_domain"."delivery_state" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"provider_receipt_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."notification_preference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"recipient_kind" "frank_domain"."actor_kind" NOT NULL,
	"recipient_id" text NOT NULL,
	"notification_kind" text DEFAULT '*' NOT NULL,
	"channel" "frank_domain"."notification_channel" NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"minimum_severity" "frank_domain"."notification_severity" DEFAULT 'info' NOT NULL,
	"quiet_hours" jsonb,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."audit_chain_head" (
	"cell_id" text PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"chain_hash" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."audit_chain_root_export" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"from_seq" bigint NOT NULL,
	"to_seq" bigint NOT NULL,
	"chain_hash" text NOT NULL,
	"signer_id" text NOT NULL,
	"signature_algorithm" text NOT NULL,
	"signature" text NOT NULL,
	"external_uri" text NOT NULL,
	"exported_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."audit_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"actor_kind" "frank_domain"."actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"delegated_actor_kind" "frank_domain"."actor_kind",
	"delegated_actor_id" text,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"policy_version" text,
	"policy_decision" "frank_domain"."policy_result",
	"before_hash" text,
	"after_hash" text,
	"change_redacted" jsonb,
	"change_encrypted" text,
	"data_class" "frank_domain"."data_class" DEFAULT 'internal' NOT NULL,
	"receipt_ref" text,
	"evidence_uri" text,
	"evidence_sha256" text,
	"entry_hash" text NOT NULL,
	"prev_chain_hash" text NOT NULL,
	"chain_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."audit_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"from_seq" bigint NOT NULL,
	"to_seq" bigint NOT NULL,
	"result" text NOT NULL,
	"failed_at_seq" bigint,
	"detail" text,
	"checked_export_id" uuid,
	"verified_at" timestamp with time zone NOT NULL,
	"verified_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."cost_allocation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"cost_event_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"fraction" numeric(9, 8) NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "cost_allocation_fraction_range" CHECK ("frank_domain"."cost_allocation"."fraction" > 0 and "frank_domain"."cost_allocation"."fraction" <= 1),
	CONSTRAINT "cost_allocation_amount_is_number" CHECK ("frank_domain"."cost_allocation"."amount" <> 'NaN'::numeric)
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."cost_budget" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"scope" "frank_domain"."budget_scope" NOT NULL,
	"scope_ref" text,
	"limit_amount" numeric(24, 8) NOT NULL,
	"currency" text NOT NULL,
	"warn_at_fraction" numeric(5, 4) DEFAULT '0.8000' NOT NULL,
	"on_exceeded" "frank_domain"."budget_action" DEFAULT 'stop' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"period_timezone" text NOT NULL,
	"version" numeric(12, 0) DEFAULT '1' NOT NULL,
	CONSTRAINT "cost_budget_currency_iso4217" CHECK ("frank_domain"."cost_budget"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cost_budget_limit_non_negative" CHECK ("frank_domain"."cost_budget"."limit_amount" >= 0),
	CONSTRAINT "cost_budget_period_ordered" CHECK ("frank_domain"."cost_budget"."period_end" > "frank_domain"."cost_budget"."period_start")
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."cost_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"category" "frank_domain"."cost_category" NOT NULL,
	"confidence" "frank_domain"."cost_confidence" DEFAULT 'recorded' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"billing_period" text,
	"run_id" uuid,
	"project_id" uuid,
	"automation_id" uuid,
	"provider_account_id" text,
	"work_item_id" uuid,
	"agent_profile_id" text,
	"conversation_id" uuid,
	"attribution_state" "frank_domain"."attribution_state" DEFAULT 'unattributed' NOT NULL,
	"provider_id" text,
	"model_ref" text,
	"quantity" numeric(24, 8) NOT NULL,
	"unit" "frank_domain"."cost_unit" NOT NULL,
	"unit_price" numeric(24, 10),
	"amount" numeric(24, 8) NOT NULL,
	"currency" text NOT NULL,
	"reporting_amount" numeric(24, 8),
	"reporting_currency" text,
	"exchange_rate" numeric(24, 12),
	"usage_receipt_ref" text,
	"external_usage_id" text,
	"correlation_id" text,
	"detail" jsonb,
	CONSTRAINT "cost_event_currency_iso4217" CHECK ("frank_domain"."cost_event"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cost_event_reporting_currency_iso4217" CHECK ("frank_domain"."cost_event"."reporting_currency" is null or "frank_domain"."cost_event"."reporting_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "cost_event_amount_is_number" CHECK ("frank_domain"."cost_event"."amount" <> 'NaN'::numeric),
	CONSTRAINT "cost_event_quantity_is_number" CHECK ("frank_domain"."cost_event"."quantity" <> 'NaN'::numeric),
	CONSTRAINT "cost_event_unit_price_is_number" CHECK ("frank_domain"."cost_event"."unit_price" is null or "frank_domain"."cost_event"."unit_price" <> 'NaN'::numeric),
	CONSTRAINT "cost_event_reporting_complete" CHECK (("frank_domain"."cost_event"."reporting_amount" is null) = ("frank_domain"."cost_event"."reporting_currency" is null) and ("frank_domain"."cost_event"."reporting_amount" is null) = ("frank_domain"."cost_event"."exchange_rate" is null))
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."inbox_event" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"cell_id" text NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "frank_domain"."outbox_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "frank_domain"."outbox_event_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"specversion" text DEFAULT '1.0' NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"subject" text,
	"dataschema" text NOT NULL,
	"datacontenttype" text DEFAULT 'application/json' NOT NULL,
	"cellid" text NOT NULL,
	"actorid" text NOT NULL,
	"correlationid" text NOT NULL,
	"causationid" text,
	"classification" "frank_domain"."data_class" NOT NULL,
	"idempotencykey" text,
	"data" jsonb NOT NULL,
	"aggregate_kind" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"status" "frank_domain"."outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"quarantined_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "frank_domain"."capture_event" ADD CONSTRAINT "capture_event_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "frank_domain"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."source_tombstone" ADD CONSTRAINT "source_tombstone_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "frank_domain"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."source_version" ADD CONSTRAINT "source_version_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "frank_domain"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item" ADD CONSTRAINT "work_item_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_artifact" ADD CONSTRAINT "work_item_artifact_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_assignment" ADD CONSTRAINT "work_item_assignment_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_comment" ADD CONSTRAINT "work_item_comment_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_dependency" ADD CONSTRAINT "work_item_dependency_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_dependency" ADD CONSTRAINT "work_item_dependency_depends_on_id_work_item_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_source_ref" ADD CONSTRAINT "work_item_source_ref_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_source_ref" ADD CONSTRAINT "work_item_source_ref_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "frank_domain"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_transition" ADD CONSTRAINT "work_item_transition_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."work_item_transition" ADD CONSTRAINT "work_item_transition_legal_fk" FOREIGN KEY ("from_state","to_state") REFERENCES "frank_domain"."work_state_transition"("from_state","to_state") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation" ADD CONSTRAINT "conversation_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation" ADD CONSTRAINT "conversation_parent_fk" FOREIGN KEY ("parent_conversation_id") REFERENCES "frank_domain"."conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation_attachment" ADD CONSTRAINT "conversation_attachment_message_id_conversation_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "frank_domain"."conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation_attachment" ADD CONSTRAINT "conversation_attachment_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "frank_domain"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation_citation" ADD CONSTRAINT "conversation_citation_message_id_conversation_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "frank_domain"."conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation_citation" ADD CONSTRAINT "conversation_citation_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "frank_domain"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "frank_domain"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."conversation_participant" ADD CONSTRAINT "conversation_participant_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "frank_domain"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."notification" ADD CONSTRAINT "notification_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."notification_delivery" ADD CONSTRAINT "notification_delivery_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "frank_domain"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."audit_verification" ADD CONSTRAINT "audit_verification_checked_export_id_audit_chain_root_export_id_fk" FOREIGN KEY ("checked_export_id") REFERENCES "frank_domain"."audit_chain_root_export"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."cost_allocation" ADD CONSTRAINT "cost_allocation_cost_event_id_cost_event_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "frank_domain"."cost_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frank_domain"."cost_event" ADD CONSTRAINT "cost_event_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "frank_domain"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capture_event_request_uidx" ON "frank_domain"."capture_event" USING btree ("cell_id","request_idempotency_key");--> statement-breakpoint
CREATE INDEX "capture_event_source_idx" ON "frank_domain"."capture_event" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_capture_idem_uidx" ON "frank_domain"."source" USING btree ("cell_id","capture_idempotency_key");--> statement-breakpoint
CREATE INDEX "source_content_hash_idx" ON "frank_domain"."source" USING btree ("cell_id","content_hash");--> statement-breakpoint
CREATE INDEX "source_kind_captured_idx" ON "frank_domain"."source" USING btree ("cell_id","kind","captured_at");--> statement-breakpoint
CREATE INDEX "source_lifecycle_idx" ON "frank_domain"."source" USING btree ("cell_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "source_external_uidx" ON "frank_domain"."source" USING btree ("cell_id","external_provider_id","external_account_id","external_id") WHERE "frank_domain"."source"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_tombstone_source_uidx" ON "frank_domain"."source_tombstone" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_version_no_uidx" ON "frank_domain"."source_version" USING btree ("source_id","version_no");--> statement-breakpoint
CREATE INDEX "source_version_hash_idx" ON "frank_domain"."source_version" USING btree ("cell_id","content_hash");--> statement-breakpoint
CREATE INDEX "work_item_state_idx" ON "frank_domain"."work_item" USING btree ("cell_id","state","priority");--> statement-breakpoint
CREATE INDEX "work_item_owner_idx" ON "frank_domain"."work_item" USING btree ("cell_id","owner_kind","owner_id","state");--> statement-breakpoint
CREATE INDEX "work_item_due_idx" ON "frank_domain"."work_item" USING btree ("cell_id","due_at");--> statement-breakpoint
CREATE INDEX "work_item_scheduled_idx" ON "frank_domain"."work_item" USING btree ("cell_id","scheduled_for_at");--> statement-breakpoint
CREATE INDEX "work_item_project_idx" ON "frank_domain"."work_item" USING btree ("cell_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_occurrence_uidx" ON "frank_domain"."work_item" USING btree ("cell_id","recurrence_series_id","occurrence_key") WHERE "frank_domain"."work_item"."occurrence_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_artifact_uidx" ON "frank_domain"."work_item_artifact" USING btree ("work_item_id","kind","sha256");--> statement-breakpoint
CREATE INDEX "work_item_artifact_item_idx" ON "frank_domain"."work_item_artifact" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_assignment_uidx" ON "frank_domain"."work_item_assignment" USING btree ("work_item_id","assignee_kind","assignee_id","role") WHERE "frank_domain"."work_item_assignment"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "work_item_assignment_assignee_idx" ON "frank_domain"."work_item_assignment" USING btree ("cell_id","assignee_kind","assignee_id");--> statement-breakpoint
CREATE INDEX "work_item_comment_item_idx" ON "frank_domain"."work_item_comment" USING btree ("work_item_id","created_at");--> statement-breakpoint
CREATE INDEX "work_item_dependency_reverse_idx" ON "frank_domain"."work_item_dependency" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX "work_item_source_ref_source_idx" ON "frank_domain"."work_item_source_ref" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_transition_seq_uidx" ON "frank_domain"."work_item_transition" USING btree ("work_item_id","seq");--> statement-breakpoint
CREATE INDEX "work_item_transition_item_idx" ON "frank_domain"."work_item_transition" USING btree ("work_item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "conversation_cell_state_idx" ON "frank_domain"."conversation" USING btree ("cell_id","state","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_root_idx" ON "frank_domain"."conversation" USING btree ("root_conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_work_item_idx" ON "frank_domain"."conversation" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "conversation_attachment_message_idx" ON "frank_domain"."conversation_attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conversation_citation_message_idx" ON "frank_domain"."conversation_citation" USING btree ("message_id","order_index");--> statement-breakpoint
CREATE INDEX "conversation_citation_source_idx" ON "frank_domain"."conversation_citation" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_citation_uidx" ON "frank_domain"."conversation_citation" USING btree ("message_id","source_id",(locator::text));--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_seq_uidx" ON "frank_domain"."conversation_message" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "conversation_message_thread_idx" ON "frank_domain"."conversation_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_message_blind_idx" ON "frank_domain"."conversation_message" USING btree ("cell_id","body_blind_index");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participant_uidx" ON "frank_domain"."conversation_participant" USING btree ("conversation_id","participant_kind","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_uidx" ON "frank_domain"."notification" USING btree ("cell_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_recipient_idx" ON "frank_domain"."notification" USING btree ("cell_id","recipient_kind","recipient_id","state");--> statement-breakpoint
CREATE INDEX "notification_pending_idx" ON "frank_domain"."notification" USING btree ("cell_id","not_before_at") WHERE "frank_domain"."notification"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_work_item_idx" ON "frank_domain"."notification" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_idem_uidx" ON "frank_domain"."notification_delivery" USING btree ("cell_id","channel","idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_delivery_notification_idx" ON "frank_domain"."notification_delivery" USING btree ("notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preference_uidx" ON "frank_domain"."notification_preference" USING btree ("cell_id","recipient_kind","recipient_id","notification_kind","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_root_export_uidx" ON "frank_domain"."audit_chain_root_export" USING btree ("cell_id","to_seq");--> statement-breakpoint
CREATE INDEX "audit_chain_root_export_range_idx" ON "frank_domain"."audit_chain_root_export" USING btree ("cell_id","from_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_entry_seq_uidx" ON "frank_domain"."audit_entry" USING btree ("cell_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_entry_chain_uidx" ON "frank_domain"."audit_entry" USING btree ("cell_id","chain_hash");--> statement-breakpoint
CREATE INDEX "audit_entry_target_idx" ON "frank_domain"."audit_entry" USING btree ("cell_id","target_kind","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_entry_correlation_idx" ON "frank_domain"."audit_entry" USING btree ("cell_id","correlation_id");--> statement-breakpoint
CREATE INDEX "audit_entry_actor_idx" ON "frank_domain"."audit_entry" USING btree ("cell_id","actor_kind","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_verification_cell_idx" ON "frank_domain"."audit_verification" USING btree ("cell_id","verified_at");--> statement-breakpoint
CREATE INDEX "audit_verification_failed_idx" ON "frank_domain"."audit_verification" USING btree ("cell_id","verified_at") WHERE "frank_domain"."audit_verification"."result" <> 'ok';--> statement-breakpoint
CREATE UNIQUE INDEX "cost_allocation_uidx" ON "frank_domain"."cost_allocation" USING btree ("cost_event_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "cost_allocation_target_idx" ON "frank_domain"."cost_allocation" USING btree ("cell_id","target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_budget_scope_uidx" ON "frank_domain"."cost_budget" USING btree ("cell_id","scope","scope_ref","period_start");--> statement-breakpoint
CREATE INDEX "cost_budget_period_idx" ON "frank_domain"."cost_budget" USING btree ("cell_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_event_external_uidx" ON "frank_domain"."cost_event" USING btree ("cell_id","provider_id","external_usage_id") WHERE "frank_domain"."cost_event"."external_usage_id" is not null;--> statement-breakpoint
CREATE INDEX "cost_event_occurred_idx" ON "frank_domain"."cost_event" USING btree ("cell_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cost_event_run_idx" ON "frank_domain"."cost_event" USING btree ("cell_id","run_id");--> statement-breakpoint
CREATE INDEX "cost_event_project_idx" ON "frank_domain"."cost_event" USING btree ("cell_id","project_id");--> statement-breakpoint
CREATE INDEX "cost_event_automation_idx" ON "frank_domain"."cost_event" USING btree ("cell_id","automation_id");--> statement-breakpoint
CREATE INDEX "cost_event_provider_account_idx" ON "frank_domain"."cost_event" USING btree ("cell_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "cost_event_unattributed_idx" ON "frank_domain"."cost_event" USING btree ("cell_id","occurred_at") WHERE "frank_domain"."cost_event"."attribution_state" <> 'attributed';--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_event_pk" ON "frank_domain"."inbox_event" USING btree ("consumer","event_id");--> statement-breakpoint
CREATE INDEX "inbox_event_unprocessed_idx" ON "frank_domain"."inbox_event" USING btree ("cell_id","consumer","received_at") WHERE "frank_domain"."inbox_event"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "frank_domain"."outbox_event" USING btree ("cellid","available_at","sequence") WHERE "frank_domain"."outbox_event"."status" in ('pending', 'publishing');--> statement-breakpoint
CREATE INDEX "outbox_event_aggregate_idx" ON "frank_domain"."outbox_event" USING btree ("cellid","aggregate_kind","aggregate_id","sequence");--> statement-breakpoint
CREATE INDEX "outbox_event_type_idx" ON "frank_domain"."outbox_event" USING btree ("cellid","type","time");--> statement-breakpoint
CREATE INDEX "outbox_event_quarantine_idx" ON "frank_domain"."outbox_event" USING btree ("cellid","quarantined_at") WHERE "frank_domain"."outbox_event"."status" = 'quarantined';--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_event_idempotency_uidx" ON "frank_domain"."outbox_event" USING btree ("cellid","idempotencykey") WHERE "frank_domain"."outbox_event"."idempotencykey" is not null;