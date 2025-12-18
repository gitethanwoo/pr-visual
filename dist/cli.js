#!/usr/bin/env node
import { select, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import open from "open";
import { getDiff, detectBestDiffMode } from "./git.js";
import { analyzeDiff } from "./analyze.js";
import { generateImage } from "./image.js";
import { login, logout, showAuthStatus, getAccessToken } from "./auth.js";
import { printBanner, createSpinner, printSuccess, printStep, printError } from "./ui.js";
import * as fs from "node:fs";
import * as path from "node:path";
const STYLE_DESCRIPTIONS = {
    clean: "Corporate/PowerPoint style with polished boxes and professional colors",
    excalidraw: "Hand-drawn, sketchy whiteboard style with rough edges",
    minimal: "Simple and icon-heavy with lots of whitespace",
    tech: "Dark mode with neon accents and terminal aesthetics",
    playful: "Colorful, fun, with illustrations and friendly vibes",
};
const HELP_TEXT = `
${chalk.bold.cyan("PR Visual")} - Generate infographics from your git diffs using Gemini AI

${chalk.bold("USAGE:")}
  pr-visual [command] [options]

${chalk.bold("COMMANDS:")}
  login                   Login with Google OAuth
  logout                  Clear stored credentials
  status                  Show authentication status
  (none)                  Generate infographic (default)

${chalk.bold("OPTIONS:")}
  -h, --help              Show this help message
  -m, --mode <mode>       Diff mode: branch, commit, staged, unstaged
  -s, --style <style>     Visual style: clean, excalidraw, minimal, tech, playful
  -p, --prompt <text>     Custom prompt (bypasses diff analysis)
  --prompt-file <path>    Read prompt from file (bypasses diff analysis)
  -c, --commit <hash>     Commit hash (required when mode=commit)
  -y, --yes               Skip confirmation prompt
  -o, --output <path>     Output file path (default: pr-visual-{timestamp}.png)

${chalk.bold("STYLES:")}
  clean                   Corporate/PowerPoint style (default)
  excalidraw              Hand-drawn whiteboard style
  minimal                 Simple, icon-heavy, lots of whitespace
  tech                    Dark mode with neon accents
  playful                 Colorful and fun with illustrations

${chalk.bold("AUTHENTICATION:")}
  Option 1: Google OAuth (recommended)
    pr-visual login       Opens browser to authenticate with Google

  Option 2: API Key
    export GEMINI_API_KEY=your_key_here

${chalk.bold("EXAMPLES:")}
  ${chalk.gray("# Login with Google")}
  pr-visual login

  ${chalk.gray("# Interactive mode")}
  pr-visual

  ${chalk.gray("# Non-interactive: visualize staged changes")}
  pr-visual --mode staged --yes

  ${chalk.gray("# Non-interactive: visualize branch diff")}
  pr-visual --mode branch --yes

  ${chalk.gray("# Non-interactive: visualize specific commit")}
  pr-visual --mode commit --commit abc1234 --yes

  ${chalk.gray("# Custom output path")}
  pr-visual --mode staged --yes --output my-diff.png

${chalk.bold("NON-INTERACTIVE MODE (for CI/AI agents):")}
  To run without prompts, provide --mode and --yes flags.
  Example: pr-visual --mode branch --yes
`;
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        command: null,
        help: false,
        mode: null,
        style: null,
        prompt: null,
        promptFile: null,
        commit: null,
        yes: false,
        output: null,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "login":
            case "logout":
            case "status":
                result.command = arg;
                break;
            case "-h":
            case "--help":
                result.help = true;
                break;
            case "-m":
            case "--mode":
                result.mode = args[++i];
                break;
            case "-s":
            case "--style":
                result.style = args[++i];
                break;
            case "-p":
            case "--prompt":
                result.prompt = args[++i];
                break;
            case "--prompt-file":
                result.promptFile = args[++i];
                break;
            case "-c":
            case "--commit":
                result.commit = args[++i];
                break;
            case "-y":
            case "--yes":
                result.yes = true;
                break;
            case "-o":
            case "--output":
                result.output = args[++i];
                break;
        }
    }
    return result;
}
function isValidMode(mode) {
    return mode !== null && ["branch", "commit", "staged", "unstaged"].includes(mode);
}
function isValidStyle(style) {
    return style !== null && ["clean", "excalidraw", "minimal", "tech", "playful"].includes(style);
}
async function runQuickFlow() {
    printBanner();
    // Check for any auth
    let accessToken = await getAccessToken();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!accessToken && !apiKey) {
        printStep("No authentication found. Starting login...");
        console.log();
        await login();
        accessToken = await getAccessToken();
        if (!accessToken) {
            printError("Login failed. Please try again.");
            process.exit(1);
        }
        console.log();
    }
    // Auto-detect what to visualize
    const detected = await detectBestDiffMode();
    if (!detected) {
        printError("No changes found to visualize.");
        printStep("Make some changes, stage them, or switch to a feature branch.");
        process.exit(0);
    }
    printStep(`Analyzing ${detected.description}...`);
    console.log();
    const spinner = createSpinner("Generating creative brief");
    const diff = await getDiff(detected.mode);
    const style = "clean";
    const imagePrompt = await analyzeDiff(diff, style);
    spinner.update("Generating image");
    const imageBuffer = await generateImage(imagePrompt, accessToken ?? undefined);
    spinner.stop();
    const outputPath = path.join(process.cwd(), `pr-visual-${Date.now()}.png`);
    fs.writeFileSync(outputPath, imageBuffer);
    printSuccess(outputPath);
    console.log();
    await open(outputPath);
    // Post-generation prompt
    console.log(chalk.dim("  ─".repeat(20)));
    console.log();
    const next = await select({
        message: "What next?",
        choices: [
            { name: "Set up automatic PR visuals for this repo", value: "setup" },
            { name: "Generate another with different options", value: "another" },
            { name: "Exit", value: "exit" },
        ],
    });
    if (next === "setup") {
        console.log();
        printStep("Automatic PR setup coming soon.");
        printStep("For now, see: https://github.com/gitethanwoo/pr-visual#github-action");
        console.log();
    }
    else if (next === "another") {
        console.log();
        await runGenerate({
            command: null,
            help: false,
            mode: null,
            style: null,
            prompt: null,
            promptFile: null,
            commit: null,
            yes: false,
            output: null
        });
    }
}
async function runGenerate(args) {
    // Check authentication
    const accessToken = await getAccessToken();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!accessToken && !apiKey) {
        console.log(chalk.red("\nNo authentication found.\n"));
        console.log("Either:");
        console.log(chalk.cyan("  1. Run: pr-visual login"));
        console.log(chalk.cyan("  2. Set: export GEMINI_API_KEY=your_key\n"));
        process.exit(1);
    }
    // Check for custom prompt (bypasses diff analysis)
    let imagePrompt = null;
    if (args.prompt) {
        imagePrompt = args.prompt;
        console.log(chalk.cyan("\nUsing custom prompt (skipping diff analysis)...\n"));
    }
    else if (args.promptFile) {
        if (!fs.existsSync(args.promptFile)) {
            console.error(chalk.red(`Prompt file not found: ${args.promptFile}`));
            process.exit(1);
        }
        imagePrompt = fs.readFileSync(args.promptFile, "utf-8").trim();
        console.log(chalk.cyan(`\nUsing prompt from ${args.promptFile} (skipping diff analysis)...\n`));
    }
    // If no custom prompt, do the normal diff analysis flow
    if (!imagePrompt) {
        const isInteractive = !args.mode;
        if (isInteractive) {
            console.log(chalk.bold.cyan("\n  PR Visual - Generate infographics from your diffs\n"));
            console.log(chalk.gray("  Tip: Run with --help to see non-interactive options\n"));
        }
        let mode;
        let style;
        if (args.mode) {
            if (!isValidMode(args.mode)) {
                console.error(chalk.red(`Invalid mode: ${args.mode}`));
                console.error(chalk.gray("Valid modes: branch, commit, staged, unstaged"));
                process.exit(1);
            }
            mode = args.mode;
        }
        else {
            mode = await select({
                message: "What would you like to visualize?",
                choices: [
                    { name: "Branch diff (compare current branch to main/master)", value: "branch" },
                    { name: "Commit diff (changes in a specific commit)", value: "commit" },
                    { name: "Staged changes", value: "staged" },
                    { name: "Unstaged changes", value: "unstaged" },
                ],
            });
        }
        if (args.style) {
            if (!isValidStyle(args.style)) {
                console.error(chalk.red(`Invalid style: ${args.style}`));
                console.error(chalk.gray("Valid styles: clean, excalidraw, minimal, tech, playful"));
                process.exit(1);
            }
            style = args.style;
        }
        else if (isInteractive) {
            style = await select({
                message: "Choose a visual style:",
                choices: [
                    { name: "Clean - Corporate/PowerPoint style", value: "clean" },
                    { name: "Excalidraw - Hand-drawn whiteboard", value: "excalidraw" },
                    { name: "Minimal - Simple, icon-heavy", value: "minimal" },
                    { name: "Tech - Dark mode, neon accents", value: "tech" },
                    { name: "Playful - Colorful and fun", value: "playful" },
                ],
            });
        }
        else {
            style = "clean"; // Default for non-interactive
        }
        if (mode === "commit" && !args.commit && args.mode) {
            console.error(chalk.red("Commit mode requires --commit <hash> in non-interactive mode"));
            process.exit(1);
        }
        console.log(chalk.gray("\nFetching diff..."));
        const diff = await getDiff(mode, args.commit ?? undefined);
        if (!diff.trim()) {
            console.log(chalk.yellow("No changes found for the selected option."));
            process.exit(0);
        }
        console.log(chalk.gray(`Found ${diff.split("\n").length} lines of diff\n`));
        console.log(chalk.gray(`Analyzing diff with Gemini CLI (${style} style)...`));
        imagePrompt = await analyzeDiff(diff, style);
    }
    console.log(chalk.green("\nGenerated image prompt:"));
    console.log(chalk.white(imagePrompt));
    if (!args.yes) {
        const proceed = await confirm({
            message: "Generate image with this prompt?",
            default: true,
        });
        if (!proceed) {
            console.log(chalk.yellow("Cancelled."));
            process.exit(0);
        }
    }
    console.log(chalk.gray("\nGenerating image with Gemini Pro..."));
    const imageBuffer = await generateImage(imagePrompt, accessToken ?? undefined);
    const outputPath = args.output ?? path.join(process.cwd(), `pr-visual-${Date.now()}.png`);
    fs.writeFileSync(outputPath, imageBuffer);
    console.log(chalk.green(`\nImage saved to: ${outputPath}`));
    // Auto-open in interactive mode
    if (!args.yes) {
        await open(outputPath);
    }
}
function hasAnyArgs(args) {
    return !!(args.mode || args.style || args.prompt || args.promptFile || args.commit || args.yes || args.output);
}
async function main() {
    const args = parseArgs();
    if (args.help) {
        console.log(HELP_TEXT);
        process.exit(0);
    }
    switch (args.command) {
        case "login":
            await login();
            break;
        case "logout":
            logout();
            break;
        case "status":
            showAuthStatus();
            break;
        default:
            // If no args at all, use the new quick flow
            if (!hasAnyArgs(args)) {
                await runQuickFlow();
            }
            else {
                await runGenerate(args);
            }
    }
}
main().catch((err) => {
    console.error(chalk.red("Error:"), err.message);
    process.exit(1);
});
