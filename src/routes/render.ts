import type { Request, Response } from "express";
import { z } from "zod";
import { renderFlyer } from "../services/renderer.service";
import { isAppError } from "../lib/errors";

const briefingSchema = z.object({
  handle:     z.string().min(1),
  time:       z.string().min(1),
  date:       z.string().min(1),
  occupation: z.string().min(1),
  topic:      z.string().min(1),
  link:       z.string().url(),
  photo:      z.string().min(1), // base64-encoded image bytes
});

export async function renderHandler(req: Request, res: Response): Promise<void> {
  const parsed = briefingSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: "RENDER_INVALID_INPUT", message: "Invalid or missing fields.", details: parsed.error.flatten() },
    });
    return;
  }

  const { photo, ...briefing } = parsed.data;

  try {
    const photoBuffer = Buffer.from(photo, "base64");
    const pngBuffer   = await renderFlyer(briefing, photoBuffer);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", pngBuffer.length);
    res.send(pngBuffer);
  } catch (err) {
    const message = isAppError(err) ? err.message : "Failed to render flyer.";
    const code    = isAppError(err) ? err.code    : "RENDER_FAILED";
    res.status(500).json({ error: { code, message } });
  }
}
