import { simpleGit, SimpleGit, LogResult, DefaultLogFields } from "simple-git";
import inquirer from "inquirer";

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

  const { commit } = await inquirer.prompt<{ commit: string }>([
    {
      type: "list",
      name: "commit",
      message: "Select a commit:",
      choices: log.all.map((c: DefaultLogFields) => ({
        name: `${c.hash.slice(0, 7)} - ${c.message.slice(0, 60)}`,
        value: c.hash,
      })),
    },
  ]);

  return commit;
}

export async function getDiff(mode: DiffMode, commitHashArg?: string): Promise<string> {
  switch (mode) {
    case "branch": {
      const defaultBranch = await getDefaultBranch();
      const currentBranch = (await git.branch()).current;

      if (currentBranch === defaultBranch) {
        throw new Error(`Already on ${defaultBranch}. Switch to a feature branch first.`);
      }

      return (await git.diff([`${defaultBranch}...${currentBranch}`])) ?? "";
    }

    case "commit": {
      const commitHash = commitHashArg ?? (await selectCommit());
      return (await git.diff([`${commitHash}^`, commitHash])) ?? "";
    }

    case "staged": {
      return (await git.diff(["--cached"])) ?? "";
    }

    case "unstaged": {
      return (await git.diff()) ?? "";
    }
  }
}
