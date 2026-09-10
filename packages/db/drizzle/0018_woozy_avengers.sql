DROP INDEX "tasks_user_created_idx";--> statement-breakpoint
CREATE INDEX "files_active_list_idx" ON "files" USING btree ("user_id","created_at","id") WHERE "files"."deleted_at" IS NULL AND "files"."purge_started_at" IS NULL;--> statement-breakpoint
CREATE INDEX "files_trash_list_idx" ON "files" USING btree ("user_id","deleted_at","id") WHERE "files"."deleted_at" IS NOT NULL AND "files"."purge_started_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_user_status_created_idx" ON "tasks" USING btree ("user_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "tasks_user_type_created_idx" ON "tasks" USING btree ("user_id","type","created_at","id");--> statement-breakpoint
CREATE INDEX "tasks_user_created_idx" ON "tasks" USING btree ("user_id","created_at","id");