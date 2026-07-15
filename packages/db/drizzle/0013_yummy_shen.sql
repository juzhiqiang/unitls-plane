CREATE TABLE "account_deletion_queue_scans" (
	"user_id" uuid NOT NULL,
	"queue_name" text NOT NULL,
	"cursor" text DEFAULT '0' NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"pending_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_deletion_queue_scans_user_id_queue_name_pk" PRIMARY KEY("user_id","queue_name")
);
--> statement-breakpoint
ALTER TABLE "account_deletion_queue_scans" ADD CONSTRAINT "account_deletion_queue_scans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;