import type { ChatEvent, ChatAttachment, ChatSpace } from "../types/chat";
import type { ParsedBriefing } from "../types/briefing";
import { parseBriefing } from "./parser.service";
import { renderFlyer } from "./renderer.service";
import { downloadAttachment, postTextMessage, postFlyerAsFile, fetchThreadMessages } from "../lib/google-chat";
import { isAppError } from "../lib/errors";

// ── Deduplication ─────────────────────────────────────────────────────────────

const processedMessages = new Set<string>();
const MAX_DEDUP_CACHE = 1000;

function isDuplicate(messageName: string): boolean {
  if (processedMessages.has(messageName)) return true;
  if (processedMessages.size >= MAX_DEDUP_CACHE) {
    const oldest = processedMessages.values().next().value;
    if (oldest !== undefined) processedMessages.delete(oldest);
  }
  processedMessages.add(messageName);
  return false;
}

// ── Pending briefings (text received, waiting for photo) ──────────────────────
// Keyed by spaceName. Briefings expire after 30 minutes.

interface PendingEntry {
  briefing: ParsedBriefing;
  storedAt: number;
}

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes
const pendingBriefings = new Map<string, PendingEntry>();

function storePending(spaceName: string, briefing: ParsedBriefing): void {
  pendingBriefings.set(spaceName, { briefing, storedAt: Date.now() });
}

function consumePending(spaceName: string): ParsedBriefing | null {
  const entry = pendingBriefings.get(spaceName);
  if (!entry) return null;
  pendingBriefings.delete(spaceName);
  if (Date.now() - entry.storedAt > PENDING_TTL_MS) return null; // expired
  return entry.briefing;
}

// ── Format hint ───────────────────────────────────────────────────────────────

const FORMAT_HINT = [
  "Send me the briefing like this (any format works):",
  "```",
  "Speaker: @handle",
  "Time: 8pm",
  "Date: May 15",
  "Role: Engineer",
  "Topic: Talk title",
  "Link: https://...",
  "```",
  "Then attach or send the speaker's photo.",
].join("\n");

// ── Event normaliser ──────────────────────────────────────────────────────────
// Google Chat sends the Add-on event format: { commonEventObject, chat: { ... } }
// The legacy flat format { type, message, space } is also supported.

function extractEventParts(event: ChatEvent) {
  if (event.chat) {
    // Add-on format wraps message + space under chat.messagePayload in newer
    // API versions; fall back to chat.message / chat.space for older shapes.
    const message = event.chat.messagePayload?.message ?? event.chat.message;
    const space   = event.chat.messagePayload?.space   ?? event.chat.space;

    const eventType =
      event.chat.eventType ??
      event.chat.type ??
      (message ? "MESSAGE" : undefined) as typeof event.chat.type;

    return { eventType, message, space };
  }

  return {
    eventType: event.type,
    message:   event.message,
    space:     event.space,
  };
}

// ── Space helpers ─────────────────────────────────────────────────────────────

function isDm(space: ChatSpace): boolean {
  return !!(
    space.singleUserBotDm ||
    space.type === "DIRECT_MESSAGE" ||
    space.spaceType === "DIRECT_MESSAGE"
  );
}

// ── Render and post ───────────────────────────────────────────────────────────

async function renderAndPost(
  spaceName: string,
  threadName: string,
  briefing: ParsedBriefing,
  imageAttachment: ChatAttachment,
): Promise<void> {
  try {
    const photoBuffer = await downloadAttachment(imageAttachment.attachmentDataRef.resourceName);
    const pngBuffer   = await renderFlyer(briefing, photoBuffer);

    const slug     = briefing.handle.replace(/[^a-z0-9]/gi, "").toLowerCase() || "speaker";
    const filename = `doux-${slug}-${Date.now()}.png`;
    await postFlyerAsFile(spaceName, pngBuffer, filename, threadName);
  } catch (err) {
    const userMessage = isAppError(err)
      ? err.message
      : "Something went wrong while generating the flyer. Please try again.";
    await postTextMessage(spaceName, userMessage, threadName);
    if (!isAppError(err)) console.error("[bot] Unexpected error:", err);
  }
}

// ── Thread context scanner ────────────────────────────────────────────────────

interface ThreadContext {
  textContent: string | null;
  imageAttachment: import("../types/chat").ChatAttachment | null;
}

async function scanThread(spaceName: string, threadName: string): Promise<ThreadContext> {
  const messages = await fetchThreadMessages(spaceName, threadName);
  const humanMessages = messages.filter((m) => m.sender.type !== "BOT");

  // Most-recent message with text content (strip mention tokens)
  const textMsg = humanMessages.find((m) => {
    const t = (m.argumentText ?? m.text ?? "").replace(/<users\/[^>]+>\s*/g, "").trim();
    return t.length > 0;
  });
  const textContent = textMsg
    ? (textMsg.argumentText?.trim() ||
       (textMsg.text ?? "").replace(/<users\/[^>]+>\s*/g, "").replace(/^@\S+\s*/m, "").trim()) || null
    : null;

  // Most-recent message with an image attachment
  const imgMsg = humanMessages.find((m) =>
    m.attachment?.some((a) => a.contentType.startsWith("image/")),
  );
  const imageAttachment =
    imgMsg?.attachment?.find((a) => a.contentType.startsWith("image/")) ?? null;

  return { textContent, imageAttachment };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleChatEvent(event: ChatEvent): Promise<void> {
  const { eventType, message, space } = extractEventParts(event);

  // Ignore non-message events (ADDED_TO_SPACE, etc.) and malformed payloads
  if (eventType !== "MESSAGE") return;
  if (!message || !space) return;

  if (message.sender.type === "BOT") return;
  if (isDuplicate(message.name)) return;

  const spaceName  = message.space?.name ?? space.name;
  const threadName = message.thread.name;

  // Accept both directly-uploaded images and Drive-attached images
  const imageAttachment = message.attachment?.find(
    (a) => a.contentType.startsWith("image/"),
  );

  if (message.attachment?.length) {
    console.log("[bot] attachments:", JSON.stringify(message.attachment.map(
      (a) => ({ source: a.source, contentType: a.contentType }),
    )));
  }

  // argumentText is pre-stripped of @mentions by Google Chat.
  // Fall back to manual stripping of message.text for older event shapes.
  const bodyText = (
    message.argumentText?.trim() ||
    (message.text ?? "").replace(/<users\/[^>]+>\s*/g, "").replace(/^@\S+\s*/m, "").trim()
  );
  const hasText = bodyText.length > 0;

  // ── Photo only (tagged with image, no text) ───────────────────────────────
  if (imageAttachment && !hasText) {
    // 1. Check in-memory pending briefing (user sent text earlier this session)
    const pending = consumePending(spaceName);
    if (pending) {
      await renderAndPost(spaceName, threadName, pending, imageAttachment);
      return;
    }
    // 2. Fall back: scan the thread for a message that has briefing text
    const { textContent } = await scanThread(spaceName, threadName);
    if (textContent) {
      const parseResult = await parseBriefing(textContent);
      if (parseResult.ok) {
        await renderAndPost(spaceName, threadName, parseResult.briefing, imageAttachment);
        return;
      }
    }
    await postTextMessage(
      spaceName,
      `I don't have any briefing details for this space yet.\n\n${FORMAT_HINT}`,
      threadName,
    );
    return;
  }

  // ── Tagged with no text and no image — scan the thread for everything ─────
  if (!hasText && !imageAttachment) {
    const { textContent, imageAttachment: threadImg } = await scanThread(spaceName, threadName);

    if (!textContent && !threadImg) {
      await postTextMessage(spaceName, FORMAT_HINT, threadName);
      return;
    }

    let briefingFromThread = null;
    if (textContent) {
      const parseResult = await parseBriefing(textContent);
      if (parseResult.ok) briefingFromThread = parseResult.briefing;
    }

    if (briefingFromThread && threadImg) {
      // Found everything in the thread — generate immediately
      await renderAndPost(spaceName, threadName, briefingFromThread, threadImg);
    } else if (briefingFromThread) {
      storePending(spaceName, briefingFromThread);
      const photoPrompt = isDm(space)
        ? "Got the details from the thread! Now send the speaker's photo and I'll generate the flyer. 🎨"
        : "Got the details from the thread! Now @mention me and attach the speaker's photo and I'll generate the flyer. 🎨";
      await postTextMessage(spaceName, photoPrompt, threadName);
    } else {
      await postTextMessage(
        spaceName,
        `I found a message in the thread but couldn't extract all the details I need.\n\n${FORMAT_HINT}`,
        threadName,
      );
    }
    return;
  }

  // ── Text (with or without photo in same message) ──────────────────────────
  if (hasText) {
    const parseResult = await parseBriefing(bodyText);

    if (!parseResult.ok) {
      const fieldList = parseResult.missingFields.map((f) => `• ${f}`).join("\n");
      await postTextMessage(
        spaceName,
        `I couldn't find all the details I need:\n${fieldList}\n\n${FORMAT_HINT}`,
        threadName,
      );
      return;
    }

    if (imageAttachment) {
      // Text + photo in the same message — generate immediately
      await renderAndPost(spaceName, threadName, parseResult.briefing, imageAttachment);
    } else {
      // Text only — store and wait for photo
      storePending(spaceName, parseResult.briefing);
      const photoPrompt = isDm(space)
        ? "Got the details! Now send the speaker's photo and I'll generate the flyer. 🎨"
        : "Got the details! Now @mention me and attach the speaker's photo in the same message and I'll generate the flyer. 🎨";
      await postTextMessage(spaceName, photoPrompt, threadName);
    }
  }
}
