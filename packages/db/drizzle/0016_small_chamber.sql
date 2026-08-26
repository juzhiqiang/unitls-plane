CREATE TABLE "image_generate_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title_zh" text NOT NULL,
	"title_en" text NOT NULL,
	"prompt_zh" text NOT NULL,
	"prompt_en" text NOT NULL,
	"image_storage_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_builtin" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "image_generate_presets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "image_generate_presets_sort_idx" ON "image_generate_presets" USING btree ("sort_order");