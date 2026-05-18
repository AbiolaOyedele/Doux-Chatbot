import { createClient } from "@supabase/supabase-js";
// Node 20 has no native WebSocket — provide the `ws` package as transport so
// supabase-js RealtimeClient does not throw at startup on Railway (Node 20).
import ws from "ws";
import { env } from "../config/env";
import { AppError } from "./errors";

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

export async function uploadFlyer(pngBuffer: Buffer, spaceName: string): Promise<string> {
  const safeName = spaceName.replace(/\//g, "_").replace(/[^a-z0-9_-]/gi, "");
  const filename = `bot/${Date.now()}_${safeName}.png`;

  const { error } = await supabase.storage.from("flyers").upload(filename, pngBuffer, {
    contentType: "image/png",
    upsert: false,
  });

  if (error) {
    throw new AppError(500, "Failed to upload flyer to storage.", "FLYER_UPLOAD_FAILED", error);
  }

  const { data } = supabase.storage.from("flyers").getPublicUrl(filename);
  return data.publicUrl;
}
