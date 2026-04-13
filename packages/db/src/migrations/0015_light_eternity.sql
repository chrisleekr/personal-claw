CREATE TABLE "detection_audit_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_event_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"annotation_kind" text NOT NULL,
	"annotated_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detection_audit_annotations_event_annotator_unique" UNIQUE("audit_event_id","annotated_by")
);
--> statement-breakpoint
CREATE TABLE "detection_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_user_id" text NOT NULL,
	"thread_id" text,
	"decision" text NOT NULL,
	"risk_score" numeric(5, 2) NOT NULL,
	"layers_fired" text[] DEFAULT '{}' NOT NULL,
	"reason_code" text NOT NULL,
	"redacted_excerpt" text NOT NULL,
	"reference_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"canary_hit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detection_audit_events_reference_id_unique" UNIQUE("reference_id")
);
--> statement-breakpoint
CREATE TABLE "detection_corpus_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_id" text NOT NULL,
	"signature_text" text NOT NULL,
	"signature_category" text NOT NULL,
	"embedding_provider" text NOT NULL,
	"source_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detection_corpus_embeddings_sig_provider_version_unique" UNIQUE("signature_id","embedding_provider","source_version")
);
--> statement-breakpoint
CREATE TABLE "detection_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"override_kind" text NOT NULL,
	"target_key" text NOT NULL,
	"justification" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detection_overrides_channel_kind_key_unique" UNIQUE("channel_id","override_kind","target_key")
);
--> statement-breakpoint
ALTER TABLE "detection_audit_annotations" ADD CONSTRAINT "detection_audit_annotations_audit_event_id_detection_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."detection_audit_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_audit_annotations" ADD CONSTRAINT "detection_audit_annotations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_audit_events" ADD CONSTRAINT "detection_audit_events_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_overrides" ADD CONSTRAINT "detection_overrides_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "detection_audit_annotations_channel_created_idx" ON "detection_audit_annotations" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "detection_audit_annotations_event_idx" ON "detection_audit_annotations" USING btree ("audit_event_id");--> statement-breakpoint
CREATE INDEX "detection_audit_events_channel_created_idx" ON "detection_audit_events" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "detection_audit_events_decision_created_idx" ON "detection_audit_events" USING btree ("decision","created_at");--> statement-breakpoint
CREATE INDEX "detection_corpus_embeddings_signature_idx" ON "detection_corpus_embeddings" USING btree ("signature_id");--> statement-breakpoint
CREATE INDEX "detection_overrides_channel_idx" ON "detection_overrides" USING btree ("channel_id");--> statement-breakpoint
-- pgvector additions for detection_corpus_embeddings (raw SQL — Drizzle does
-- not support the vector type directly). Same pattern as migration 0006 for
-- channel_memories: the column is added as NULLABLE so the Drizzle schema in
-- packages/db/src/schema/detection-corpus-embeddings.ts (which does not list
-- the column) does not register a drift on subsequent `db:generate` runs.
-- The application layer (initDetectionCorpus in
-- apps/api/src/agent/detection/corpus-init.ts) always supplies a non-null
-- embedding via raw SQL UPSERT, so the absence of a NOT NULL constraint is
-- not a correctness gap in practice.
-- HNSW index uses cosine ops to match LongTermMemory.search() in
-- apps/api/src/memory/longterm.ts.
ALTER TABLE "detection_corpus_embeddings" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "detection_corpus_embeddings_embedding_idx"
  ON "detection_corpus_embeddings" USING hnsw ("embedding" vector_cosine_ops);