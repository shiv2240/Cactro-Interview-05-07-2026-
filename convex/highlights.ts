import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// List highlights for a specific user (newest first)
export const list = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, { userId }) => {
    const highlights = userId
      ? await ctx.db
          .query("highlights")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .order("desc")
          .collect()
      : [];
    return highlights.map((hl) => ({
      id: hl.clientId,
      text: hl.text,
      url: hl.url,
      title: hl.title,
      timestamp: hl.timestamp,
    }));
  },
});

// Save a new highlight for a user
export const save = mutation({
  args: {
    userId: v.optional(v.id("users")),
    clientId: v.string(),
    text: v.string(),
    url: v.string(),
    title: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Avoid duplicates
    const existing = await ctx.db
      .query("highlights")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("highlights", {
      userId: args.userId,
      clientId: args.clientId,
      text: args.text,
      url: args.url,
      title: args.title,
      timestamp: args.timestamp,
    });
  },
});

// Delete a highlight by clientId (scoped to user when userId provided)
export const remove = mutation({
  args: { clientId: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, { clientId, userId }) => {
    const existing = await ctx.db
      .query("highlights")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .first();
    if (existing && (!userId || existing.userId === userId)) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});
