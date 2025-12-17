import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import { GoogleGenAI } from "@google/genai";
import { simpleGit } from "simple-git";
import * as fs from "node:fs";
import * as path from "node:path";

const ANALYSIS_MODEL = "gemini-3-flash-preview";
const IMAGE_MODEL = "gemini-3-pro-image-preview";

const STYLE_INSTRUCTIONS = {
  clean: `
## Visual Style: CLEAN / CORPORATE
- Professional PowerPoint/Keynote aesthetic
- Polished boxes with subtle shadows and rounded corners
- Color palette: Blues, grays, and one accent color (teal or orange)
- Clean sans-serif fonts (like Inter, Helvetica)
- Structured grid layout with clear visual hierarchy
- Subtle gradients, no harsh colors
- Icons should be simple line icons (Lucide/Feather style)`,

  excalidraw: `
## Visual Style: EXCALIDRAW / HAND-DRAWN
- Sketchy, hand-drawn whiteboard aesthetic
- Rough, imperfect lines and shapes (like drawn with a marker)
- Color palette: Black lines on white/cream background, with pastel highlights
- Hand-written style fonts (or clean fonts that feel casual)
- Arrows should look hand-drawn with slightly wobbly lines
- Boxes should have rough edges, not perfect rectangles
- Feel like someone quickly sketched this on a whiteboard`,

  minimal: `
## Visual Style: MINIMAL / ICON-HEAVY
- Extreme simplicity with lots of whitespace
- Large, bold icons as the primary visual elements
- Color palette: Monochrome (black, white, one accent color)
- Very limited text - let icons tell the story
- Clean geometric shapes
- Typography: Bold headers, minimal body text`,

  tech: `
## Visual Style: TECH / DARK MODE
- Dark background (#0d1117 or similar GitHub dark)
- Neon accent colors: Cyan (#00d4ff), Magenta (#ff00ff), Green (#00ff00)
- Terminal/code aesthetic with monospace fonts
- Glowing effects on key elements
- Matrix/cyberpunk vibes
- Code snippets should look like they're in a terminal`,

  playful: `
## Visual Style: PLAYFUL / COLORFUL
- Bright, cheerful colors (not neon, but saturated and fun)
- Rounded, friendly shapes
- Cartoon-style illustrations or characters if appropriate
- Color palette: Rainbow but harmonious (think Notion or Linear)
- Playful icons with personality
- Casual, friendly tone in any text`,
};

async function getBranchDiff() {
  const git = simpleGit();

  // Fetch to ensure we have remote refs
  await git.fetch(["origin"]);

  // Get the default branch
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === "origin");
  if (!origin) {
    throw new Error("No origin remote found");
  }

  // Try main, then master
  let baseBranch = "origin/main";
  try {
    await git.revparse(["--verify", baseBranch]);
  } catch {
    baseBranch = "origin/master";
  }

  // Get the diff
  const diff = await git.diff([baseBranch, "HEAD"]);
  return diff;
}

async function analyzeDiff(diff, style, apiKey) {
  const styleInstructions = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.clean;

  const prompt = `You are an expert technical writer creating visual explainers for code changes. Your output will be passed to an image generation model to create an infographic.

Analyze this git diff and create a detailed, structured visual explainer. Think like you're designing an infographic that tells the story of this change.

Your output should include these sections (adapt based on what's relevant):

1. **Title & Problem Statement** - What problem does this change solve? One compelling headline.

2. **Before → After Flow** - Show the user journey or system state change. Use ASCII-style diagrams:
   \`\`\`
   ┌─────────────┐     ┌─────────────┐
   │   Before    │ ──→ │   After     │
   └─────────────┘     └─────────────┘
   \`\`\`

3. **Data Flow / Architecture Diagram** - How do components interact? Show the flow with boxes and arrows.

4. **Key Components Changed** - List files/modules with bullet points showing what each contributes.

5. **Why This Matters** - 2-3 bullet points on the impact.

Use these visual conventions:
- Boxes for components: ┌───┐ └───┘
- Arrows for flow: ──→ ──▶
- Checkmarks/X for before-after: ✅ ❌
- Icons for concepts: 📊 🔄 ⚡ 🔒

${styleInstructions}

Git diff:
\`\`\`
${diff.slice(0, 15000)}
\`\`\`

Create a comprehensive visual explainer that an image generation model can turn into a polished infographic. Be specific about layout, sections, and visual hierarchy. The STYLE INSTRUCTIONS above are CRITICAL - make sure to emphasize these in your visual design notes. Output the full explainer - do not truncate.`;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: ANALYSIS_MODEL,
    contents: prompt,
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response from Gemini analysis model");
  }

  return text.trim();
}

async function generateImage(prompt, apiKey) {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: prompt,
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error("No response from Gemini image model");
  }

  for (const part of candidate.content.parts) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, "base64");
    }
  }

  throw new Error("No image data in response");
}

async function commitImageToPR(octokit, imageBuffer, context) {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;
  const headRef = context.payload.pull_request.head.ref;

  const imagePath = `.github/pr-visual/pr-${prNumber}.png`;
  const imageContent = imageBuffer.toString("base64");

  // Check if file already exists
  let existingSha;
  try {
    const { data: existingFile } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: imagePath,
      ref: headRef,
    });
    existingSha = existingFile.sha;
  } catch (e) {
    // File doesn't exist yet, that's fine
  }

  // Create or update the file
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: imagePath,
    message: `Update PR visual for #${prNumber}`,
    content: imageContent,
    branch: headRef,
    ...(existingSha && { sha: existingSha }),
  });

  // Return the raw URL
  const imageUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${headRef}/${imagePath}`;
  return { imagePath, imageUrl };
}

async function postOrUpdateComment(octokit, context, imageUrl, style) {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;

  const commentMarker = "<!-- pr-visual-comment -->";
  const commentBody = `${commentMarker}
## PR Visual

![PR Infographic](${imageUrl}?t=${Date.now()})

<details>
<summary>Generated with pr-visual</summary>

**Style:** ${style}

[View full size](${imageUrl})

</details>
`;

  // Look for existing comment
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existingComment = comments.find((c) => c.body?.includes(commentMarker));

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: commentBody,
    });
    console.log(`Updated existing comment: ${existingComment.html_url}`);
  } else {
    const { data: newComment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    });
    console.log(`Created new comment: ${newComment.html_url}`);
  }
}

async function main() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const hostedApiKey = process.env.HOSTED_API_KEY;
    const style = process.env.INPUT_STYLE || "clean";
    const shouldComment = process.env.INPUT_COMMENT !== "false";
    const githubToken = process.env.GITHUB_TOKEN;

    // Validate auth
    if (!apiKey && !hostedApiKey) {
      core.setFailed(
        "No authentication provided. Set gemini-api-key or hosted-api-key input."
      );
      return;
    }

    if (!githubToken) {
      core.setFailed("No GitHub token provided.");
      return;
    }

    const context = github.context;

    if (!context.payload.pull_request) {
      core.setFailed("This action only works on pull_request events.");
      return;
    }

    const octokit = github.getOctokit(githubToken);

    console.log("Getting branch diff...");
    const diff = await getBranchDiff();

    if (!diff.trim()) {
      console.log("No changes found in this PR.");
      core.setOutput("image-path", "");
      core.setOutput("image-url", "");
      return;
    }

    console.log(`Found ${diff.split("\n").length} lines of diff`);

    console.log(`Analyzing diff with Gemini Flash (${style} style)...`);
    const imagePrompt = await analyzeDiff(diff, style, apiKey || hostedApiKey);

    console.log("Generated image prompt:");
    console.log(imagePrompt.slice(0, 500) + "...");

    console.log("Generating image with Gemini Pro...");
    const imageBuffer = await generateImage(imagePrompt, apiKey || hostedApiKey);

    console.log("Committing image to PR branch...");
    const { imagePath, imageUrl } = await commitImageToPR(
      octokit,
      imageBuffer,
      context
    );

    console.log(`Image committed to: ${imagePath}`);

    if (shouldComment) {
      console.log("Posting comment...");
      await postOrUpdateComment(octokit, context, imageUrl, style);
    }

    core.setOutput("image-path", imagePath);
    core.setOutput("image-url", imageUrl);

    console.log("PR Visual complete!");
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
