import { getDB } from "./schema";
import type { AITimelineEvent } from "../types";

const MAX_EVENTS = 300;

export async function addTimelineEvent(
  event: Omit<AITimelineEvent, "id"> & { id?: string }
): Promise<AITimelineEvent> {
  const db = await getDB();
  const full: AITimelineEvent = {
    ...event,
    id: event.id ?? crypto.randomUUID(),
  };
  await db.put("timeline", full);

  const all = await db.getAllFromIndex("timeline", "by-created");
  if (all.length > MAX_EVENTS) {
    const excess = all.slice(0, all.length - MAX_EVENTS);
    for (const e of excess) await db.delete("timeline", e.id);
  }
  return full;
}

export async function listTimeline(limit = 50): Promise<AITimelineEvent[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("timeline", "by-created");
  return all.reverse().slice(0, limit);
}
