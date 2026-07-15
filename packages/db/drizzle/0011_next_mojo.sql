ALTER TABLE "cleanup_obligations" ADD CONSTRAINT "cleanup_obligations_payload_check" CHECK ((
        ("cleanup_obligations"."kind" = 'object' AND "cleanup_obligations"."storage_key" IS NOT NULL AND "cleanup_obligations"."queue_name" IS NULL AND "cleanup_obligations"."job_id" IS NULL)
        OR
        ("cleanup_obligations"."kind" = 'task-job' AND "cleanup_obligations"."storage_key" IS NULL AND "cleanup_obligations"."queue_name" IS NOT NULL AND "cleanup_obligations"."job_id" IS NOT NULL)
      ));