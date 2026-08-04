import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const workspace = v.union(
  v.literal("work"),
  v.literal("personal"),
  v.literal("coding"),
  v.literal("research"),
  v.literal("study")
);

export default defineSchema({
  users: defineTable({
    email: v.string(),
    passwordHash: v.string(),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  highlights: defineTable({
    userId: v.optional(v.id("users")), // optional for backward compat with pre-auth records
    clientId: v.string(),
    text: v.string(),
    url: v.string(),
    title: v.string(),
    timestamp: v.number(),
    workspaceId: v.optional(workspace),
    updatedAt: v.optional(v.number()),
    deleted: v.optional(v.boolean()),
  })
    .index("by_clientId", ["clientId"])
    .index("by_userId", ["userId"]),

  // Widen → migrate: preferences + notes for optional sync (M3/M4)
  preferences: defineTable({
    userId: v.id("users"),
    theme: v.optional(v.string()),
    privacyMode: v.optional(v.string()),
    workspaceId: v.optional(workspace),
    summaryStyle: v.optional(v.string()),
    tone: v.optional(v.string()),
    featurePrefsJson: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  notes: defineTable({
    userId: v.id("users"),
    clientId: v.string(),
    title: v.string(),
    body: v.string(),
    tags: v.array(v.string()),
    pinned: v.boolean(),
    favorite: v.boolean(),
    workspaceId: workspace,
    createdAt: v.number(),
    updatedAt: v.number(),
    deleted: v.optional(v.boolean()),
  })
    .index("by_clientId", ["clientId"])
    .index("by_userId", ["userId"]),
});
