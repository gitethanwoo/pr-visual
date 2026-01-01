import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchSummary, DefaultLogFields, LogResult } from "simple-git";
import { detectBestDiffMode, getDiff } from "../src/git";

const { mockGit, selectMock } = vi.hoisted(() => ({
  mockGit: {
    branch: vi.fn(),
    diff: vi.fn(),
    log: vi.fn(),
  },
  selectMock: vi.fn(),
}));

vi.mock("simple-git", () => ({
  simpleGit: () => mockGit,
}));

vi.mock("@inquirer/prompts", () => ({
  select: selectMock,
}));

const EXCLUDE_ARGS = ["--", ".", ":!package-lock.json", ":!yarn.lock", ":!pnpm-lock.yaml", ":!bun.lockb"];

function makeBranchSummary(current: string, all: string[]): BranchSummary {
  return {
    detached: false,
    current,
    all,
    branches: {},
  };
}

function makeLogResult(hash: string, message: string): LogResult<DefaultLogFields> {
  const entry: DefaultLogFields = {
    hash,
    date: "2024-01-01",
    message,
    refs: "",
    body: "",
    author_name: "Test",
    author_email: "test@example.com",
  };

  return {
    all: [entry],
    total: 1,
    latest: entry,
  };
}

describe("git diff modes", () => {
  beforeEach(() => {
    mockGit.branch.mockReset();
    mockGit.diff.mockReset();
    mockGit.log.mockReset();
    selectMock.mockReset();
  });

  it("builds commit diff args with a positive pathspec", async () => {
    mockGit.log.mockResolvedValue(makeLogResult("abc1234", "Test commit"));
    selectMock.mockResolvedValue("abc1234");
    mockGit.diff.mockResolvedValue("diff");

    const diff = await getDiff("commit");

    expect(diff).toBe("diff");
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(mockGit.diff).toHaveBeenCalledWith(["abc1234^", "abc1234", ...EXCLUDE_ARGS]);
  });

  it("uses provided commit hash without prompting", async () => {
    mockGit.diff.mockResolvedValue("diff");

    const diff = await getDiff("commit", "deadbeef");

    expect(diff).toBe("diff");
    expect(selectMock).not.toHaveBeenCalled();
    expect(mockGit.diff).toHaveBeenCalledWith(["deadbeef^", "deadbeef", ...EXCLUDE_ARGS]);
  });

  it("errors when branch mode is used on default branch", async () => {
    mockGit.branch.mockResolvedValue(makeBranchSummary("main", ["main"]));

    await expect(getDiff("branch")).rejects.toThrow("Already on main");
  });

  it("builds branch diff args for feature branches", async () => {
    mockGit.branch.mockResolvedValue(makeBranchSummary("feature", ["main", "feature"]));
    mockGit.diff.mockResolvedValue("diff");

    const diff = await getDiff("branch");

    expect(diff).toBe("diff");
    expect(mockGit.diff).toHaveBeenCalledWith(["main...feature", ...EXCLUDE_ARGS]);
  });

  it("builds staged diff args", async () => {
    mockGit.diff.mockResolvedValue("diff");

    const diff = await getDiff("staged");

    expect(diff).toBe("diff");
    expect(mockGit.diff).toHaveBeenCalledWith(["--cached", ...EXCLUDE_ARGS]);
  });

  it("builds unstaged diff args", async () => {
    mockGit.diff.mockResolvedValue("diff");

    const diff = await getDiff("unstaged");

    expect(diff).toBe("diff");
    expect(mockGit.diff).toHaveBeenCalledWith([...EXCLUDE_ARGS]);
  });
});

describe("diff mode detection", () => {
  beforeEach(() => {
    mockGit.branch.mockReset();
    mockGit.diff.mockReset();
    mockGit.log.mockReset();
  });

  it("prefers branch diff when on a feature branch", async () => {
    mockGit.branch.mockResolvedValue(makeBranchSummary("feature", ["main", "feature"]));
    mockGit.diff.mockResolvedValueOnce("branch diff");

    const result = await detectBestDiffMode();

    expect(result).toEqual({
      mode: "branch",
      description: "feature vs main",
    });
  });

  it("falls back to staged changes", async () => {
    mockGit.branch.mockResolvedValue(makeBranchSummary("main", ["main"]));
    mockGit.diff.mockResolvedValueOnce("staged diff");

    const result = await detectBestDiffMode();

    expect(result).toEqual({
      mode: "staged",
      description: "staged changes",
    });
  });

  it("falls back to unstaged changes", async () => {
    mockGit.branch.mockResolvedValue(makeBranchSummary("main", ["main"]));
    mockGit.diff.mockResolvedValueOnce("");
    mockGit.diff.mockResolvedValueOnce("unstaged diff");

    const result = await detectBestDiffMode();

    expect(result).toEqual({
      mode: "unstaged",
      description: "unstaged changes",
    });
  });

  it("falls back to latest commit when no changes exist", async () => {
    mockGit.branch.mockResolvedValue(makeBranchSummary("main", ["main"]));
    mockGit.diff.mockResolvedValueOnce("");
    mockGit.diff.mockResolvedValueOnce("");
    mockGit.log.mockResolvedValue(makeLogResult("cafebabe", "Latest commit"));

    const result = await detectBestDiffMode();

    expect(result).toEqual({
      mode: "commit",
      description: "last commit (cafebab: Latest commit)",
      commitHash: "cafebabe",
    });
  });
});
