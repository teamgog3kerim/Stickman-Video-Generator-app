import { createInsertSchema } from "drizzle-zod";
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usersTable = pgTable("app_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  fullName: text("full_name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role").$type<"user" | "admin">().notNull().default("user"),
  locale: text("locale").$type<"en" | "am" | "ar">().notNull().default("en"),
  contentLanguage: text("content_language").$type<"en" | "am" | "ar">().notNull().default("en"),
  youtubeProfileUrl: text("youtube_profile_url"),
  instagramProfileUrl: text("instagram_profile_url"),
  tiktokProfileUrl: text("tiktok_profile_url"),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
