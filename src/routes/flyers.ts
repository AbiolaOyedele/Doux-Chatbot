import type { Request, Response } from "express";
import { readFlyer } from "../lib/flyer-storage";

export async function flyerHandler(req: Request, res: Response): Promise<void> {
  const buf = await readFlyer(req.params.filename ?? "");
  if (!buf) {
    res.status(404).send("Not found");
    return;
  }
  res.setHeader("Content-Type", "image/png");
  // Long cache: filenames are unique, so once Chat caches it that's fine.
  res.setHeader("Cache-Control", "public, max-age=3600, immutable");
  res.send(buf);
}
