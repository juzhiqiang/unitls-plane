CREATE TABLE "task_submissions" (
	"scope" text NOT NULL,
	"key" uuid NOT NULL,
	"user_id" uuid,
	"request_hash" text NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "task_submissions_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_submissions_expires_idx" ON "task_submissions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "task_submissions_user_idx" ON "task_submissions" USING btree ("user_id");