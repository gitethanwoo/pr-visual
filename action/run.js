import * as core from "@actions/core";
import * as github from "@actions/github";
import { GoogleGenAI } from "@google/genai";
import { simpleGit } from "simple-git";
import * as fs from "node:fs";
import * as path from "node:path";

const ANALYSIS_MODEL = "gemini-3-flash-preview";
const IMAGE_MODEL = "gemini-3-pro-image-preview";

const STYLE_INSTRUCTIONS = {
  clean: `Use a CLEAN / CORPORATE style: Professional PowerPoint aesthetic, polished boxes with shadows, blues/grays/teal palette, clean sans-serif fonts, structured grid layout.`,
  excalidraw: `Use an EXCALIDRAW / HAND-DRAWN style: Sketchy whiteboard aesthetic, rough imperfect lines, black on cream with pastel highlights, hand-written feel.`,
  minimal: `Use a MINIMAL / ICON-HEAVY style: Extreme simplicity, lots of whitespace, large bold icons, monochrome with one accent color, very limited text.`,
  tech: `Use a TECH / DARK MODE style: Dark background (#0d1117), neon accents (cyan/magenta/green), terminal aesthetic, monospace fonts, glowing effects.`,
  playful: `Use a PLAYFUL / COLORFUL style: Bright cheerful colors, rounded friendly shapes, cartoon illustrations, rainbow but harmonious palette.`,
};

// Tool definitions for agentic file reading
const tools = [
  {
    name: "readFile",
    description: "Read the contents of a file from the repository to understand the code better. Use this when you need more context about what a changed file does or how it fits into the codebase.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path relative to the repository root (e.g., 'src/utils.ts' or 'package.json')"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "listFiles",
    description: "List files in a directory to understand the project structure.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The directory path relative to the repository root (e.g., 'src' or '.')"
        }
      },
      required: ["path"]
    }
  }
];

function executeToolCall(toolName, args) {
  try {
    if (toolName === "readFile") {
      const filePath = path.resolve(process.cwd(), args.path);
      if (!fs.existsSync(filePath)) {
        return `File not found: ${args.path}`;
      }
      const content = fs.readFileSync(filePath, "utf-8");
      // Limit file size to avoid token explosion
      if (content.length > 10000) {
        return content.slice(0, 10000) + "\n... (truncated)";
      }
      return content;
    } else if (toolName === "listFiles") {
      const dirPath = path.resolve(process.cwd(), args.path || ".");
      if (!fs.existsSync(dirPath)) {
        return `Directory not found: ${args.path}`;
      }
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      return files
        .map((f) => (f.isDirectory() ? `${f.name}/` : f.name))
        .join("\n");
    }
    return `Unknown tool: ${toolName}`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

async function getBranchDiff() {
  const git = simpleGit();
  await git.fetch(["origin"]);

  let baseBranch = "origin/main";
  try {
    await git.revparse(["--verify", baseBranch]);
  } catch {
    baseBranch = "origin/master";
  }

  const diff = await git.diff([baseBranch, "HEAD"]);
  return diff;
}

async function agenticAnalysis(diff, style, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const styleInstruction = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.clean;

  const systemPrompt = `You are a creative director preparing a visual brief for an infographic about code changes.

Your job:
1. Understand what this PR/diff actually does
2. If the diff alone doesn't give you enough context, use the tools to read files
3. Once you understand, write a concise creative brief for an infographic

Guidelines:
- Scale complexity to the change. Small fixes = simple visuals. Big features = more detail.
- Focus on the ONE key insight or change, not every line
- Prefer clarity over comprehensiveness
- A single compelling diagram beats 5 dense sections
- ${styleInstruction}

When you fully understand the changes and are ready, output your creative brief starting with "BRIEF:" on its own line.`;

  const userPrompt = `Here's the git diff for this PR:

\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`

Analyze this diff. If you need to read any files to understand what the code does or how it fits into the project, use the readFile or listFiles tools. Once you understand the changes, write a creative brief for an infographic.`;

  let messages = [{ role: "user", parts: [{ text: userPrompt }] }];
  let iterations = 0;
  const maxIterations = 5;

  while (iterations < maxIterations) {
    iterations++;
    console.log(`Agentic iteration ${iterations}...`);

    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      systemInstruction: systemPrompt,
      contents: messages,
      tools: [{ functionDeclarations: tools }],
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error("No response from model");
    }

    // Add assistant response to messages
    messages.push({ role: "model", parts: candidate.content.parts });

    // Check for function calls
    const functionCalls = candidate.content.parts.filter((p) => p.functionCall);

    if (functionCalls.length > 0) {
      // Execute tool calls
      const toolResults = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        console.log(`  Tool call: ${name}(${JSON.stringify(args)})`);
        const result = executeToolCall(name, args);
        console.log(`  Result: ${result.slice(0, 100)}...`);
        toolResults.push({
          functionResponse: {
            name,
            response: { result },
          },
        });
      }
      // Add tool results to messages
      messages.push({ role: "user", parts: toolResults });
    } else {
      // No function calls - check if we have the brief
      const textParts = candidate.content.parts.filter((p) => p.text);
      const fullText = textParts.map((p) => p.text).join("\n");

      if (fullText.includes("BRIEF:")) {
        const brief = fullText.split("BRIEF:")[1].trim();
        return brief;
      }

      // Model finished without brief marker, use the full response
      return fullText;
    }
  }

  throw new Error("Max iterations reached without generating brief");
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

async function commitImageToPR(octokit, imageBuffer, context, prompt) {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;
  const headRef = context.payload.pull_request.head.ref;
  const commitSha = context.payload.pull_request.head.sha.slice(0, 7);

  // Use commit SHA in filename so each push gets its own image
  const imagePath = `.github/pr-visual/pr-${prNumber}-${commitSha}.png`;
  const promptPath = `.github/pr-visual/pr-${prNumber}-${commitSha}.txt`;
  const imageContent = imageBuffer.toString("base64");
  const promptContent = Buffer.from(prompt).toString("base64");

  // Commit both image and prompt file
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: imagePath,
    message: `Add PR visual for #${prNumber} (${commitSha})`,
    content: imageContent,
    branch: headRef,
  });

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: promptPath,
    message: `Add PR visual prompt for #${prNumber} (${commitSha})`,
    content: promptContent,
    branch: headRef,
  });

  const imageUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${headRef}/${imagePath}`;
  return { imagePath, imageUrl, commitSha };
}

async function getExistingImages(octokit, context) {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;
  const headRef = context.payload.pull_request.head.ref;

  try {
    const { data: contents } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: ".github/pr-visual",
      ref: headRef,
    });

    if (!Array.isArray(contents)) return [];

    // Filter to images for this PR, extract commit SHA from filename
    const prImages = contents
      .filter((f) => f.name.startsWith(`pr-${prNumber}-`) && f.name.endsWith(".png"))
      .map((f) => {
        const match = f.name.match(/pr-\d+-([a-f0-9]+)\.png/);
        const sha = match ? match[1] : null;
        return {
          name: f.name,
          sha,
          url: `https://raw.githubusercontent.com/${owner}/${repo}/${headRef}/.github/pr-visual/${f.name}`,
          promptUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${headRef}/.github/pr-visual/pr-${prNumber}-${sha}.txt`,
        };
      });

    // Fetch prompts for each image
    for (const img of prImages) {
      try {
        const { data: promptFile } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: `.github/pr-visual/pr-${prNumber}-${img.sha}.txt`,
          ref: headRef,
        });
        if (promptFile.content) {
          img.prompt = Buffer.from(promptFile.content, "base64").toString("utf-8");
        }
      } catch (e) {
        // Prompt file doesn't exist for older images
        img.prompt = null;
      }
    }

    return prImages;
  } catch (e) {
    // Directory doesn't exist yet
    return [];
  }
}

async function postOrUpdateComment(octokit, context, imageUrl, style, currentSha, currentPrompt) {
  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;

  // Get all existing images for this PR
  const existingImages = await getExistingImages(octokit, context);

  // Filter out the current image for the history section
  const olderImages = existingImages.filter((img) => img.sha !== currentSha);

  const commentMarker = "<!-- pr-visual-comment -->";

  // Format prompt for display (truncate if very long)
  const formatPrompt = (prompt) => {
    if (!prompt) return "_No prompt saved_";
    const maxLen = 2000;
    return prompt.length > maxLen ? prompt.slice(0, maxLen) + "..." : prompt;
  };

  let historySection = "";
  if (olderImages.length > 0) {
    const imageList = olderImages
      .map((img) => {
        const promptSection = `<details>
<summary>View prompt</summary>

\`\`\`
${formatPrompt(img.prompt)}
\`\`\`

</details>`;
        return `### \`${img.sha}\`\n![${img.sha}](${img.url}?t=${Date.now()})\n${promptSection}`;
      })
      .join("\n\n");
    historySection = `
<details>
<summary>Previous versions (${olderImages.length})</summary>

${imageList}

</details>
`;
  }

  const commentBody = `${commentMarker}
## PR Visual

**Latest** (\`${currentSha}\`):

![PR Infographic](${imageUrl}?t=${Date.now()})

<details>
<summary>View prompt</summary>

\`\`\`
${formatPrompt(currentPrompt)}
\`\`\`

</details>

${historySection}
<details>
<summary>About</summary>

**Style:** ${style} | [View full size](${imageUrl})

Generated with [pr-visual](https://github.com/gitethanwoo/pr-visual)

</details>
`;

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
    const customPrompt = process.env.INPUT_PROMPT;
    const style = process.env.INPUT_STYLE || "clean";
    const shouldComment = process.env.INPUT_COMMENT !== "false";
    const githubToken = process.env.GITHUB_TOKEN;

    if (!apiKey && !hostedApiKey) {
      core.setFailed("No authentication provided. Set gemini-api-key input.");
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
    let imagePrompt;

    if (customPrompt) {
      console.log("Using custom prompt...");
      imagePrompt = customPrompt;
    } else {
      console.log("Getting branch diff...");
      const diff = await getBranchDiff();

      if (!diff.trim()) {
        console.log("No changes found in this PR.");
        core.setOutput("image-path", "");
        core.setOutput("image-url", "");
        return;
      }

      console.log(`Found ${diff.split("\n").length} lines of diff`);
      console.log("Starting agentic analysis (may read files for context)...");

      imagePrompt = await agenticAnalysis(diff, style, apiKey || hostedApiKey);
    }

    console.log("\nCreative brief:");
    console.log(imagePrompt.slice(0, 800) + (imagePrompt.length > 800 ? "..." : ""));

    // Append style instruction to ensure it's applied (Flash might suggest different style)
    const styleInstruction = STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.clean;
    const finalPrompt = `${imagePrompt}\n\nIMPORTANT STYLE OVERRIDE: ${styleInstruction}`;

    console.log("\nGenerating image...");
    const imageBuffer = await generateImage(finalPrompt, apiKey || hostedApiKey);

    console.log("Committing image to PR branch...");
    const { imagePath, imageUrl, commitSha } = await commitImageToPR(octokit, imageBuffer, context, finalPrompt);

    console.log(`Image committed to: ${imagePath}`);

    if (shouldComment) {
      console.log("Posting comment...");
      await postOrUpdateComment(octokit, context, imageUrl, style, commitSha, finalPrompt);
    }

    core.setOutput("image-path", imagePath);
    core.setOutput("image-url", imageUrl);

    console.log("PR Visual complete!");
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
