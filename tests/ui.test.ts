import { describe, expect, it, vi } from "vitest";
import { createSpinner, printError, printStep, printSuccess } from "../src/ui";

describe("ui", () => {
  it("prints once in non-tty mode", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const originalIsTTY = process.stdout.isTTY;

    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });

    const spinner = createSpinner("Working");
    spinner.update("Still working");
    spinner.stop();

    expect(logSpy.mock.calls[0]?.[0]).toContain("Working");
    expect(logSpy.mock.calls[1]?.[0]).toContain("Still working");

    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it("prints status lines", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    printSuccess("ok");
    printStep("step");
    printError("bad");

    const output = logSpy.mock.calls.map((call) => call[0]).join("\n");
    expect(output).toContain("ok");
    expect(output).toContain("step");
    expect(output).toContain("bad");
  });
});
