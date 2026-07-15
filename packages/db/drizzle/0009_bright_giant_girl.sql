CREATE TABLE "cleanup_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"storage_key" text,
	"queue_name" text,
	"job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cleanup_obligations_kind_resource_idx" ON "cleanup_obligations" USING btree ("kind","resource_id");