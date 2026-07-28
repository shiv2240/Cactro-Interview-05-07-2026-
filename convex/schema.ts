import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
  })
    .index("by_clientId", ["clientId"])
    .index("by_userId", ["userId"]),
});
