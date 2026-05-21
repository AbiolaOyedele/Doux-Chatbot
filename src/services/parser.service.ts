import { anthropic } from "../lib/anthropic";
import type { ParseResult } from "../types/briefing";

const FIELD_LABELS: Record<string, string> = {
  handle:     "Speaker's Handle",
  time:       "Time",
  date:       "Date",
  occupation: "Occupation",
  topic:      "Topic",
  link:       "Link",
};

function buildExtractionPrompt(): string {
  const currentYear = new Date().getFullYear();
  return `You are extracting structured fields from a Google Chat message sent to a flyer-generation bot.

Extract these fields and return ONLY a valid JSON object with exactly these keys:
- handle: The speaker's Twitter/X handle (keep the @ if present, otherwise add it)
- time: The event time exactly as written (e.g. "8pm", "7:30 PM")
- date: The event date. If the year is omitted, append ${currentYear} (e.g. "May 15" → "May 15, ${currentYear}")
- occupation: The speaker's job title or professional role
- topic: The talk title or topic being discussed
- link: A full URL starting with http (registration, event, or speaker page)

Rules:
- Set a field to null if it cannot be found in the message
- Do not invent or guess values — only extract what is explicitly stated
- Return only the JSON object, no explanation, no markdown fences`;
}

export async function parseBriefing(rawText: string): Promise<ParseResult> {
  // Strip leading @mention (e.g. "@DesignBot " prepended by Chat)
  const text = rawText.replace(/^@\S+\s*/m, "").trim();

  if (!text) {
    return { ok: false, missingFields: Object.values(FIELD_LABELS) };
  }

  let parsed: Record<string, unknown>;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [
        { role: "user", content: `${buildExtractionPrompt()}\n\nMessage:\n${text}` },
      ],
    });

    const block = response.content[0];
    if (block.type !== "text") throw new Error("Unexpected response type");

    // Strip any accidental markdown code fences
    const json = block.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    console.error("[parser] Haiku extraction failed:", err);
    return { ok: false, missingFields: Object.values(FIELD_LABELS) };
  }

  const missingFields: string[] = [];
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const value = parsed[field];
    if (!value || typeof value !== "string" || value.trim().length === 0) {
      missingFields.push(label);
    }
  }

  if (missingFields.length > 0) {
    return { ok: false, missingFields };
  }

  return {
    ok: true,
    briefing: {
      handle:     (parsed.handle as string).trim(),
      time:       (parsed.time as string).trim(),
      date:       (parsed.date as string).trim(),
      occupation: (parsed.occupation as string).trim(),
      topic:      (parsed.topic as string).trim(),
      link:       (parsed.link as string).trim(),
    },
  };
}
