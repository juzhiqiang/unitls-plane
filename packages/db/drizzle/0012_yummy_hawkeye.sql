ALTER TABLE "cleanup_obligations" DROP CONSTRAINT "cleanup_obligations_payload_check";--> statement-breakpoint
ALTER TABLE "cleanup_obligations" ADD COLUMN "state" text;--> statement-breakpoint
UPDATE "cleanup_obligations"
SET "state" = CASE
	WHEN "kind" = 'object' THEN 'cleanup'
	ELSE 'ready'
END;--> statement-breakpoint
ALTER TABLE "cleanup_obligations" ALTER COLUMN "state" SET DEFAULT 'ready';--> statement-breakpoint
ALTER TABLE "cleanup_obligations" ALTER COLUMN "state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cleanup_obligations" ADD CONSTRAINT "cleanup_obligations_payload_check" CHECK ((
        ("cleanup_obligations"."kind" = 'object' AND "cleanup_obligations"."state" IN ('producing', 'cleanup') AND "cleanup_obligations"."storage_key" IS NOT NULL AND "cleanup_obligations"."queue_name" IS NULL AND "cleanup_obligations"."job_id" IS NULL)
        OR
        ("cleanup_obligations"."kind" = 'task-job' AND "cleanup_obligations"."state" = 'ready' AND "cleanup_obligations"."storage_key" IS NULL AND "cleanup_obligations"."queue_name" IS NOT NULL AND "cleanup_obligations"."job_id" IS NOT NULL)
      ));
