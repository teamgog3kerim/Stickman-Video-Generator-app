import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { z } from "zod/v4";

export type ProjectScene = {
  id: string;
  title: string;
  narration: string;
  visualDirection: string;
  seconds: number;
  shotType?: string;
  visualMetaphor?: string;
  onScreenText?: string;
  cameraMove?: string;
  soundCue?: string;
  entrance?: "already-on-stage" | "walk-in-left" | "walk-in-right" | "run-in-left" | "run-in-right" | "pop-in";
  groupAction?: "story-directed" | "talk-and-react" | "walk-together" | "point-together" | "celebrate-together";
  exit?: "hold" | "walk-off-left" | "walk-off-right" | "run-off-left" | "run-off-right" | "exit-together";
  transitionToNext?: "cut" | "dissolve" | "wipe-left" | "wipe-right" | "match-left" | "match-right";
};

export type ProjectCastMember = {
  id: string;
  name: string;
  role: string;
  personality?: string;
  shirtColor: string;
  skinTone: string;
  hairStyle: "short" | "curly" | "long";
  accessory: "none" | "cap" | "glasses" | "headband" | "backpack" | "bow";
};

export const projectsTable = pgTable(
  "video_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    topic: text("topic").notNull().default(""),
    script: text("script").notNull().default(""),
    hook: text("hook").notNull().default(""),
    takeaway: text("takeaway").notNull().default(""),
    engine: text("engine").$type<"model" | "code">().notNull().default("model"),
    styleId: text("style_id").notNull().default("A2"),
    aspectRatio: text("aspect_ratio").$type<"16:9" | "9:16">().notNull().default("16:9"),
    durationSeconds: integer("duration_seconds").notNull().default(60),
    voiceover: boolean("voiceover").notNull().default(true),
    subtitles: boolean("subtitles").notNull().default(true),
    soundEffects: boolean("sound_effects").notNull().default(false),
    contentLanguage: text("content_language").$type<"en" | "am" | "ar">().notNull().default("en"),
    scenes: jsonb("scenes").$type<ProjectScene[]>().notNull().default([]),
    cartoonCast: jsonb("cartoon_cast").$type<ProjectCastMember[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("video_projects_user_updated_idx").on(table.userId, table.updatedAt)],
);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
