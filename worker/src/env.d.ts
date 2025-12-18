import { Workflow } from "cloudflare:workers";
import { PRWebhookPayload } from "./types";

interface PRWorkflowParams {
	payload: PRWebhookPayload;
}

// Extend Env with secrets and workflow binding
declare global {
	interface Env {
		GITHUB_APP_ID: string;
		GITHUB_PRIVATE_KEY: string;
		GITHUB_WEBHOOK_SECRET: string;
		GEMINI_API_KEY: string;
		POLAR_API_KEY: string;
		PR_WORKFLOW: Workflow<PRWorkflowParams>;
		IMAGES: R2Bucket;
	}
}

export {};
