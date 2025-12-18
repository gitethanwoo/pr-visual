import { PRWebhookPayload, PRFile } from "./types";
import { getInstallationOctokit, getPRFiles, postPRComment, findExistingComment } from "./github";
import { generateBrief, generateImage } from "./gemini";

const COMMENT_MARKER = "<!-- pr-visual -->";
const MAX_DIFF_BYTES = 50_000; // 50KB cap on total diff
const SKIP_FILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"];

interface HistoryImage {
	sha: string;
	url: string;
}

function parseImagesFromComment(body: string): HistoryImage[] {
	const images: HistoryImage[] = [];
	const latestMatch = body.match(/\*\*Latest\*\* \(`([a-f0-9]+)`\)[\s\S]*?!\[.*?\]\((https:\/\/[^\s)]+\.png)\)/);
	if (latestMatch) {
		images.push({ sha: latestMatch[1], url: latestMatch[2] });
	}
	const historyRegex = /### `([a-f0-9]+)`\s*\n!\[.*?\]\((https:\/\/[^\s)]+\.png)\)/g;
	let match;
	while ((match = historyRegex.exec(body)) !== null) {
		images.push({ sha: match[1], url: match[2] });
	}
	return images;
}

export async function processPR(payload: PRWebhookPayload, env: Env): Promise<void> {
	const { installation, repository, pull_request } = payload;
	const prKey = `${installation.id}:${repository.id}:${pull_request.number}:${pull_request.head.sha}`;

	try {
		// Check idempotency
		const existing = await env.DB.prepare(
			"SELECT status FROM processed_prs WHERE id = ?"
		).bind(prKey).first<{ status: string }>();

		if (existing?.status === "success") {
			console.log(`Already processed: ${prKey}`);
			return;
		}

		// Mark as processing
		await env.DB.prepare(
			`INSERT INTO processed_prs (id, status, created_at, updated_at)
			 VALUES (?, 'processing', ?, ?)
			 ON CONFLICT(id) DO UPDATE SET status = 'processing', updated_at = ?`
		).bind(prKey, Date.now(), Date.now(), Date.now()).run();


		// Get GitHub octokit client for this installation
		console.log("Getting octokit...");
		const octokit = await getInstallationOctokit(
			installation.id,
			env.GITHUB_APP_ID,
			env.GITHUB_PRIVATE_KEY
		);
		console.log("Got octokit");

		// Fetch PR files (patches only)
		console.log("Fetching PR files...");
		const files = await getPRFiles(
			octokit,
			repository.owner.login,
			repository.name,
			pull_request.number
		);
		console.log(`Got ${files.length} files`);

		// Build diff context (capped)
		const diffContext = buildDiffContext(files, pull_request.title, pull_request.body);
		console.log(`Diff context: ${diffContext.length} bytes`);

		// Generate creative brief via Gemini Flash
		console.log("Generating brief...");
		const brief = await generateBrief(diffContext, env.GEMINI_API_KEY);
		console.log("Got brief");

		// Generate image via Gemini Pro
		console.log("Generating image...");
		const imageBuffer = await generateImage(brief, env.GEMINI_API_KEY);
		console.log(`Got image: ${imageBuffer.byteLength} bytes`);

		// Upload to R2 with unguessable key
		const imageKey = `${crypto.randomUUID()}.png`;
		await env.IMAGES.put(imageKey, imageBuffer, {
			httpMetadata: { contentType: "image/png" },
		});

		// Get public URL (requires R2 bucket to have public access enabled)
		// Format: https://<account>.r2.dev/<bucket>/<key> or custom domain
		const imageUrl = `https://pub-0cfe4cdfb68145a58c9ed7c3c722e930.r2.dev/${imageKey}`;

		// Post or update PR comment
		const existingComment = await findExistingComment(
			octokit,
			repository.owner.login,
			repository.name,
			pull_request.number,
			COMMENT_MARKER
		);

		const previousImages = existingComment
			? parseImagesFromComment(existingComment.body)
			: [];

		const commitSha = pull_request.head.sha.slice(0, 7);
		const commentBody = formatComment(imageUrl, commitSha, previousImages);

		await postPRComment(
			octokit,
			repository.owner.login,
			repository.name,
			pull_request.number,
			commentBody,
			existingComment?.id ?? null
		);

		// Mark as success
		await env.DB.prepare(
			"UPDATE processed_prs SET status = 'success', image_url = ?, updated_at = ? WHERE id = ?"
		).bind(imageUrl, Date.now(), prKey).run();

		console.log(`Successfully processed PR: ${prKey}`);
	} catch (error) {
		console.error(`Failed to process PR ${prKey}:`, error);

		// Mark as failed
		await env.DB.prepare(
			"UPDATE processed_prs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?"
		).bind(String(error), Date.now(), prKey).run();
	}
}

function buildDiffContext(
	files: PRFile[],
	title: string,
	body: string | null
): string {
	let totalBytes = 0;
	const patches: string[] = [];

	// Add PR title and body
	const header = `PR Title: ${title}\n${body ? `Description: ${body}\n` : ""}\n`;
	totalBytes += header.length;
	patches.push(header);

	// Add file patches, respecting cap
	for (const file of files) {
		// Skip lockfiles and binaries
		if (SKIP_FILES.some((skip) => file.filename.endsWith(skip))) continue;
		if (!file.patch) continue;

		const entry = `\n--- ${file.filename} ---\n${file.patch}\n`;
		if (totalBytes + entry.length > MAX_DIFF_BYTES) {
			patches.push(`\n... (diff truncated at ${MAX_DIFF_BYTES} bytes) ...`);
			break;
		}

		patches.push(entry);
		totalBytes += entry.length;
	}

	return patches.join("");
}

function formatComment(imageUrl: string, commitSha: string, previousImages: HistoryImage[]): string {
	let historySection = "";
	if (previousImages.length > 0) {
		const imageList = previousImages
			.map((img) => `### \`${img.sha}\`\n![${img.sha}](${img.url})`)
			.join("\n\n");
		historySection = `
<details>
<summary>Previous versions (${previousImages.length})</summary>

${imageList}

</details>
`;
	}

	return `${COMMENT_MARKER}
## 🎨 PR Visual

**Latest** (\`${commitSha}\`):

![PR Infographic](${imageUrl})

${historySection}
<details>
<summary>About this image</summary>

Generated automatically by [pr-visual](https://github.com/gitethanwoo/pr-visual).

</details>`;
}
