/**
 * One-time script to obtain a Google OAuth refresh token with all scopes the
 * chat-bot needs, including chat.messages (read + write) and drive.readonly.
 *
 * Run:  npx tsx scripts/get-token.ts
 *
 * Prerequisites:
 *  1. Your .env file must have GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set.
 *  2. In Google Cloud Console → APIs & Services → Credentials → your OAuth client,
 *     add  http://localhost:3001/oauth2callback  to "Authorized redirect URIs".
 *  3. Make sure the Google Chat API and Drive API are enabled for the project.
 *
 * After running:
 *  - Copy the printed GOOGLE_REFRESH_TOKEN value.
 *  - Update the variable in Railway (Variables tab) and redeploy.
 */

import * as http from "http";
import * as url from "url";
import * as dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI  = "http://localhost:3001/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env");
  process.exit(1);
}

const SCOPES = [
  // Full access to read and send Chat messages (covers fetchRecentSpaceMessages)
  "https://www.googleapis.com/auth/chat.messages",
  // Read Drive files attached to Chat messages
  "https://www.googleapis.com/auth/drive.readonly",
];

async function main(): Promise<void> {
  const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // force re-consent so Google always returns a refresh token
  });

  console.log("\n────────────────────────────────────────────────────────");
  console.log("Open this URL in your browser and complete the sign-in:");
  console.log("\n" + authUrl + "\n");
  console.log("────────────────────────────────────────────────────────\n");

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url ?? "", true);
      if (parsed.pathname !== "/oauth2callback") return;

      const code  = parsed.query["code"]  as string | undefined;
      const error = parsed.query["error"] as string | undefined;

      if (error) {
        res.end(`OAuth error: ${error}`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.end("No code in callback — please try again.");
        server.close();
        reject(new Error("No code in OAuth callback"));
        return;
      }

      try {
        const { tokens } = await client.getToken(code);
        res.end("✅ Authorisation successful — you can close this tab.");
        server.close();

        const refreshToken = tokens.refresh_token;
        if (!refreshToken) {
          console.warn(
            "\n⚠️  No refresh_token returned. This usually means the account has already\n" +
            "   authorised this app. Revoke access at https://myaccount.google.com/permissions\n" +
            "   and run this script again.\n",
          );
          resolve();
          return;
        }

        console.log("\n════════════════════════════════════════════════════════");
        console.log("✅  New refresh token:");
        console.log("\n" + refreshToken + "\n");
        console.log("Update this Railway variable, then redeploy:");
        console.log("  GOOGLE_REFRESH_TOKEN=" + refreshToken);
        console.log("════════════════════════════════════════════════════════\n");
        resolve();
      } catch (err) {
        res.end("Error exchanging code for tokens — check the terminal.");
        server.close();
        reject(err);
      }
    });

    server.on("error", reject);
    server.listen(3001, () => {
      console.log("Listening for OAuth callback on http://localhost:3001 …\n");
    });
  });
}

main().catch((err) => {
  console.error("❌ ", err instanceof Error ? err.message : err);
  process.exit(1);
});
