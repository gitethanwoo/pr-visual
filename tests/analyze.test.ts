import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecOptions } from "node:child_process";
import { analyzeDiff } from "../src/analyze";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

const { execMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
}));

const { customPromisify } = vi.hoisted(() => ({
  customPromisify: Symbol.for("nodejs.util.promisify.custom"),
}));

vi.mock("node:child_process", () => {
  const exec = (command: string, options: ExecOptions | ExecCallback, callback?: ExecCallback) => {
    const cb = typeof options === "function" ? options : callback;
    if (!cb) return null;
    execMock(command, cb);
    return null;
  };

  Object.defineProperty(exec, customPromisify, {
    value: (command: string) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execMock(command, (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        });
      }),
  });

  return { exec };
});

describe("analyzeDiff", () => {
  const originalCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    execMock.mockReset();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-analyze-"));
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("filters lockfiles from the prompt and cleans up temp file", async () => {
    let capturedPrompt = "";
    execMock.mockImplementation((command: string, cb: ExecCallback) => {
      const tempFile = path.join(process.cwd(), ".pr-visual-prompt.tmp");
      capturedPrompt = fs.readFileSync(tempFile, "utf-8");
      expect(command).toContain("@google/gemini-cli");
      cb(null, "BRIEF", "");
    });

    const diff = [
      "diff --git a/package-lock.json b/package-lock.json",
      "index 123..456 100644",
      "--- a/package-lock.json",
      "+++ b/package-lock.json",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/index.ts b/src/index.ts",
      "index 111..222 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const result = await analyzeDiff(diff, "clean", 1);
    const tempFile = path.join(process.cwd(), ".pr-visual-prompt.tmp");

    expect(result).toBe("BRIEF");
    expect(capturedPrompt).toContain("diff --git a/src/index.ts b/src/index.ts");
    expect(capturedPrompt).not.toContain("package-lock.json");
    expect(capturedPrompt).toContain("STYLE: Clean, beautiful, modern professional PowerPoint style.");
    expect(fs.existsSync(tempFile)).toBe(false);
  });

  it("retries when the CLI fails", async () => {
    vi.useFakeTimers();
    let calls = 0;
    execMock.mockImplementation((_: string, cb: ExecCallback) => {
      calls += 1;
      if (calls < 3) {
        cb(new Error("fail"), "", "");
        return;
      }
      cb(null, "OK", "");
    });

    const attempts: number[] = [];
    const promise = analyzeDiff("diff --git a/a b/a", "clean", 3, (attempt) => {
      attempts.push(attempt);
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();
    expect(result).toBe("OK");
    expect(attempts).toEqual([1, 2]);
  });
});
