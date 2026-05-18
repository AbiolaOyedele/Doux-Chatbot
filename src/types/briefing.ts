export interface ParsedBriefing {
  /** Speaker's handle or name (from "Speaker's Handle: @handle") */
  handle: string;
  /** Event time string as-is (e.g. "8pm") */
  time: string;
  /** Event date string as-is (e.g. "May 15") */
  date: string;
  /** Speaker's occupation / role */
  occupation: string;
  /** Talk topic — becomes the flyer title */
  topic: string;
  /** Registration or event link */
  link: string;
}

export type ParseResult =
  | { ok: true; briefing: ParsedBriefing }
  | { ok: false; missingFields: string[] };
