import dotenv from "dotenv";
import { z } from "zod";

// override: true so .env values take precedence over stale shell exports
// during local dev. On Railway/production there is no .env file to load,
// so the platform env vars pass through untouched.
dotenv.config({ override: true });

// Treat empty strings on optional URL fields the same as "not set" so the
// Zod url() validator doesn't reject blank values inherited from .env / Railway.
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().url().optional(),
);

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DEDICATED_SPACE_ID: z.string().min(1),
  // OAuth 2.0 user credentials (replaces service account)
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),
  ASSETS_DIR: z.string().default("./assets"),
  PUBSUB_AUDIENCE: optionalUrl,
  FLYER_TOOL_BACKEND_URL: optionalUrl,
  ANTHROPIC_API_KEY: z.string().min(1),
  // Public base URL used to build flyer image links (no trailing slash).
  PUBLIC_BASE_URL: z.string().url().transform((u) => u.replace(/\/$/, "")),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error("❌ Invalid environment variables:", result.error.flatten());
  throw new Error("Environment validation failed. App cannot start.");
}

export const env = result.data;
