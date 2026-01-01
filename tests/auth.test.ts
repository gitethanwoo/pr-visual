import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as http from "node:http";

const {
  openMock,
  refreshAccessTokenMock,
  getTokenMock,
  generateAuthUrlMock,
  setCredentialsMock,
  createServerMock,
  getRequestHandler,
} = vi.hoisted(() => {
  let requestHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>) | null = null;
  const server = {
    listen: vi.fn((_: number, cb?: () => void) => cb?.()),
    close: vi.fn(),
  };

  return {
    openMock: vi.fn(),
    refreshAccessTokenMock: vi.fn(),
    getTokenMock: vi.fn(),
    generateAuthUrlMock: vi.fn(),
    setCredentialsMock: vi.fn(),
    createServerMock: vi.fn((handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>) => {
      requestHandler = handler;
      return server;
    }),
    getRequestHandler: () => requestHandler,
  };
});

vi.mock("open", () => ({
  default: openMock,
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    generateAuthUrl = generateAuthUrlMock;
    setCredentials = setCredentialsMock;
    refreshAccessToken = refreshAccessTokenMock;
    getToken = getTokenMock;
  },
}));

vi.mock("node:http", () => ({
  createServer: createServerMock,
}));

const originalHome = process.env.HOME;
const originalApiKey = process.env.GEMINI_API_KEY;

async function loadAuth(tempHome: string) {
  process.env.HOME = tempHome;
  vi.resetModules();
  return await import("../src/auth");
}

function writeTokens(homeDir: string, tokens: Record<string, unknown>) {
  const dir = path.join(homeDir, ".pr-visual");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "token.json"), JSON.stringify(tokens));
}

describe("auth", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-home-"));
    openMock.mockReset();
    refreshAccessTokenMock.mockReset();
    getTokenMock.mockReset();
    generateAuthUrlMock.mockReset();
    setCredentialsMock.mockReset();
    createServerMock.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    process.env.HOME = originalHome;
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("returns null when no tokens are stored", async () => {
    const { getStoredTokens } = await loadAuth(tempHome);
    expect(getStoredTokens()).toBeNull();
  });

  it("detects logged-in state", async () => {
    writeTokens(tempHome, { access_token: "token" });
    const { isLoggedIn } = await loadAuth(tempHome);
    expect(isLoggedIn()).toBe(true);
  });

  it("logs out by removing token file", async () => {
    writeTokens(tempHome, { access_token: "token" });
    const { logout } = await loadAuth(tempHome);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logout();

    const tokenPath = path.join(tempHome, ".pr-visual", "token.json");
    expect(fs.existsSync(tokenPath)).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });

  it("returns access token when not expired", async () => {
    writeTokens(tempHome, { access_token: "token", expiry_date: Date.now() + 60_000 });
    const { getAccessToken } = await loadAuth(tempHome);

    await expect(getAccessToken()).resolves.toBe("token");
  });

  it("refreshes expired tokens when refresh_token exists", async () => {
    writeTokens(tempHome, { access_token: "old", refresh_token: "refresh", expiry_date: Date.now() - 1 });
    refreshAccessTokenMock.mockResolvedValue({
      credentials: {
        access_token: "new",
        refresh_token: "refresh",
        expiry_date: Date.now() + 60_000,
      },
    });

    const { getAccessToken } = await loadAuth(tempHome);
    const token = await getAccessToken();

    expect(token).toBe("new");
    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: "refresh" });

    const tokenPath = path.join(tempHome, ".pr-visual", "token.json");
    const stored = JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as { access_token: string };
    expect(stored.access_token).toBe("new");
  });

  it("shows authentication status", async () => {
    writeTokens(tempHome, { access_token: "token", expiry_date: Date.now() + 60_000 });
    process.env.GEMINI_API_KEY = "key";
    const { showAuthStatus } = await loadAuth(tempHome);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    showAuthStatus();

    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("Authentication Status");
    expect(output).toContain("OAuth: Logged in");
    expect(output).toContain("API Key: Set via GEMINI_API_KEY");
  });

  it("completes OAuth login flow", async () => {
    generateAuthUrlMock.mockReturnValue("http://auth");
    getTokenMock.mockResolvedValue({
      tokens: {
        access_token: "token",
        refresh_token: "refresh",
        expiry_date: Date.now() + 60_000,
      },
    });

    const { login } = await loadAuth(tempHome);
    const loginPromise = login();
    const handler = getRequestHandler();

    if (!handler) {
      throw new Error("Expected request handler to be set");
    }

    const req = { url: "/callback?code=abc" } as unknown as http.IncomingMessage;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as http.ServerResponse;

    await handler(req, res);
    await loginPromise;

    expect(openMock).toHaveBeenCalledWith("http://auth");

    const tokenPath = path.join(tempHome, ".pr-visual", "token.json");
    const stored = JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as { access_token: string };
    expect(stored.access_token).toBe("token");
  });
});
