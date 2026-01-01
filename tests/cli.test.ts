import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function runCli(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("node", ["dist/cli.js", ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("cli", () => {
  it("prints help text", () => {
    const output = runCli(["--help"]);
    expect(output).toContain("Diff mode: branch, commit, staged, unstaged");
  });

  it("shows auth status", () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-cli-"));

    const output = runCli(["status"], {
      HOME: tempHome,
    });

    expect(output).toContain("Authentication Status");
    expect(output).toContain("OAuth: Not logged in");

    fs.rmSync(tempHome, { recursive: true, force: true });
  });
});
