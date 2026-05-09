/**
 * Google Drive helpers for the content-lifecycle skill.
 *
 * Auth flow:
 *   1. Read OAuth client credentials from ~/.config/smt/drive-credentials.json
 *      (one-time setup — see SKILL.md for how to obtain).
 *   2. If a stored token exists at ~/.config/smt/drive-token.json, use it.
 *   3. Otherwise spin up a localhost HTTP server, open the browser to the
 *      Google consent screen, capture the callback code, exchange for a token,
 *      cache it. From then on the user is hands-off.
 *
 * Uploads use the googleapis SDK which automatically uses Drive's resumable
 * upload protocol when given a stream (handles 5GB+ without loading into
 * memory).
 */

import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { google, drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

const CONFIG_DIR = path.join(os.homedir(), ".config", "smt");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "drive-credentials.json");
const TOKEN_PATH = path.join(CONFIG_DIR, "drive-token.json");
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const CALLBACK_PORT = 4283;
const CALLBACK_PATH = "/oauth2callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

export interface CredentialsSetupError extends Error {
  code: "CREDENTIALS_MISSING";
  credentialsPath: string;
}

function credentialsMissing(): CredentialsSetupError {
  const e = new Error(
    `Missing Google OAuth client credentials at ${CREDENTIALS_PATH}.\n\n` +
    `One-time setup (~3 min):\n` +
    `  1. https://console.cloud.google.com/apis/credentials\n` +
    `  2. Create a project (or pick one). Click "Create Credentials" -> "OAuth client ID".\n` +
    `  3. Application type: "Desktop app". Name: "SMT content-lifecycle".\n` +
    `  4. Click DOWNLOAD JSON.\n` +
    `  5. mkdir -p ${CONFIG_DIR} && mv ~/Downloads/client_secret_*.json ${CREDENTIALS_PATH}\n` +
    `  6. Enable Drive API: https://console.cloud.google.com/apis/library/drive.googleapis.com\n\n` +
    `After this, every run is hands-off (browser OAuth click first time only).`
  ) as CredentialsSetupError;
  e.code = "CREDENTIALS_MISSING";
  e.credentialsPath = CREDENTIALS_PATH;
  return e;
}

/**
 * Get an authorized OAuth2Client. On first run with no cached token,
 * opens the browser for the consent screen. On subsequent runs, uses
 * the cached token (refreshing automatically if expired).
 */
export async function getAuthorizedClient(): Promise<OAuth2Client> {
  if (!fs.existsSync(CREDENTIALS_PATH)) throw credentialsMissing();

  const credsRaw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const creds = credsRaw.installed || credsRaw.web || credsRaw;
  const { client_id, client_secret } = creds;
  if (!client_id || !client_secret) {
    throw new Error(`drive-credentials.json missing client_id/client_secret`);
  }

  const oauth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    oauth2.setCredentials(token);
    // Persist refreshed tokens automatically.
    oauth2.on("tokens", (newTokens) => {
      const merged = { ...token, ...newTokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
    });
    return oauth2;
  }

  const code = await captureAuthCode(oauth2);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    process.stderr.write(
      "[drive] Warning: no refresh_token returned. Future runs may need re-auth.\n" +
      "        If this happens, revoke at myaccount.google.com/permissions and re-run.\n",
    );
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  oauth2.setCredentials(tokens);
  return oauth2;
}

function captureAuthCode(oauth2: OAuth2Client): Promise<string> {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",  // ensures we get a refresh_token
      scope: SCOPES,
    });

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
        if (reqUrl.pathname !== CALLBACK_PATH) {
          res.writeHead(404).end("not found");
          return;
        }
        const code = reqUrl.searchParams.get("code");
        const err = reqUrl.searchParams.get("error");
        if (err) {
          res.writeHead(400).end(`OAuth error: ${err}`);
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        if (!code) {
          res.writeHead(400).end("missing code");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          `<html><body style="font-family:system-ui;padding:40px;text-align:center">` +
          `<h2>SMT content-lifecycle authorized</h2>` +
          `<p>You can close this tab and return to the terminal.</p>` +
          `</body></html>`,
        );
        server.close();
        resolve(code);
      } catch (e) {
        res.writeHead(500).end("server error");
        server.close();
        reject(e as Error);
      }
    });

    server.on("error", reject);
    server.listen(CALLBACK_PORT, () => {
      process.stderr.write(`[drive] Opening browser for Google authorization...\n`);
      process.stderr.write(`[drive] If it doesn't open, visit:\n  ${authUrl}\n`);
      try {
        execFileSync("open", [authUrl], { stdio: "ignore" });
      } catch {
        // not macOS or "open" missing — user can paste the URL above
      }
    });
  });
}

let _drive: drive_v3.Drive | null = null;
export async function getDrive(): Promise<drive_v3.Drive> {
  if (_drive) return _drive;
  const auth = await getAuthorizedClient();
  _drive = google.drive({ version: "v3", auth });
  return _drive;
}

/** Find a folder by name under a parent. Returns Drive file ID or null. */
export async function findFolder(parentId: string, name: string): Promise<string | null> {
  const drive = await getDrive();
  const escaped = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

/** Create a folder under a parent. Returns its Drive file ID. */
export async function createFolder(parentId: string, name: string): Promise<string> {
  const drive = await getDrive();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  if (!res.data.id) throw new Error(`createFolder returned no id`);
  return res.data.id;
}

/** Find or create a folder. Idempotent. */
export async function ensureFolder(parentId: string, name: string): Promise<string> {
  const existing = await findFolder(parentId, name);
  if (existing) return existing;
  return createFolder(parentId, name);
}

export interface UploadedFile {
  id: string;
  name: string;
  webViewLink: string;
  webContentLink?: string;
  size: number;
  mimeType: string;
}

/**
 * Upload a local file to a Drive folder. Uses resumable upload via stream
 * — safe for 45MB final.mp4 and well beyond.
 */
export async function uploadFile(opts: {
  parentId: string;
  name: string;
  localPath: string;
  mimeType: string;
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
}): Promise<UploadedFile> {
  const drive = await getDrive();
  const stat = fs.statSync(opts.localPath);
  const totalBytes = stat.size;

  let uploaded = 0;
  const stream = fs.createReadStream(opts.localPath);
  if (opts.onProgress) {
    stream.on("data", (chunk) => {
      uploaded += chunk.length;
      opts.onProgress!(uploaded, totalBytes);
    });
  }

  // googleapis switches to resumable upload automatically when given a
  // readable stream — no manual chunking, no body-size limits.
  const res = await drive.files.create({
    requestBody: { name: opts.name, parents: [opts.parentId] },
    media: { mimeType: opts.mimeType, body: stream },
    fields: "id,name,webViewLink,webContentLink,size,mimeType",
  });

  const f = res.data;
  if (!f.id || !f.webViewLink) throw new Error(`upload returned no id/webViewLink for ${opts.name}`);
  return {
    id: f.id,
    name: f.name ?? opts.name,
    webViewLink: f.webViewLink,
    webContentLink: f.webContentLink ?? undefined,
    size: Number(f.size ?? totalBytes),
    mimeType: f.mimeType ?? opts.mimeType,
  };
}

/** Resolve a folder by path-from-root. Path is `/`-separated, e.g. "SMT/Content/Produced". */
export async function resolvePath(pathParts: string[]): Promise<string> {
  let parent = "root";
  for (const part of pathParts) {
    const id = await findFolder(parent, part);
    if (!id) throw new Error(`Folder not found at path: ${pathParts.slice(0, pathParts.indexOf(part) + 1).join("/")}`);
    parent = id;
  }
  return parent;
}

/** Resolve a path, creating any missing folder segments. */
export async function ensurePath(pathParts: string[]): Promise<string> {
  let parent = "root";
  for (const part of pathParts) {
    parent = await ensureFolder(parent, part);
  }
  return parent;
}
