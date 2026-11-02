CREATE TYPE "public"."ai_try_on_reference_kind" AS ENUM('person', 'pose', 'garment');--> statement-breakpoint
ALTER TYPE "public"."task_type" ADD VALUE 'image_try_on' BEFORE 'pdf_to_cad';--> statement-breakpoint
CREATE TABLE "ai_try_on_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "ai_try_on_reference_kind" NOT NULL,
	"title_zh" text NOT NULL,
	"title_en" text NOT NULL,
	"description_zh" text,
	"description_en" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"asset_bucket" text NOT NULL,
	"asset_storage_key" text NOT NULL,
	"thumbnail_bucket" text NOT NULL,
	"thumbnail_storage_key" text NOT NULL,
	"source_url" text,
	"license_name" text,
	"license_url" text,
	"attribution" text,
	"license_reviewed_at" timestamp,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_try_on_references_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "ai_try_on_references_kind_sort_idx" ON "ai_try_on_references" USING btree ("kind","sort_order");