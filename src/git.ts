import { simpleGit, SimpleGit, LogResult, DefaultLogFields } from "simple-git";
import { select } from "@inquirer/prompts";

export type DiffMode = "branch" | "commit" | "staged" | "unstaged";

const git: SimpleGit = simpleGit();

async function getDefaultBranch(): Promise<string> {
  const branches = await git.branch();
  if (branches.all.includes("main")) return "main";
  if (branches.all.includes("master")) return "master";
  return branches.all[0];
}

async function selectCommit(): Promise<string> {
  const log = await git.log({ maxCount: 20 });

  const commit = await select({
    message: "Select a commit:",
    choices: log.all.map((c: DefaultLogFields) => ({
      name: `${c.hash.slice(0, 7)} - ${c.message.slice(0, 60)}`,
      value: c.hash,
    })),
  });

  return commit;
}

export async function detectBestDiffMode(): Promise<{ mode: DiffMode; description: string; commitHash?: string }> {
  const branches = await git.branch();
  const currentBranch = branches.current;
  const defaultBranch = branches.all.includes("main") ? "main" : branches.all.includes("master") ? "master" : null;

  // If on a feature branch, use branch diff
  if (defaultBranch && currentBranch !== defaultBranch) {
    const diff = await git.diff([`${defaultBranch}...${currentBranch}`]);
    if (diff.trim()) {
      return { mode: "branch", description: `${currentBranch} vs ${defaultBranch}` };
    }
  }

  // Check for staged changes
  const staged = await git.diff(["--cached"]);
  if (staged.trim()) {
    return { mode: "staged", description: "staged changes" };
  }

  // Check for unstaged changes
  const unstaged = await git.diff();
  if (unstaged.trim()) {
    return { mode: "unstaged", description: "unstaged changes" };
  }

  // Fall back to last commit
  const log = await git.log({ maxCount: 1 });
  if (log.latest) {
    const shortHash = log.latest.hash.slice(0, 7);
    const message = log.latest.message.slice(0, 50);
    return { mode: "commit", description: `last commit (${shortHash}: ${message})`, commitHash: log.latest.hash };
  }

  // This should rarely happen - repo with no commits
  return { mode: "staged", description: "empty" };
}

// Files to exclude from diffs (noise that doesn't help understanding)
const EXCLUDED_FILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"];

function excludeArgs(): string[] {
  return EXCLUDED_FILES.flatMap((f) => ["--", `:!${f}`]);
}

export async function getDiff(mode: DiffMode, commitHashArg?: string): Promise<string> {
  switch (mode) {
    case "branch": {
      const defaultBranch = await getDefaultBranch();
      const currentBranch = (await git.branch()).current;

      if (currentBranch === defaultBranch) {
        throw new Error(`Already on ${defaultBranch}. Switch to a feature branch first.`);
      }

      return (await git.diff([`${defaultBranch}...${currentBranch}`, ...excludeArgs()])) ?? "";
    }

    case "commit": {
      const commitHash = commitHashArg ?? (await selectCommit());
      return (await git.diff([`${commitHash}^`, commitHash, ...excludeArgs()])) ?? "";
    }

    case "staged": {
      return (await git.diff(["--cached", ...excludeArgs()])) ?? "";
    }

    case "unstaged": {
      return (await git.diff([...excludeArgs()])) ?? "";
    }
  }
}
