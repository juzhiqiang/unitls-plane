CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_filename_trgm_idx" ON "files" USING gin ("filename" gin_trgm_ops);
