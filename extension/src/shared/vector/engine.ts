import { getDB } from "../db/schema";
import type { VectorRecord, WorkspaceId } from "../types";

/** Lightweight local bag-of-words embeddings (no remote calls). */
const DIM = 64;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 2);
}

export function embedText(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = tokenize(text);
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
    const idx = Math.abs(h) % DIM;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!;
  return s;
}

export async function indexDocument(input: {
  sourceType: "note" | "highlight";
  sourceId: string;
  workspaceId: WorkspaceId;
  text: string;
}): Promise<void> {
  const db = await getDB();
  const id = `${input.sourceType}:${input.sourceId}`;
  const record: VectorRecord = {
    id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
    embedding: embedText(input.text),
    textPreview: input.text.slice(0, 240),
    updatedAt: Date.now(),
  };
  await db.put("vectors", record);
}

export async function semanticSearch(input: {
  query: string;
  workspaceId?: WorkspaceId;
  limit?: number;
}): Promise<Array<VectorRecord & { score: number }>> {
  const db = await getDB();
  const prefsQuery = input.workspaceId
    ? await db.getAllFromIndex("vectors", "by-workspace", input.workspaceId)
    : await db.getAll("vectors");
  const q = embedText(input.query);
  const scored = prefsQuery
    .map((r) => ({ ...r, score: cosine(q, r.embedding) }))
    .filter((r) => r.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 10);
  return scored;
}

export async function reindexIdle(
  docs: Array<{
    sourceType: "note" | "highlight";
    sourceId: string;
    workspaceId: WorkspaceId;
    text: string;
  }>
): Promise<number> {
  let n = 0;
  for (const d of docs) {
    await indexDocument(d);
    n++;
  }
  return n;
}
