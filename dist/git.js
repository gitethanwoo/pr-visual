import { simpleGit } from "simple-git";
import { select } from "@inquirer/prompts";
const git = simpleGit();
async function getDefaultBranch() {
    const branches = await git.branch();
    if (branches.all.includes("main"))
        return "main";
    if (branches.all.includes("master"))
        return "master";
    return branches.all[0];
}
async function selectCommit() {
    const log = await git.log({ maxCount: 20 });
    const commit = await select({
        message: "Select a commit:",
        choices: log.all.map((c) => ({
            name: `${c.hash.slice(0, 7)} - ${c.message.slice(0, 60)}`,
            value: c.hash,
        })),
    });
    return commit;
}
export async function getDiff(mode, commitHashArg) {
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
