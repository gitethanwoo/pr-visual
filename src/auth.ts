import { OAuth2Client } from "google-auth-library";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import open from "open";
import chalk from "chalk";

// Embedded OAuth credentials for pr-visual
const EMBEDDED_CLIENT_ID = "1002064840148-01gv64g95nqa85hbtkvj1majfbdj1ntp.apps.googleusercontent.com";
const EMBEDDED_CLIENT_SECRET = "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";

const SCOPES = [
  "https://www.googleapis.com/auth/generative-language.retriever",
  "https://www.googleapis.com/auth/cloud-platform",
];

const REDIRECT_URI = "http://localhost:3000/callback";
const CONFIG_DIR = path.join(os.homedir(), ".pr-visual");
const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

interface OAuthConfig {
  client_id: string;
  client_secret: string;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function getStoredTokens(): StoredTokens | null {
  if (!fs.existsSync(TOKEN_PATH)) {
    return null;
  }
  const content = fs.readFileSync(TOKEN_PATH, "utf-8");
  return JSON.parse(content);
}

function saveTokens(tokens: StoredTokens): void {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function getOAuthConfig(): OAuthConfig {
  // Check for user-provided credentials first (allows override)
  if (fs.existsSync(CREDENTIALS_PATH)) {
    const content = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    const creds = JSON.parse(content);
    const config = creds.installed ?? creds.web;
    if (config) {
      return {
        client_id: config.client_id,
        client_secret: config.client_secret,
      };
    }
  }

  // Use embedded credentials
  return {
    client_id: EMBEDDED_CLIENT_ID,
    client_secret: EMBEDDED_CLIENT_SECRET,
  };
}

export function isLoggedIn(): boolean {
  const tokens = getStoredTokens();
  return tokens !== null && tokens.access_token !== undefined;
}

export function logout(): void {
  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
    console.log(chalk.green("Logged out successfully."));
  } else {
    console.log(chalk.yellow("Not logged in."));
  }
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens();
  if (!tokens) return null;

  // Check if token is expired
  if (tokens.expiry_date && Date.now() >= tokens.expiry_date) {
    // Try to refresh
    if (tokens.refresh_token) {
      const config = getOAuthConfig();
      const oauth2Client = new OAuth2Client(
        config.client_id,
        config.client_secret,
        REDIRECT_URI
      );
      oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        saveTokens({
          access_token: credentials.access_token!,
          refresh_token: credentials.refresh_token ?? tokens.refresh_token,
          expiry_date: credentials.expiry_date ?? undefined,
        });
        return credentials.access_token!;
      } catch {
        // Refresh failed, need to re-login
        return null;
      }
    }
    return null;
  }

  return tokens.access_token;
}

export async function login(): Promise<void> {
  const config = getOAuthConfig();

  const oauth2Client = new OAuth2Client(
    config.client_id,
    config.client_secret,
    REDIRECT_URI
  );

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log(chalk.cyan("\nOpening browser for Google login...\n"));

  return new Promise((resolve) => {
    let completed = false;
    let timeoutId: NodeJS.Timeout;

    const server = http.createServer(async (req, res) => {
      if (req.url?.startsWith("/callback")) {
        const url = new URL(req.url, "http://localhost:3000");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #dc2626;">Login Failed</h1>
                  <p>${error}</p>
                </div>
              </body>
            </html>
          `);
          completed = true;
          clearTimeout(timeoutId);
          server.close();
          console.error(chalk.red(`Login failed: ${error}`));
          resolve();
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                <div style="text-align: center; color: white;">
                  <h1>Success!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          completed = true;
          clearTimeout(timeoutId);
          server.close();

          try {
            const { tokens } = await oauth2Client.getToken(code);
            saveTokens({
              access_token: tokens.access_token!,
              refresh_token: tokens.refresh_token ?? undefined,
              expiry_date: tokens.expiry_date ?? undefined,
            });
            console.log(chalk.green("Login successful!\n"));
          } catch (err) {
            console.error(chalk.red("Failed to exchange code for tokens."));
          }
          resolve();
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing authorization code");
          completed = true;
          clearTimeout(timeoutId);
          server.close();
          console.error(chalk.red("Login failed: No authorization code received."));
          resolve();
        }
      }
    });

    server.listen(3000, () => {
      open(authorizeUrl);
    });

    // Timeout after 2 minutes
    timeoutId = setTimeout(() => {
      if (!completed) {
        server.close();
        console.log(chalk.yellow("\nLogin timed out. Please try again."));
        resolve();
      }
    }, 120000);
  });
}

export function showAuthStatus(): void {
  const tokens = getStoredTokens();
  const hasApiKey = !!process.env.GEMINI_API_KEY;

  console.log(chalk.bold("\nAuthentication Status:\n"));

  if (tokens?.access_token) {
    const expired = tokens.expiry_date && Date.now() >= tokens.expiry_date;
    if (expired && !tokens.refresh_token) {
      console.log(chalk.yellow("  OAuth: Token expired (no refresh token)"));
    } else if (expired) {
      console.log(chalk.cyan("  OAuth: Token expired (will refresh automatically)"));
    } else {
      console.log(chalk.green("  OAuth: Logged in"));
    }
  } else {
    console.log(chalk.gray("  OAuth: Not logged in"));
  }

  if (hasApiKey) {
    console.log(chalk.green("  API Key: Set via GEMINI_API_KEY"));
  } else {
    console.log(chalk.gray("  API Key: Not set"));
  }

  console.log(chalk.gray(`\n  Config dir: ${CONFIG_DIR}\n`));
}
