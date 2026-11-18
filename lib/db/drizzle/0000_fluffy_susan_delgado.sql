CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"takeaway" text DEFAULT '' NOT NULL,
	"engine" text DEFAULT 'model' NOT NULL,
	"style_id" text DEFAULT 'A2' NOT NULL,
	"aspect_ratio" text DEFAULT '16:9' NOT NULL,
	"duration_seconds" integer DEFAULT 60 NOT NULL,
	"voiceover" boolean DEFAULT true NOT NULL,
	"subtitles" boolean DEFAULT true NOT NULL,
	"sound_effects" boolean DEFAULT false NOT NULL,
	"scenes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rendered_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"content_context" text DEFAULT '' NOT NULL,
	"aspect_ratio" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"file_name" text NOT NULL,
	"object_path" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rendered_videos_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_videos" ADD CONSTRAINT "rendered_videos_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendered_videos" ADD CONSTRAINT "rendered_videos_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_projects_user_updated_idx" ON "video_projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "rendered_videos_user_created_idx" ON "rendered_videos" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "rendered_videos_project_idx" ON "rendered_videos" USING btree ("project_id");