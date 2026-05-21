import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { AppError } from "./errors";

const oauthClient = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
);
oauthClient.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });

const CHAT_BASE   = "https://chat.googleapis.com/v1";
const UPLOAD_BASE = "https://chat.googleapis.com/upload/v1";

async function bearerToken(): Promise<string> {
  const { token } = await oauthClient.getAccessToken();
  if (!token) throw new AppError(500, "Failed to get auth token.", "CHAT_AUTH_TOKEN_FAILED");
  return token;
}

async function chatPost(path: string, body: unknown): Promise<void> {
  const token = await bearerToken();
  const res = await fetch(`${CHAT_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError(502, "Google Chat API request failed.", "CHAT_API_REQUEST_FAILED", {
      status: res.status,
      path,
      detail,
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function postTextMessage(
  spaceName: string,
  text: string,
  threadName?: string,
): Promise<void> {
  await chatPost(`${spaceName}/messages`, {
    text,
    ...(threadName ? { thread: { name: threadName } } : {}),
  });
}

export async function postFlyerMessage(
  spaceName: string,
  imageUrl: string,
  threadName?: string,
): Promise<void> {
  await chatPost(`${spaceName}/messages`, {
    text: "Flyer generated ✅",
    ...(threadName ? { thread: { name: threadName } } : {}),
    cardsV2: [
      {
        cardId: "flyer-card",
        card: {
          sections: [
            {
              widgets: [
                {
                  image: {
                    imageUrl,
                    onClick: { openLink: { url: imageUrl } },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  });
}

// Upload a binary buffer to Google Chat as an attachment.
// Uses the multipart/related upload form expected by the
// /upload/v1/{parent}/attachments:upload endpoint.
async function uploadAttachment(
  spaceName: string,
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<{ attachmentUploadToken: string }> {
  const token = await bearerToken();

  const boundary = `doux-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const metadata = JSON.stringify({ filename });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
      "utf-8",
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"),
  ]);

  const url = `${UPLOAD_BASE}/${spaceName}/attachments:upload?uploadType=multipart`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError(502, "Failed to upload flyer to Google Chat.", "CHAT_ATTACHMENT_UPLOAD_FAILED", {
      status: res.status,
      detail: detail.slice(0, 500),
    });
  }

  const data = (await res.json()) as { attachmentDataRef?: { attachmentUploadToken?: string } };
  const uploadToken = data.attachmentDataRef?.attachmentUploadToken;
  if (!uploadToken) {
    throw new AppError(502, "Chat upload returned no token.", "CHAT_ATTACHMENT_NO_TOKEN", { response: data });
  }
  return { attachmentUploadToken: uploadToken };
}

export async function postFlyerAsFile(
  spaceName: string,
  pngBuffer: Buffer,
  filename: string,
  threadName?: string,
): Promise<void> {
  const { attachmentUploadToken } = await uploadAttachment(spaceName, pngBuffer, filename, "image/png");

  await chatPost(`${spaceName}/messages`, {
    text: "Flyer generated ✅",
    ...(threadName ? { thread: { name: threadName } } : {}),
    attachment: [
      {
        contentName: filename,
        contentType: "image/png",
        attachmentDataRef: { attachmentUploadToken },
      },
    ],
  });
}

export async function fetchThreadMessages(
  spaceName: string,
  threadName: string,
): Promise<import("../types/chat").ChatMessage[]> {
  const token = await bearerToken();
  // filter param uses the EBNF filter syntax supported by the Chat API
  const filter = `thread.name = "${threadName}"`;
  const url =
    `${CHAT_BASE}/${spaceName}/messages` +
    `?filter=${encodeURIComponent(filter)}&orderBy=createTime%20desc&pageSize=20`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // Degrade gracefully — missing scope or transient failure should not crash the bot
    console.error("[chat] fetchThreadMessages failed:", res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = (await res.json()) as { messages?: import("../types/chat").ChatMessage[] };
  return data.messages ?? [];
}

export async function downloadAttachment(resourceName: string): Promise<Buffer> {
  const token = await bearerToken();
  // Google Chat media download uses a dedicated /media/ endpoint, distinct
  // from the general v1 message API. The resourceName is opaque (Base64-ish).
  const url = `${CHAT_BASE}/media/${resourceName}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(502, "Failed to download the attached image from Google Chat.", "CHAT_ATTACHMENT_DOWNLOAD_FAILED", {
      status: res.status,
      body: body.slice(0, 500),
    });
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

export async function verifyPubSubToken(authHeader: string): Promise<boolean> {
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: env.PUBSUB_AUDIENCE,
    });
    const payload = ticket.getPayload();
    return payload?.email_verified === true;
  } catch {
    return false;
  }
}
