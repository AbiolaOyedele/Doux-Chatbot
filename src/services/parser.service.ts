import type { ParseResult } from "../types/briefing";

const FIELD_PATTERNS: Record<string, RegExp> = {
  handle:     /^Speaker'?s?\s+Handle\s*:\s*(.+)/im,
  time:       /^Time\s*:\s*(.+)/im,
  date:       /^Date\s*:\s*(.+)/im,
  occupation: /^Occupation\s*:\s*(.+)/im,
  topic:      /^Topic\s*:\s*(.+)/im,
  link:       /^Link\s*:\s*(https?:\/\/\S+)/im,
};

const FIELD_LABELS: Record<string, string> = {
  handle:     "Speaker's Handle",
  time:       "Time",
  date:       "Date",
  occupation: "Occupation",
  topic:      "Topic",
  link:       "Link",
};

export function parseBriefing(rawText: string): ParseResult {
  // Strip leading @mention (e.g. "@FlyerBot" at start of a line)
  const text = rawText.replace(/^@\S+\s*/m, "");

  const extracted: Partial<Record<string, string>> = {};
  const missingFields: string[] = [];

  for (const [field, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = text.match(pattern)?.[1]?.trim();
    if (match && match.length > 0) {
      extracted[field] = match;
    } else {
      missingFields.push(FIELD_LABELS[field] ?? field);
    }
  }

  if (missingFields.length > 0) {
    return { ok: false, missingFields };
  }

  return {
    ok: true,
    briefing: {
      handle:     extracted.handle!,
      time:       extracted.time!,
      date:       extracted.date!,
      occupation: extracted.occupation!,
      topic:      extracted.topic!,
      link:       extracted.link!,
    },
  };
}
