import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type StoredMedia = {
  id: string;
  url: string;
  name: string;
  objectPath?: string;
};

export const marketplacePosts = pgTable("marketplace_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  price: text("price").notNull().default("0"),
  type: text("type").notNull().default("For sale"),
  location: text("location").notNull(),
  category: text("category").notNull(),
  condition: text("condition").notNull(),
  seller: text("seller").notNull(),
  initials: text("initials").notNull(),
  images: jsonb("images").$type<StoredMedia[]>().notNull().default([]),
  video: jsonb("video").$type<StoredMedia | null>(),
  status: text("status").notNull().default("pending"),
  moderationNote: text("moderation_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MarketplacePost = typeof marketplacePosts.$inferSelect;
export type NewMarketplacePost = typeof marketplacePosts.$inferInsert;