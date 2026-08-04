import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const workspace = v.union(
  v.literal("work"),
  v.literal("personal"),
  v.literal("coding"),
  v.literal("research"),
  v.literal("study")
);

export const get = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      theme: v.optional(v.string()),
      privacyMode: v.optional(v.string()),
      workspaceId: v.optional(workspace),
      summaryStyle: v.optional(v.string()),
      tone: v.optional(v.string()),
      featurePrefsJson: v.optional(v.string()),
      updatedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!row) return null;
    return {
      theme: row.theme,
      privacyMode: row.privacyMode,
      workspaceId: row.workspaceId,
      summaryStyle: row.summaryStyle,
      tone: row.tone,
      featurePrefsJson: row.featurePrefsJson,
      updatedAt: row.updatedAt,
    };
  },
});

export const upsert = mutation({
  args: {
    userId: v.id("users"),
    theme: v.optional(v.string()),
    privacyMode: v.optional(v.string()),
    workspaceId: v.optional(workspace),
    summaryStyle: v.optional(v.string()),
    tone: v.optional(v.string()),
    featurePrefsJson: v.optional(v.string()),
    updatedAt: v.number(),
  },
  returns: v.id("preferences"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("preferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) {
      if ((existing.updatedAt ?? 0) > args.updatedAt) return existing._id;
      await ctx.db.patch(existing._id, {
        theme: args.theme,
        privacyMode: args.privacyMode,
        workspaceId: args.workspaceId,
        summaryStyle: args.summaryStyle,
        tone: args.tone,
        featurePrefsJson: args.featurePrefsJson,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert("preferences", {
      userId: args.userId,
      theme: args.theme,
      privacyMode: args.privacyMode,
      workspaceId: args.workspaceId,
      summaryStyle: args.summaryStyle,
      tone: args.tone,
      featurePrefsJson: args.featurePrefsJson,
      updatedAt: args.updatedAt,
    });
  },
});
