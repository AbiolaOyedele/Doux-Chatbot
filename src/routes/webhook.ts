import type { Request, Response } from "express";
import type { ChatEvent, PubSubEnvelope } from "../types/chat";
import { handleChatEvent } from "../services/bot.service";
import { verifyPubSubToken } from "../lib/google-chat";

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  console.log("[webhook] POST received, auth:", req.headers.authorization ? "present" : "absent");

  const authHeader = req.headers.authorization ?? "";

  const isVerified = await verifyPubSubToken(authHeader);
  console.log("[webhook] token verified:", isVerified);

  if (!isVerified) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const envelope = req.body as PubSubEnvelope;
  if (!envelope?.message?.data) {
    console.log("[webhook] no message data, acking empty");
    res.status(204).send();
    return;
  }

  // Acknowledge immediately — Pub/Sub retries on non-2xx or timeout
  res.status(204).send();

  // Process asynchronously after the ack
  void (async () => {
    try {
      const raw = Buffer.from(envelope.message.data, "base64").toString("utf-8");
      console.log("[webhook] decoded event:", raw.slice(0, 1500));
      const event = JSON.parse(raw) as ChatEvent;
      await handleChatEvent(event);
    } catch (err) {
      console.error("[webhook] Failed to process event:", err);
    }
  })();
}
