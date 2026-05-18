import type { ChatEvent } from "../types/chat";
import { parseBriefing } from "./parser.service";
import { renderFlyer } from "./renderer.service";
import { downloadAttachment, postTextMessage, postFlyerMessage } from "../lib/google-chat";
import { uploadFlyer } from "../lib/supabase";
import { env } from "../config/env";
import { isAppError } from "../lib/errors";

// ── Deduplication ─────────────────────────────────────────────────────────────
// Tracks processed message names to prevent double-handling when a message
// in the dedicated space is also an @mention.

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

// ── Space resolution ──────────────────────────────────────────────────────────

function isDedicatedSpace(spaceName: string): boolean {
  return (
    spaceName === `spaces/${env.DEDICATED_SPACE_ID}` ||
    spaceName === env.DEDICATED_SPACE_ID
  );
}

// ── Expected format hint (sent on parse failure) ──────────────────────────────

const FORMAT_HINT = [
  "Expected format:",
  "```",
  "Speaker's Handle: @handle",
  "Time: 8pm",
  "Date: May 15",
  "Occupation: Role",
  "Topic: Talk title",
  "Link: https://...",
  "```",
  "Also attach the speaker's photo to the message.",
].join("\n");

// ── Main handler ──────────────────────────────────────────────────────────────

// Normalise both the legacy flat format and the Add-on nested format into a
// single shape so the rest of the handler doesn't need to branch.
function extractEventParts(event: ChatEvent) {
  if (event.chat) {
    // Add-on format: { chat: { eventType, user, space, message } }
    return {
      eventType: event.chat.eventType,
      message:   event.chat.message,
      space:     event.chat.space,
    };
  }
  // Legacy flat format: { type, message, space }
  return {
    eventType: event.type,
    message:   event.message,
    space:     event.space,
  };
}

export async function handleChatEvent(event: ChatEvent): Promise<void> {
  const { eventType, message, space } = extractEventParts(event);

  // Ignore non-message events (ADDED_TO_SPACE, etc.)
  if (eventType !== "MESSAGE") {
    console.log("[bot] ignoring event type:", eventType);
    return;
  }

  if (!message || !space) {
    console.log("[bot] missing message or space, skipping");
    return;
  }

  // Ignore messages from other bots
  if (message.sender.type === "BOT") return;

  const spaceName  = message.space?.name ?? space.name;
  const threadName = message.thread.name;
  const msgName    = message.name;

  // In non-dedicated spaces, the bot only receives events when @mentioned —
  // no extra filtering needed. Dedup handles the case where the dedicated
  // space message also triggers an @mention event.
  if (!isDedicatedSpace(spaceName) && !isDedicatedSpace(space.name)) {
    // @mention from an outside space — process it
  }

  if (isDuplicate(msgName)) return;

  // ── Parse briefing fields ─────────────────────────────────────────────────
  const parseResult = parseBriefing(message.text);

  if (!parseResult.ok) {
    const fieldList = parseResult.missingFields.map((f) => `• ${f}`).join("\n");
    await postTextMessage(
      spaceName,
      `Missing required fields:\n${fieldList}\n\n${FORMAT_HINT}`,
      threadName,
    );
    return;
  }

  // ── Require an image attachment ───────────────────────────────────────────
  const imageAttachment = message.attachment?.find(
    (a) => a.source === "UPLOADED_CONTENT" && a.contentType.startsWith("image/"),
  );

  if (!imageAttachment) {
    await postTextMessage(
      spaceName,
      `Please attach the speaker's photo to the message.\n\n${FORMAT_HINT}`,
      threadName,
    );
    return;
  }

  // ── Render and post ───────────────────────────────────────────────────────
  try {
    const photoBuffer = await downloadAttachment(imageAttachment.attachmentDataRef.resourceName);
    const pngBuffer   = await renderFlyer(parseResult.briefing, photoBuffer);
    const imageUrl    = await uploadFlyer(pngBuffer, spaceName);
    await postFlyerMessage(spaceName, imageUrl, threadName);
  } catch (err) {
    const userMessage = isAppError(err)
      ? err.message
      : "Something went wrong while generating the flyer. Please try again.";

    await postTextMessage(spaceName, userMessage, threadName);

    if (!isAppError(err)) {
      console.error("[bot] Unexpected error:", err);
    }
  }
}
