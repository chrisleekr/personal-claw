CREATE TABLE "skill_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_user_id" text NOT NULL,
	"was_helpful" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_usages" ADD CONSTRAINT "skill_usages_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_usages" ADD CONSTRAINT "skill_usages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_usages_skill_idx" ON "skill_usages" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_usages_channel_idx" ON "skill_usages" USING btree ("channel_id");