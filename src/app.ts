import express from "express";
import { webhookHandler } from "./routes/webhook";
import { renderHandler } from "./routes/render";

const app = express();

app.use(express.json({ limit: "10mb" }));

app.post("/webhook",    webhookHandler);
app.post("/api/render", renderHandler);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

export { app };
