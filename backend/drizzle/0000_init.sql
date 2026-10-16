CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'parsed', 'failed', 'irrelevant');--> statement-breakpoint
CREATE TABLE "badminton_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_post_id" uuid NOT NULL,
	"author" text,
	"play_date" date,
	"start_time" time,
	"end_time" time,
	"level" text,
	"location" text,
	"content" text NOT NULL,
	"starts_at" timestamp with time zone,
	"level_search" text,
	"location_search" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facebook_post_id" text,
	"group_id" text,
	"post_url" text,
	"author" text,
	"content" text NOT NULL,
	"published_at" timestamp with time zone,
	"captured_at" timestamp with time zone NOT NULL,
	"fingerprint" text NOT NULL,
	"processing_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "badminton_sessions" ADD CONSTRAINT "badminton_sessions_raw_post_id_raw_posts_id_fk" FOREIGN KEY ("raw_post_id") REFERENCES "public"."raw_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "badminton_sessions_starts_at_idx" ON "badminton_sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "badminton_sessions_play_date_idx" ON "badminton_sessions" USING btree ("play_date");--> statement-breakpoint
CREATE INDEX "badminton_sessions_raw_post_idx" ON "badminton_sessions" USING btree ("raw_post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_posts_group_post_uidx" ON "raw_posts" USING btree (coalesce(group_id, ''),"facebook_post_id") WHERE facebook_post_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_posts_fingerprint_without_post_id_uidx" ON "raw_posts" USING btree ("fingerprint") WHERE facebook_post_id is null;--> statement-breakpoint
CREATE INDEX "raw_posts_fingerprint_idx" ON "raw_posts" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "raw_posts_pending_queue_idx" ON "raw_posts" USING btree ("next_attempt_at") WHERE processing_status = 'pending';--> statement-breakpoint
CREATE INDEX "raw_posts_processing_started_idx" ON "raw_posts" USING btree ("processing_started_at") WHERE processing_status = 'processing';