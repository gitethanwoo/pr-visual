import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { Polar } from "@polar-sh/sdk";
import { PRWebhookPayload, PRFile } from "./types";
import { getInstallationOctokit, getPRFiles, postPRComment, findExistingComment, ExistingComment } from "./github";
import { generateBrief, generateImage } from "./gemini";

interface HistoryImage {
	sha: string;
	url: string;
}

const COMMENT_MARKER = "<!-- pr-visual -->";
const MAX_DIFF_BYTES = 50_000;
const SKIP_FILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"];

/**
 * Extract all images (current + history) from an existing PR Visual comment.
 * Returns them in order from newest to oldest.
 */
function parseImagesFromComment(body: string): HistoryImage[] {
	const images: HistoryImage[] = [];

	// Match the "Latest" image: **Latest** (`sha`): followed by ![...](url)
	const latestMatch = body.match(/\*\*Latest\*\* \(`([a-f0-9]+)`\)[\s\S]*?!\[.*?\]\((https:\/\/[^\s)]+\.png)\)/);
	if (latestMatch) {
		images.push({ sha: latestMatch[1], url: latestMatch[2] });
	}

	// Match history images: ### `sha` followed by ![...](url)
	const historyRegex = /### `([a-f0-9]+)`\s*\n!\[.*?\]\((https:\/\/[^\s)]+\.png)\)/g;
	let match;
	while ((match = historyRegex.exec(body)) !== null) {
		images.push({ sha: match[1], url: match[2] });
	}

	return images;
}

interface PRWorkflowParams {
	payload: PRWebhookPayload;
}

export class PRVisualWorkflow extends WorkflowEntrypoint<Env, PRWorkflowParams> {
	async run(event: WorkflowEvent<PRWorkflowParams>, step: WorkflowStep) {
		const { payload } = event.payload;
		const { installation, repository, pull_request } = payload;

		// Step 0: Check billing status and meter balance
		const billingCheck = await step.do("check-billing", async () => {
			const polar = new Polar({ accessToken: this.env.POLAR_API_KEY });

			try {
				// Get customer state which includes meter balances
				const state = await polar.customers.getStateExternal({
					externalId: String(installation.id)
				});

				// Check if any meter has balance > 0
				const hasCredits = state.activeMeters.some(meter => meter.balance > 0);

				return {
					customerId: state.id,
					hasCredits,
					balance: state.activeMeters[0]?.balance ?? 0
				};
			} catch {
				// Customer not found
				console.log(`No Polar customer for installation ${installation.id}`);
				return null;
			}
		});

		if (!billingCheck) {
			console.log(`Skipping - no billing for installation ${installation.id}`);
			return { success: false, reason: "no_billing" };
		}

		if (!billingCheck.hasCredits) {
			console.log(`Skipping - no credits for installation ${installation.id} (balance: ${billingCheck.balance})`);
			return { success: false, reason: "no_credits" };
		}

		const customerId = billingCheck.customerId;

		// Step 1: Fetch PR files (creates octokit internally, returns serializable data)
		const files = await step.do("fetch-files", async () => {
			const octokit = await getInstallationOctokit(
				installation.id,
				this.env.GITHUB_APP_ID,
				this.env.GITHUB_PRIVATE_KEY
			);
			return getPRFiles(
				octokit,
				repository.owner.login,
				repository.name,
				pull_request.number
			);
		});

		// Step 2: Build diff context
		const diffContext = await step.do("build-context", async () => {
			return buildDiffContext(files, pull_request.title, pull_request.body);
		});

		// Step 3: Generate brief (Gemini Flash)
		const brief = await step.do("generate-brief", async () => {
			return generateBrief(diffContext, this.env.GEMINI_API_KEY);
		});

		// Step 4: Generate image and upload to R2 in one step (avoid serializing large image)
		const imageUrl = await step.do("generate-and-upload-image", async () => {
			const buffer = await generateImage(brief, this.env.GEMINI_API_KEY);
			const imageKey = `${crypto.randomUUID()}.png`;
			await this.env.IMAGES.put(imageKey, buffer, {
				httpMetadata: { contentType: "image/png" },
			});
			return `https://pub-0cfe4cdfb68145a58c9ed7c3c722e930.r2.dev/${imageKey}`;
		});

		// Step 5: Post comment (creates octokit internally)
		await step.do("post-comment", async () => {
			const octokit = await getInstallationOctokit(
				installation.id,
				this.env.GITHUB_APP_ID,
				this.env.GITHUB_PRIVATE_KEY
			);

			const existingComment = await findExistingComment(
				octokit,
				repository.owner.login,
				repository.name,
				pull_request.number,
				COMMENT_MARKER
			);

			// Extract previous images from existing comment
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
		});

		// Step 6: Report usage and cost to Polar
		await step.do("report-usage", async () => {
			const polar = new Polar({ accessToken: this.env.POLAR_API_KEY });
			await polar.events.ingest({
				events: [{
					name: "pr_visual_generation",
					customerId: customerId,
					metadata: {
						_cost: {
							amount: 13.9, // cents ($0.139)
							currency: "usd"
						},
						repo: repository.full_name,
						pr_number: pull_request.number,
						image_url: imageUrl
					}
				}]
			});
		});

		return { success: true, imageUrl };
	}
}

function buildDiffContext(
	files: PRFile[],
	title: string,
	body: string | null
): string {
	let totalBytes = 0;
	const patches: string[] = [];

	const header = `PR Title: ${title}\n${body ? `Description: ${body}\n` : ""}\n`;
	totalBytes += header.length;
	patches.push(header);

	for (const file of files) {
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
