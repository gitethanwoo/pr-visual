import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { VisualStyle } from "./cli.js";

const STYLE_INSTRUCTIONS: Record<VisualStyle, string> = {
  clean: `Clean, beautiful, modern professional PowerPoint style.`,
  excalidraw: `Excalidraw / hand-drawn style with a nice handwritten feel.`,
  minimal: `Minimal and icon-heavy with generous whitespace.`,
  tech: `Dark mode with neon accents and terminal aesthetic.`,
  playful: `Playful and colorful with friendly rounded shapes.`,
};

export async function analyzeDiff(diff: string, style: VisualStyle): Promise<string> {
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
${diff.slice(0, 15000)}
\`\`\`

Output a visual brief. No preamble, just the brief.

STYLE: ${styleInstruction}`;

  // Write prompt to temp file to avoid shell escaping issues
  const tempFile = path.join(process.cwd(), ".pr-visual-prompt.tmp");
  fs.writeFileSync(tempFile, prompt);

  try {
    // Run gemini CLI via npx in headless mode with auto-approve for file reads
    const output = execSync(
      `cat "${tempFile}" | npx -y @google/gemini-cli -y -m gemini-3-flash-preview`,
      {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    return output.trim();
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}
