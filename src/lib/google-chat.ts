import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { AppError } from "./errors";

type ServiceAccountCredentials = Record<string, unknown>;

// Strip any trailing non-JSON characters (e.g. zsh `%` no-newline marker or shell prompt
// text that can appear when the value is copy-pasted from a terminal into Railway).
const _rawCreds = env.GOOGLE_CHAT_CREDENTIALS.trim();
const _credJson = _rawCreds.slice(0, _rawCreds.lastIndexOf("}") + 1);
const credentials = JSON.parse(_credJson) as ServiceAccountCredentials;

const auth = new GoogleAuth({
  credentials,
  scopes: [
    "https://www.googleapis.com/auth/chat.bot",
    "https://www.googleapis.com/auth/chat.messages",
    "https://www.googleapis.com/auth/chat.messages.create",
    "https://www.googleapis.com/auth/chat.messages.readonly",
  ],
});

const CHAT_BASE = "https://chat.googleapis.com/v1";

async function bearerToken(): Promise<string> {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
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
