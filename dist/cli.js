#!/usr/bin/env node
import inquirer from "inquirer";
import chalk from "chalk";
import { getDiff } from "./git.js";
import { analyzeDiff } from "./analyze.js";
import { generateImage } from "./image.js";
import * as fs from "node:fs";
import * as path from "node:path";
async function main() {
    console.log(chalk.bold.cyan("\n  PR Visual - Generate infographics from your diffs\n"));
    const { mode } = await inquirer.prompt([
        {
            type: "list",
            name: "mode",
            message: "What would you like to visualize?",
            choices: [
                { name: "Branch diff (compare current branch to main/master)", value: "branch" },
                { name: "Commit diff (changes in a specific commit)", value: "commit" },
                { name: "Staged changes", value: "staged" },
                { name: "Unstaged changes", value: "unstaged" },
            ],
        },
    ]);
    console.log(chalk.gray("\nFetching diff..."));
    const diff = await getDiff(mode);
    if (!diff.trim()) {
        console.log(chalk.yellow("No changes found for the selected option."));
        process.exit(0);
    }
    console.log(chalk.gray(`Found ${diff.split("\n").length} lines of diff\n`));
    console.log(chalk.gray("Analyzing diff with Gemini Flash..."));
    const imagePrompt = await analyzeDiff(diff);
    console.log(chalk.green("\nGenerated image prompt:"));
    console.log(chalk.white(imagePrompt));
    const { proceed } = await inquirer.prompt([
        {
            type: "confirm",
            name: "proceed",
            message: "Generate image with this prompt?",
            default: true,
        },
    ]);
    if (!proceed) {
        console.log(chalk.yellow("Cancelled."));
        process.exit(0);
    }
    console.log(chalk.gray("\nGenerating image with Gemini Pro..."));
    const imageBuffer = await generateImage(imagePrompt);
    const outputPath = path.join(process.cwd(), `pr-visual-${Date.now()}.png`);
    fs.writeFileSync(outputPath, imageBuffer);
    console.log(chalk.green(`\nImage saved to: ${outputPath}`));
}
main().catch((err) => {
    console.error(chalk.red("Error:"), err.message);
    process.exit(1);
});
