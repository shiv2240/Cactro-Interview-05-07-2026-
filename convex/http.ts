import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

// -- CORS ---------------------------------------------------------------------

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

// -- Auth middleware ----------------------------------------------------------

async function getSession(
  ctx: { runQuery: Function },
  request: Request
): Promise<{ userId: Id<"users">; email: string } | null> {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return await ctx.runQuery(api.auth.validateSession, { token });
}

// -- OPTIONS preflight --------------------------------------------------------

for (const path of [
  "/auth/register",
  "/auth/login",
  "/auth/logout",
  "/auth/change-password",
  "/highlights",
  "/notes",
  "/preferences",
]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
  });
}

http.route({
  pathPrefix: "/highlights/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  pathPrefix: "/notes/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

// -- Auth routes --------------------------------------------------------------

// POST /auth/register
http.route({
  path: "/auth/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return json({ error: "Email and password required" }, 400);
      const result = await ctx.runMutation(api.auth.register, { email, password });
      return json(result);
    } catch (err: any) {
      return json({ error: err.message ?? "Registration failed" }, 400);
    }
  }),
});

// POST /auth/login
http.route({
  path: "/auth/login",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { email, password } = await request.json();
      if (!email || !password) return json({ error: "Email and password required" }, 400);
      const result = await ctx.runMutation(api.auth.login, { email, password });
      return json(result);
    } catch (err: any) {
      return json({ error: err.message ?? "Login failed" }, 401);
    }
  }),
});

// POST /auth/logout
http.route({
  path: "/auth/logout",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { token } = await request.json();
      await ctx.runMutation(api.auth.logout, { token });
      return json({ success: true });
    } catch {
      return json({ success: false }, 400);
    }
  }),
});

// POST /auth/change-password
http.route({
  path: "/auth/change-password",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { token, currentPassword, newPassword } = await request.json();
      if (!token || !currentPassword || !newPassword) {
        return json({ error: "Token, current password, and new password required" }, 400);
      }
      const result = await ctx.runMutation(api.auth.changePassword, {
        token,
        currentPassword,
        newPassword,
      });
      return json(result);
    } catch (err: any) {
      return json({ error: err.message ?? "Failed to change password" }, 400);
    }
  }),
});


// -- Highlights routes (auth required) ----------------------------------------

// GET /highlights
http.route({
  path: "/highlights",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const highlights = await ctx.runQuery(api.highlights.list, { userId: session.userId });
    return json(highlights);
  }),
});

// POST /highlights
http.route({
  path: "/highlights",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);

    try {
      const body = await request.json();
      const { id, text, url, title, timestamp } = body;
      if (!id || !text || !url || !title || !timestamp)
        return json({ error: "Missing required fields" }, 400);

      const convexId = await ctx.runMutation(api.highlights.save, {
        userId: session.userId,
        clientId: id,
        text,
        url,
        title,
        timestamp,
      });
      return json({ success: true, _id: convexId });
    } catch (err: any) {
      return json({ error: err.message ?? "Failed to save" }, 400);
    }
  }),
});

// DELETE /highlights/:clientId
http.route({
  pathPrefix: "/highlights/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const url = new URL(request.url);
    const clientId = url.pathname.replace("/highlights/", "");
    if (!clientId) return json({ error: "Missing highlight ID" }, 400);

    const deleted = await ctx.runMutation(api.highlights.remove, {
      clientId,
      userId: session.userId,
    });
    return json({ success: deleted }, deleted ? 200 : 404);
  }),
});

// -- Notes routes (auth required) ---------------------------------------------

http.route({
  path: "/notes",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const notes = await ctx.runQuery(api.notes.list, { userId: session.userId });
    return json(notes);
  }),
});

http.route({
  path: "/notes",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const id = typeof body.id === "string" ? body.id : null;
      const title = typeof body.title === "string" ? body.title : null;
      const noteBody = typeof body.body === "string" ? body.body : null;
      if (!id || title === null || noteBody === null) {
        return json({ error: "Missing required fields" }, 400);
      }
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((t): t is string => typeof t === "string")
        : [];
      const workspaceId =
        body.workspaceId === "work" ||
        body.workspaceId === "personal" ||
        body.workspaceId === "coding" ||
        body.workspaceId === "research" ||
        body.workspaceId === "study"
          ? body.workspaceId
          : "personal";
      const createdAt = typeof body.createdAt === "number" ? body.createdAt : Date.now();
      const updatedAt = typeof body.updatedAt === "number" ? body.updatedAt : Date.now();
      const convexId = await ctx.runMutation(api.notes.save, {
        userId: session.userId,
        clientId: id,
        title,
        body: noteBody,
        tags,
        pinned: Boolean(body.pinned),
        favorite: Boolean(body.favorite),
        workspaceId,
        createdAt,
        updatedAt,
        deleted: Boolean(body.deleted),
      });
      return json({ success: true, _id: convexId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save note";
      return json({ error: message }, 400);
    }
  }),
});

http.route({
  pathPrefix: "/notes/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const url = new URL(request.url);
    const clientId = url.pathname.replace("/notes/", "");
    if (!clientId) return json({ error: "Missing note ID" }, 400);
    const deleted = await ctx.runMutation(api.notes.remove, {
      clientId,
      userId: session.userId,
    });
    return json({ success: deleted }, deleted ? 200 : 404);
  }),
});

// -- Preferences --------------------------------------------------------------

http.route({
  path: "/preferences",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const prefs = await ctx.runQuery(api.preferences.get, { userId: session.userId });
    return json(prefs);
  }),
});

http.route({
  path: "/preferences",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const session = await getSession(ctx, request);
    if (!session) return json({ error: "Unauthorized" }, 401);
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const updatedAt = typeof body.updatedAt === "number" ? body.updatedAt : Date.now();
      const workspaceId =
        body.workspaceId === "work" ||
        body.workspaceId === "personal" ||
        body.workspaceId === "coding" ||
        body.workspaceId === "research" ||
        body.workspaceId === "study"
          ? body.workspaceId
          : undefined;
      const id = await ctx.runMutation(api.preferences.upsert, {
        userId: session.userId,
        theme: typeof body.theme === "string" ? body.theme : undefined,
        privacyMode: typeof body.privacyMode === "string" ? body.privacyMode : undefined,
        workspaceId,
        summaryStyle: typeof body.summaryStyle === "string" ? body.summaryStyle : undefined,
        tone: typeof body.tone === "string" ? body.tone : undefined,
        featurePrefsJson:
          typeof body.featurePrefsJson === "string" ? body.featurePrefsJson : undefined,
        updatedAt,
      });
      return json({ success: true, _id: id });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save preferences";
      return json({ error: message }, 400);
    }
  }),
});

export default http;
