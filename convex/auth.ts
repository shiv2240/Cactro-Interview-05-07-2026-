import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// -- Helpers ------------------------------------------------------------------

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// -- Mutations ----------------------------------------------------------------

export const register = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const normalised = email.toLowerCase().trim();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalised))
      .first();
    if (existing) throw new Error("Email already registered");

    const passwordHash = await hashPassword(password);
    const userId = await ctx.db.insert("users", { email: normalised, passwordHash });

    const token = generateToken();
    await ctx.db.insert("sessions", {
      userId,
      token,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return { token, email: normalised };
  },
});

export const login = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const normalised = email.toLowerCase().trim();
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalised))
      .first();
    if (!user) throw new Error("Invalid email or password");

    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.passwordHash) throw new Error("Invalid email or password");

    const token = generateToken();
    await ctx.db.insert("sessions", {
      userId: user._id,
      token,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return { token, email: user.email };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (session) await ctx.db.delete(session._id);
    return true;
  },
});

export const changePassword = mutation({
  args: { token: v.string(), currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, currentPassword, newPassword }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!session || session.expiresAt < Date.now()) throw new Error("Unauthorized or session expired");

    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");

    const currentHash = await hashPassword(currentPassword);
    if (currentHash !== user.passwordHash) throw new Error("Incorrect current password");

    if (newPassword.length < 6) throw new Error("New password must be at least 6 characters");

    const newHash = await hashPassword(newPassword);
    await ctx.db.patch(user._id, { passwordHash: newHash });

    return { success: true };
  },
});


// -- Queries ------------------------------------------------------------------

export const validateSession = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!session || session.expiresAt < Date.now()) return null;

    const user = await ctx.db.get(session.userId);
    if (!user) return null;

    return { userId: session.userId, email: user.email };
  },
});
