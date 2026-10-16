CREATE TYPE "public"."skill_level_code" AS ENUM('YEU', 'TBY', 'TB_MINUS', 'TB', 'TB_PLUS', 'KHA');--> statement-breakpoint
CREATE TABLE "session_levels" (
	"session_id" uuid NOT NULL,
	"level_code" "skill_level_code" NOT NULL,
	CONSTRAINT "session_levels_session_id_level_code_pk" PRIMARY KEY("session_id","level_code")
);
--> statement-breakpoint
CREATE TABLE "skill_levels" (
	"code" "skill_level_code" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "skill_levels_sort_order_unique" UNIQUE("sort_order")
);
--> statement-breakpoint
ALTER TABLE "session_levels" ADD CONSTRAINT "session_levels_session_id_badminton_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."badminton_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_levels" ADD CONSTRAINT "session_levels_level_code_skill_levels_code_fk" FOREIGN KEY ("level_code") REFERENCES "public"."skill_levels"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_levels_level_code_idx" ON "session_levels" USING btree ("level_code");--> statement-breakpoint
ALTER TABLE "badminton_sessions" DROP COLUMN "level_search";--> statement-breakpoint
INSERT INTO "skill_levels" ("code", "name", "sort_order") VALUES
	('YEU', 'Yếu', 1),
	('TBY', 'Trung bình yếu', 2),
	('TB_MINUS', 'Trung bình -', 3),
	('TB', 'Trung bình', 4),
	('TB_PLUS', 'Trung bình +', 5),
	('KHA', 'Khá', 6)
ON CONFLICT ("code") DO NOTHING;
