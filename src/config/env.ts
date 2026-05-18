import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DEDICATED_SPACE_ID: z.string().min(1),
  GOOGLE_CHAT_CREDENTIALS: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASSETS_DIR: z.string().default("./assets"),
  PUBSUB_AUDIENCE: z.string().url().optional(),
  FLYER_TOOL_BACKEND_URL: z.string().url().optional(),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error("❌ Invalid environment variables:", result.error.flatten());
  throw new Error("Environment validation failed. App cannot start.");
}

export const env = result.data;
