-- Attachment staging is cell scoped; promotion creates immutable sha256-addressed objects.
-- Quotas deliberately separate the 50 GiB cell pool, per-message 10 GiB/10k aggregate,
-- and the independently observed 30 GiB host-free safety floor.
CREATE TABLE "frank_domain"."object_manifest" (
  "object_id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "bucket" text NOT NULL DEFAULT 'frank-objects' CHECK ("bucket" = 'frank-objects'), "object_key" text NOT NULL,
  "sha256" text NOT NULL CHECK ("sha256" ~ '^[a-f0-9]{64}$'), "size_bytes" bigint NOT NULL CHECK ("size_bytes" >= 0 AND "size_bytes" <= 2147483648), "media_type" text NOT NULL, "manifest" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "object_manifest_sha_uidx" UNIQUE("cell_id","sha256"), CONSTRAINT "object_manifest_key_sha_match" CHECK ("object_key" = 'sha256/' || substr("sha256", 1, 2) || '/' || "sha256"), CONSTRAINT "object_manifest_payload_object" CHECK (jsonb_typeof("manifest") = 'object' AND "manifest" <> '{}'::jsonb), CONSTRAINT "object_manifest_canonical_payload" CHECK ("manifest"->>'schema' = 'schema://frank.object-manifest/v1' AND jsonb_typeof("manifest"->'cell_id') = 'string' AND "manifest"->>'cell_id' = "cell_id" AND "manifest"->>'bucket' = "bucket" AND "manifest"->>'object_key' = "object_key" AND "manifest"->>'sha256' = "sha256" AND "manifest"->>'size_bytes' = "size_bytes"::text AND jsonb_typeof("manifest"->'security') = 'object' AND "manifest"->'security'->>'scan_state' = 'clean' AND jsonb_typeof("manifest"->'security'->'scanned_at') = 'string'), CONSTRAINT "object_manifest_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("media_type")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "object_manifest_id_cell_uidx" ON "frank_domain"."object_manifest"("object_id","cell_id");--> statement-breakpoint
CREATE TABLE "frank_domain"."upload_reservation" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "owner_id" text NOT NULL, "conversation_id" uuid NOT NULL, "draft_message_id" uuid NOT NULL, "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL CHECK ("request_hash" ~ '^[a-f0-9]{64}$'), "upload_id" text NOT NULL, "original_name" text NOT NULL, "relative_path" text, "media_type" text NOT NULL,
  "state" text NOT NULL CHECK ("state" IN ('authorized','uploading','completed','terminating','cancelled','expired','rejected')),
  "reserved_bytes" bigint NOT NULL CHECK ("reserved_bytes" >= 0 AND "reserved_bytes" <= 2147483648), "reserved_count" integer NOT NULL DEFAULT 1 CHECK ("reserved_count" = 1),
  "capability_version" integer NOT NULL DEFAULT 1 CHECK ("capability_version" >= 1), "expires_at" timestamptz NOT NULL, "termination_requested_at" timestamptz, "termination_confirmed_at" timestamptz, "termination_attempts" integer NOT NULL DEFAULT 0 CHECK ("termination_attempts" >= 0), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "upload_reservation_idempotency_uidx" UNIQUE("cell_id","owner_id","conversation_id","draft_message_id","idempotency_key"), CONSTRAINT "upload_reservation_upload_uidx" UNIQUE("cell_id","upload_id"),
  CONSTRAINT "upload_reservation_conversation_cell_fk" FOREIGN KEY("conversation_id","cell_id") REFERENCES "frank_domain"."chat_conversation"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "upload_reservation_expiry_24h" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '24 hours'),
  CONSTRAINT "upload_reservation_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("owner_id")) > 0 AND length(btrim("idempotency_key")) > 0 AND length(btrim("upload_id")) > 0 AND length(btrim("original_name")) > 0 AND length(btrim("media_type")) > 0),
  CONSTRAINT "upload_reservation_termination_evidence" CHECK (("state" <> 'terminating' OR "termination_requested_at" IS NOT NULL) AND ("termination_confirmed_at" IS NULL OR ("termination_requested_at" IS NOT NULL AND "termination_confirmed_at" >= "termination_requested_at")) AND ("state" NOT IN ('cancelled','expired') OR "termination_confirmed_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "upload_reservation_id_cell_uidx" ON "frank_domain"."upload_reservation"("id","cell_id");--> statement-breakpoint
CREATE TABLE "frank_domain"."attachment_quota" (
  "cell_id" text PRIMARY KEY NOT NULL, "pool" text NOT NULL DEFAULT 'global-cell' CHECK ("pool" = 'global-cell'),
  "reserved_bytes" bigint NOT NULL DEFAULT 0 CHECK ("reserved_bytes" >= 0 AND "reserved_bytes" <= 53687091200), "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "attachment_quota_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."attachment_message_quota" (
  "cell_id" text NOT NULL, "draft_message_id" uuid NOT NULL, "reserved_bytes" bigint NOT NULL DEFAULT 0 CHECK ("reserved_bytes" >= 0 AND "reserved_bytes" <= 10737418240), "reserved_count" integer NOT NULL DEFAULT 0 CHECK ("reserved_count" >= 0 AND "reserved_count" <= 10000), "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY("cell_id","draft_message_id"), CONSTRAINT "attachment_message_quota_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."attachment_host_free_observation" (
  "id" uuid PRIMARY KEY NOT NULL, "host_id" text NOT NULL, "free_bytes" bigint NOT NULL CHECK ("free_bytes" >= 0), "usable" boolean NOT NULL,
  "observed_at" timestamptz NOT NULL DEFAULT now(), "expires_at" timestamptz NOT NULL,
  CONSTRAINT "attachment_host_free_observation_usable_consistent" CHECK ("usable" = ("free_bytes" >= 32212254720)), CONSTRAINT "attachment_host_free_observation_ttl_strict" CHECK ("expires_at" > "observed_at" AND "expires_at" <= "observed_at" + interval '5 minutes'), CONSTRAINT "attachment_host_free_observation_host_not_blank" CHECK (length(btrim("host_id")) > 0)
);--> statement-breakpoint
CREATE INDEX "attachment_host_free_observation_ttl_idx" ON "frank_domain"."attachment_host_free_observation"("host_id","expires_at");--> statement-breakpoint
CREATE TABLE "frank_domain"."attachment" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "owner_id" text NOT NULL, "conversation_id" uuid, "draft_message_id" uuid NOT NULL, "message_id" uuid, "turn_id" uuid, "reservation_id" uuid NOT NULL, "upload_id" text NOT NULL, "object_id" uuid,
  "name" text NOT NULL, "relative_path" text, "size_bytes" bigint NOT NULL CHECK ("size_bytes" >= 0 AND "size_bytes" <= 2147483648), "media_type" text NOT NULL, "digest" text CHECK ("digest" IS NULL OR "digest" ~ '^[a-f0-9]{64}$'),
  "scan_state" text NOT NULL CHECK ("scan_state" IN ('pending','clean','blocked','failed')), "extraction_state" text NOT NULL CHECK ("extraction_state" IN ('none','pending','complete','failed')),
  "source_ref" jsonb NOT NULL, "state" text NOT NULL CHECK ("state" IN ('staging','scanning','ready','promoted','rejected','cancelled','expired')), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachment_upload_uidx" UNIQUE("cell_id","upload_id"),
  CONSTRAINT "attachment_conversation_cell_fk" FOREIGN KEY("conversation_id","cell_id") REFERENCES "frank_domain"."chat_conversation"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "attachment_message_cell_fk" FOREIGN KEY("message_id","cell_id") REFERENCES "frank_domain"."chat_message"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "attachment_turn_cell_fk" FOREIGN KEY("turn_id","cell_id") REFERENCES "frank_domain"."chat_turn"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "attachment_reservation_cell_fk" FOREIGN KEY("reservation_id","cell_id") REFERENCES "frank_domain"."upload_reservation"("id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "attachment_object_cell_fk" FOREIGN KEY("object_id","cell_id") REFERENCES "frank_domain"."object_manifest"("object_id","cell_id") ON DELETE RESTRICT,
  CONSTRAINT "attachment_source_ref_object" CHECK (jsonb_typeof("source_ref") = 'object' AND "source_ref" ? 'kind' AND "source_ref" ? 'id' AND jsonb_typeof("source_ref"->'kind') = 'string' AND jsonb_typeof("source_ref"->'id') = 'string' AND length(btrim("source_ref"->>'kind')) > 0 AND length(btrim("source_ref"->>'id')) > 0 AND (NOT ("source_ref" ? 'version') OR (jsonb_typeof("source_ref"->'version') = 'string' AND length(btrim("source_ref"->>'version')) > 0))),
  CONSTRAINT "attachment_ids_not_blank" CHECK (length(btrim("cell_id")) > 0 AND length(btrim("owner_id")) > 0 AND length(btrim("upload_id")) > 0 AND length(btrim("name")) > 0 AND length(btrim("media_type")) > 0),
  CONSTRAINT "attachment_message_link_consistent" CHECK ("message_id" IS NULL OR "message_id" = "draft_message_id"),
  CONSTRAINT "attachment_state_consistent" CHECK (("state" IN ('staging','scanning') AND "scan_state" = 'pending' AND "object_id" IS NULL) OR ("state" IN ('ready','promoted') AND "scan_state" = 'clean' AND "object_id" IS NOT NULL) OR ("state" = 'rejected' AND "scan_state" IN ('blocked','failed')) OR ("state" IN ('cancelled','expired') AND "object_id" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_id_cell_uidx" ON "frank_domain"."attachment"("id","cell_id");--> statement-breakpoint
CREATE TABLE "frank_domain"."attachment_outbox" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "attachment_id" uuid NOT NULL, "kind" text NOT NULL CHECK ("kind" IN ('hash_scan_promote','extract','cleanup','reconcile')),
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending','leased','completed','failed','cancelled')), "payload" jsonb NOT NULL, "available_at" timestamptz NOT NULL DEFAULT now(), "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0), "completed_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachment_outbox_attachment_cell_fk" FOREIGN KEY("attachment_id","cell_id") REFERENCES "frank_domain"."attachment"("id","cell_id") ON DELETE CASCADE,
  CONSTRAINT "attachment_outbox_once_uidx" UNIQUE("cell_id","attachment_id","kind"), CONSTRAINT "attachment_outbox_payload_object" CHECK (jsonb_typeof("payload") = 'object' AND "payload" <> '{}'::jsonb), CONSTRAINT "attachment_outbox_state_consistent" CHECK (("state" = 'completed') = ("completed_at" IS NOT NULL)), CONSTRAINT "attachment_outbox_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE TABLE "frank_domain"."attachment_cleanup_ledger" (
  "id" uuid PRIMARY KEY NOT NULL, "cell_id" text NOT NULL, "reservation_id" uuid NOT NULL, "state" text NOT NULL CHECK ("state" IN ('pending','claimed','completed','failed')), "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0), "claimed_at" timestamptz, "completed_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachment_cleanup_reservation_cell_fk" FOREIGN KEY("reservation_id","cell_id") REFERENCES "frank_domain"."upload_reservation"("id","cell_id") ON DELETE CASCADE, CONSTRAINT "attachment_cleanup_once_uidx" UNIQUE("cell_id","reservation_id"), CONSTRAINT "attachment_cleanup_state_evidence" CHECK (("state" <> 'completed' OR ("claimed_at" IS NOT NULL AND "completed_at" IS NOT NULL)) AND ("state" <> 'claimed' OR ("claimed_at" IS NOT NULL AND "completed_at" IS NULL)) AND ("state" <> 'pending' OR ("claimed_at" IS NULL AND "completed_at" IS NULL)) AND ("claimed_at" IS NULL OR "claimed_at" >= "created_at") AND ("completed_at" IS NULL OR ("claimed_at" IS NOT NULL AND "completed_at" >= "claimed_at"))), CONSTRAINT "attachment_cleanup_cell_not_blank" CHECK (length(btrim("cell_id")) > 0)
);--> statement-breakpoint
CREATE INDEX "attachment_owner_state_idx" ON "frank_domain"."attachment"("cell_id","owner_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "upload_reservation_expiry_idx" ON "frank_domain"."upload_reservation"("cell_id","state","expires_at");
