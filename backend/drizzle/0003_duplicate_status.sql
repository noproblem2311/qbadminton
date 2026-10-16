ALTER TYPE "public"."processing_status" ADD VALUE 'duplicate';--> statement-breakpoint
ALTER TABLE "raw_posts" ADD COLUMN "duplicate_of_post_id" uuid;--> statement-breakpoint
ALTER TABLE "raw_posts" ADD CONSTRAINT "raw_posts_duplicate_of_post_id_raw_posts_id_fk" FOREIGN KEY ("duplicate_of_post_id") REFERENCES "public"."raw_posts"("id") ON DELETE set null ON UPDATE no action;