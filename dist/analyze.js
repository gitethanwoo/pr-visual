import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
const execAsync = promisify(exec);
const MAX_DIFF_CHARS = 50_000;
const SKIP_FILES = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "composer.lock",
    "Cargo.lock",
    "Gemfile.lock",
    "poetry.lock",
];
function filterDiff(diff) {
    // Split by diff headers and filter out lock files
    const parts = diff.split(/(?=^diff --git )/m);
    return parts
        .filter((part) => {
        const match = part.match(/^diff --git a\/(.+?) b\//);
        if (!match)
            return true; // Keep non-diff parts (like initial context)
        const filename = match[1];
        return !SKIP_FILES.some((skip) => filename.endsWith(skip));
    })
        .join("");
}
const STYLE_INSTRUCTIONS = {
    clean: `Clean, beautiful, modern professional PowerPoint style.`,
    excalidraw: `Excalidraw / hand-drawn style with a nice handwritten feel.`,
    minimal: `Minimal and icon-heavy with generous whitespace.`,
    tech: `Dark mode with neon accents and terminal aesthetic.`,
    playful: `Playful and colorful with friendly rounded shapes.`,
};
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function analyzeDiff(diff, style, retries = 3, onRetry) {
    const styleInstruction = STYLE_INSTRUCTIONS[style];
    const prompt = `You are a senior engineer explaining a PR to your team via a visual diagram.

Your job:
1. Understand what this code change actually does
2. Read any relevant files if you need more context
3. Identify DISTINCT EFFORTS - if the PR has multiple unrelated changes, treat each as a separate panel
4. Explain the WHY, not just the WHAT - "we delegated to gemini-cli instead of running the SDK ourselves" is better than "changed analyze.ts"

Guidelines:
- DISTINCT PANELS: 2-4 unrelated changes = 2-4 panels. Arrange in a grid layout.
- Each panel MUST have: title + diagram + 1-2 sentence explanation text visible in the image
- The explanation text is critical - it answers "why did we do this?" not just "what changed"
- Pick ONE archetype per panel: before/after, process flow, architecture diagram, or checklist
- Use function/file names but EXPLAIN the change, don't just list files
- Do not invent metrics. Use real values or omit.

LAYOUT: Render ALL panels in a SINGLE image. Layout based on panel count: 1 panel = full image, 2 = side by side, 3 = 1x3 row, 4 = 2x2 grid.

Here's the git diff:

\`\`\`diff
${(() => {
        const filtered = filterDiff(diff);
        return filtered.length > MAX_DIFF_CHARS
            ? filtered.slice(0, MAX_DIFF_CHARS) + "\n\n... (diff truncated) ..."
            : filtered;
    })()}
\`\`\`

Output a visual brief. No preamble, just the brief.

STYLE: ${styleInstruction}`;
    // Write prompt to temp file to avoid shell escaping issues
    const tempFile = path.join(process.cwd(), ".pr-visual-prompt.tmp");
    fs.writeFileSync(tempFile, prompt);
    let lastError = null;
    try {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // Run gemini CLI via npx in headless mode with auto-approve for file reads
                const { stdout } = await execAsync(`cat "${tempFile}" | npx -y @google/gemini-cli -y -m gemini-3-flash-preview`, {
                    maxBuffer: 10 * 1024 * 1024,
                    timeout: 120000,
                });
                return stdout.trim();
            }
            catch (err) {
                lastError = err;
                if (attempt < retries) {
                    onRetry?.(attempt, lastError);
                    // Exponential backoff: 2s, 4s, 8s...
                    await sleep(Math.pow(2, attempt) * 1000);
                }
            }
        }
        throw lastError;
    }
    finally {
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    }
}
