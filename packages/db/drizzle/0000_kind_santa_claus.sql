CREATE TYPE "public"."task_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('compress', 'convert', 'pdf_merge', 'pdf_split', 'font_convert');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"filename" text NOT NULL,
	"original_size" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"bucket" text DEFAULT 'uploads' NOT NULL,
	"mime_type" text NOT NULL,
	"metadata" jsonb,
	"expires_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"input_file_ids" jsonb DEFAULT '[]'::jsonb,
	"input_config" jsonb DEFAULT '{}'::jsonb,
	"output_file_id" uuid,
	"progress" smallint DEFAULT 0,
	"error_code" text,
	"error_message" text,
	"retry_count" smallint DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "files_user_created_idx" ON "files" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "files_expires_idx" ON "files" USING btree ("expires_at") WHERE expires_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_user_created_idx" ON "tasks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");