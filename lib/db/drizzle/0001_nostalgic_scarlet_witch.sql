ALTER TABLE "app_users" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "content_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "content_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "rendered_videos" ADD COLUMN "content_language" text DEFAULT 'en' NOT NULL;