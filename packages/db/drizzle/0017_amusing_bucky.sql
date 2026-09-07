ALTER TABLE "tasks" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE INDEX "tasks_session_idx" ON "tasks" USING btree ("user_id","session_id");