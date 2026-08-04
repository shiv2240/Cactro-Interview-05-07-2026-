import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const workspace = v.union(
  v.literal("work"),
  v.literal("personal"),
  v.literal("coding"),
  v.literal("research"),
  v.literal("study")
);

export const list = query({
  args: { userId: v.id("users") },
  returns: v.array(
    v.object({
      id: v.string(),
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
  ),
  handler: async (ctx, { userId }) => {
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return notes
      .filter((n) => !n.deleted)
      .map((n) => ({
        id: n.clientId,
        title: n.title,
        body: n.body,
        tags: n.tags,
        pinned: n.pinned,
        favorite: n.favorite,
        workspaceId: n.workspaceId,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        deleted: n.deleted,
      }));
  },
});

export const save = mutation({
  args: {
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
  },
  returns: v.id("notes"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notes")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .first();

    if (existing) {
      if (existing.userId !== args.userId) {
        throw new Error("Unauthorized");
      }
      // Conflict: keep newer updatedAt
      if ((existing.updatedAt ?? 0) > args.updatedAt) {
        return existing._id;
      }
      await ctx.db.patch(existing._id, {
        title: args.title,
        body: args.body,
        tags: args.tags,
        pinned: args.pinned,
        favorite: args.favorite,
        workspaceId: args.workspaceId,
        updatedAt: args.updatedAt,
        deleted: args.deleted ?? false,
      });
      return existing._id;
    }

    return await ctx.db.insert("notes", {
      userId: args.userId,
      clientId: args.clientId,
      title: args.title,
      body: args.body,
      tags: args.tags,
      pinned: args.pinned,
      favorite: args.favorite,
      workspaceId: args.workspaceId,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      deleted: args.deleted ?? false,
    });
  },
});

export const remove = mutation({
  args: { clientId: v.string(), userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, { clientId, userId }) => {
    const existing = await ctx.db
      .query("notes")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .first();
    if (!existing || existing.userId !== userId) return false;
    await ctx.db.patch(existing._id, {
      deleted: true,
      updatedAt: Date.now(),
    });
    return true;
  },
});
