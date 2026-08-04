import { aiHealth, generateAI, streamAI } from "../shared/ai/AIService";
import { seedGroqKeyFromBundle, setGroqApiKey } from "../shared/ai/swConfig";
import {
  deleteHighlight,
  listHighlights,
  saveHighlight,
  searchHighlights,
} from "../shared/db/highlights";
import { deleteNote, listNotes, searchNotes, upsertNote } from "../shared/db/notes";
import { getPrefs, setPrefs } from "../shared/db/schema";
import { listTimeline } from "../shared/db/timeline";
import {
  MessageType,
  broadcastHighlightsChanged,
  broadcastNotesChanged,
  validateMessage,
  type ExtensionRequest,
  type ExtensionResponse,
} from "../shared/messaging/protocol";
import { getProfile, recordFeedback } from "../shared/personalization/engine";
import {
  hydratePrefsFromChromeStorage,
  mirrorPrefsToChromeStorage,
} from "../shared/prefs/bridge";
import {
  authStatus,
  changePassword,
  login,
  logout,
  register,
  syncNow,
} from "../shared/sync/engine";
import { indexDocument, semanticSearch } from "../shared/vector/engine";

async function ensureSidePanelOpensOnAction(): Promise<void> {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch {
    /* sidePanel API unavailable in this context */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void hydratePrefsFromChromeStorage();
  void seedGroqKeyFromBundle();
  void ensureSidePanelOpensOnAction();
});

chrome.runtime.onStartup.addListener(() => {
  void seedGroqKeyFromBundle();
  void ensureSidePanelOpensOnAction();
});

// Re-apply on every service worker wake (onInstalled alone is not enough after updates).
void ensureSidePanelOpensOnAction();
void hydratePrefsFromChromeStorage();
void seedGroqKeyFromBundle();

// Fallback when openPanelOnActionClick is not active (onClicked does not fire when it is).
chrome.action?.onClicked?.addListener((tab) => {
  void (async () => {
    await ensureSidePanelOpensOnAction();
    if (tab.id != null && chrome.sidePanel?.open) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch {
        /* ignore — panel may already be open */
      }
    }
  })();
});

chrome.alarms.create("sync-tick", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync-tick") void syncNow().catch(() => undefined);
});

async function handle(message: ExtensionRequest): Promise<unknown> {
  switch (message.type) {
    case MessageType.PING:
      return { pong: true, version: "2.0.0" };

    case MessageType.SAVE_HIGHLIGHT: {
      const hl = await saveHighlight(message);
      broadcastHighlightsChanged();
      void indexDocument({
        sourceType: "highlight",
        sourceId: hl.id,
        workspaceId: hl.workspaceId,
        text: `${hl.title}\n${hl.text}`,
      });
      void syncNow().catch(() => undefined);
      return hl;
    }

    case MessageType.LIST_HIGHLIGHTS:
      return listHighlights(message.workspaceId);

    case MessageType.DELETE_HIGHLIGHT: {
      const ok = await deleteHighlight(message.id);
      if (ok) broadcastHighlightsChanged();
      void syncNow().catch(() => undefined);
      return { deleted: ok };
    }

    case MessageType.SEARCH_HIGHLIGHTS:
      return searchHighlights(message.query, message.workspaceId);

    case MessageType.PREFS_GET:
      return getPrefs();

    case MessageType.PREFS_SET: {
      if (message.prefs.groqApiKey !== undefined) {
        await setGroqApiKey(message.prefs.groqApiKey);
      }
      const { groqApiKey: _k, ...rest } = message.prefs;
      const next = await setPrefs(rest);
      await mirrorPrefsToChromeStorage();
      void syncNow().catch(() => undefined);
      return next;
    }

    case MessageType.AI_GENERATE:
      return generateAI({
        action: message.action,
        text: message.text,
        pageTitle: message.pageTitle,
        url: message.url,
      });

    case MessageType.AI_STREAM: {
      // Streaming is handled specially in onMessage to post chunks
      return { started: true };
    }

    case MessageType.AI_HEALTH:
      return aiHealth({ recheck: message.recheck });

    case MessageType.AUTH_LOGIN:
      return login(message.email, message.password);

    case MessageType.AUTH_REGISTER:
      return register(message.email, message.password);

    case MessageType.AUTH_LOGOUT:
      await logout();
      return { ok: true };

    case MessageType.AUTH_STATUS:
      return authStatus();

    case MessageType.AUTH_CHANGE_PASSWORD:
      return changePassword(message.currentPassword, message.newPassword);

    case MessageType.SYNC_NOW:
      return syncNow();

    case MessageType.NOTE_UPSERT: {
      const note = await upsertNote(message.note);
      broadcastNotesChanged();
      void indexDocument({
        sourceType: "note",
        sourceId: note.id,
        workspaceId: note.workspaceId,
        text: `${note.title}\n${note.body}\n${note.tags.join(" ")}`,
      });
      void syncNow().catch(() => undefined);
      return note;
    }

    case MessageType.NOTE_LIST:
      return listNotes(message.workspaceId);

    case MessageType.NOTE_DELETE: {
      const ok = await deleteNote(message.id);
      if (ok) broadcastNotesChanged();
      void syncNow().catch(() => undefined);
      return { deleted: ok };
    }

    case MessageType.NOTE_SEARCH:
      return searchNotes(message.query, message.workspaceId);

    case MessageType.TIMELINE_LIST:
      return listTimeline(message.limit ?? 50);

    case MessageType.VECTOR_SEARCH:
      return semanticSearch({
        query: message.query,
        workspaceId: message.workspaceId,
        limit: message.limit,
      });

    case MessageType.PERSONALIZATION_GET:
      return getProfile();

    case MessageType.PERSONALIZATION_FEEDBACK:
      return recordFeedback(message);

    case MessageType.SET_WORKSPACE: {
      const next = await setPrefs({ workspaceId: message.workspaceId });
      await mirrorPrefsToChromeStorage();
      return next;
    }

    case MessageType.OPEN_SIDE_PANEL: {
      // Caller should pass tab via sendResponse path; handled below
      return { opened: false };
    }

    default:
      throw new Error("Unhandled message");
  }
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  // Ignore broadcast events (and stream chunks) so they don't hit request validation.
  if (
    raw &&
    typeof raw === "object" &&
    "type" in raw &&
    (raw.type === MessageType.HIGHLIGHTS_CHANGED ||
      raw.type === MessageType.NOTES_CHANGED ||
      raw.type === MessageType.AI_STREAM_CHUNK ||
      raw.type === MessageType.AI_STREAM_DONE)
  ) {
    return;
  }

  void (async () => {
    try {
      const message = validateMessage(raw);

      if (message.type === MessageType.OPEN_SIDE_PANEL) {
        const tabId = sender.tab?.id;
        if (tabId != null && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ tabId });
          sendResponse({ ok: true, data: { opened: true } } satisfies ExtensionResponse);
          return;
        }
        sendResponse({
          ok: false,
          error: "Unable to open side panel from this context",
        } satisfies ExtensionResponse);
        return;
      }

      if (message.type === MessageType.AI_STREAM) {
        const tabId = sender.tab?.id;
        void (async () => {
          try {
            for await (const part of streamAI({
              action: message.action,
              text: message.text,
              pageTitle: message.pageTitle,
              url: message.url,
            })) {
              const payload = {
                type: part.done ? MessageType.AI_STREAM_DONE : MessageType.AI_STREAM_CHUNK,
                requestId: message.requestId,
                chunk: part.chunk,
                envelope: part.envelope,
              };
              if (tabId != null) {
                chrome.tabs.sendMessage(tabId, payload).catch(() => undefined);
              }
              // Also broadcast for side panel listeners
              chrome.runtime.sendMessage(payload).catch(() => undefined);
            }
          } catch (e) {
            const errPayload = {
              type: MessageType.AI_STREAM_DONE,
              requestId: message.requestId,
              chunk: "",
              error: e instanceof Error ? e.message : String(e),
            };
            if (tabId != null) {
              chrome.tabs.sendMessage(tabId, errPayload).catch(() => undefined);
            }
            chrome.runtime.sendMessage(errPayload).catch(() => undefined);
          }
        })();
        sendResponse({ ok: true, data: { started: true } } satisfies ExtensionResponse);
        return;
      }

      const data = await handle(message);
      sendResponse({ ok: true, data } satisfies ExtensionResponse);
    } catch (e) {
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      } satisfies ExtensionResponse);
    }
  })();
  return true;
});
