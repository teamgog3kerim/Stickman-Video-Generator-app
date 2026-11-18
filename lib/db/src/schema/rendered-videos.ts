import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { usersTable } from "./users";

export const renderedVideosTable = pgTable(
  "rendered_videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projectsTable.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    topic: text("topic").notNull().default(""),
    contentContext: text("content_context").notNull().default(""),
    aspectRatio: text("aspect_ratio").$type<"16:9" | "9:16">().notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    fileName: text("file_name").notNull(),
    objectPath: text("object_path").notNull().unique(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("rendered_videos_user_created_idx").on(table.userId, table.createdAt),
    index("rendered_videos_project_idx").on(table.projectId),
  ],
);

export type RenderedVideo = typeof renderedVideosTable.$inferSelect;
