import type { ChatEvent, ChatAttachment } from "../types/chat";
import type { ParsedBriefing } from "../types/briefing";
import { parseBriefing } from "./parser.service";
import { renderFlyer } from "./renderer.service";
import { downloadAttachment, postTextMessage, postFlyerAsFile } from "../lib/google-chat";
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

  // Non-trivial text: message has content beyond the @mention prefix
  const bodyText = (message.text ?? "").replace(/^@\S+\s*/m, "").trim();
  const hasText  = bodyText.length > 0;

  // ── Photo only: look up a pending briefing from a previous message ─────────
  if (imageAttachment && !hasText) {
    const pending = consumePending(spaceName);
    if (!pending) {
      await postTextMessage(
        spaceName,
        `I don't have any briefing details for this space yet.\n\n${FORMAT_HINT}`,
        threadName,
      );
      return;
    }
    await renderAndPost(spaceName, threadName, pending, imageAttachment);
    return;
  }

  // ── Text (with or without photo) ──────────────────────────────────────────
  if (hasText) {
    const parseResult = await parseBriefing(message.text);

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
      await postTextMessage(
        spaceName,
        "Got the details! Now send the speaker's photo and I'll generate the flyer. 🎨",
        threadName,
      );
    }
  }
}
