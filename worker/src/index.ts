import { Polar } from "@polar-sh/sdk";
import { verifyWebhookSignature } from "./crypto";
import { PRWebhookPayload } from "./types";

export { PRVisualWorkflow } from "./workflow";

const POLAR_FREE_PRODUCT_ID = "201f043f-4da5-48d4-8b17-c33a0cfee23f";
const POLAR_PRO_PRODUCT_ID = "da72bcb2-15eb-4fd8-ad61-fda5d3126eab";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return new Response("ok");
		}

		if (url.pathname === "/webhooks/github" && request.method === "POST") {
			return handleGitHubWebhook(request, env);
		}

		// GitHub App installation callback - create checkout session and redirect
		if (url.pathname === "/setup") {
			const installationId = url.searchParams.get("installation_id");
			if (!installationId) {
				return new Response("Missing installation_id", { status: 400 });
			}

			const polar = new Polar({ accessToken: env.POLAR_API_KEY });

			// Create checkout session with both products, linked to installation ID
			const checkout = await polar.checkouts.create({
				products: [POLAR_FREE_PRODUCT_ID, POLAR_PRO_PRODUCT_ID],
				externalCustomerId: installationId,
				successUrl: `${url.origin}/success`,
			});

			return Response.redirect(checkout.url, 302);
		}

		// Post-checkout success page
		if (url.pathname === "/success") {
			return new Response(
				`<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>PR Visual - You're all set!</title>
	<style>
		body { font-family: system-ui, sans-serif; max-width: 500px; margin: 100px auto; padding: 20px; text-align: center; }
		h1 { font-size: 48px; margin-bottom: 8px; }
		p { color: #666; font-size: 18px; line-height: 1.6; }
		a { color: #0066cc; }
	</style>
</head>
<body>
	<h1>&#127912;</h1>
	<h2>You're all set!</h2>
	<p>Open a PR on any repo where you installed PR Visual.<br>You'll get an infographic comment within seconds.</p>
	<p><a href="https://github.com">Go to GitHub &#8594;</a></p>
</body>
</html>`,
				{ headers: { "Content-Type": "text/html; charset=utf-8" } }
			);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function handleGitHubWebhook(
	request: Request,
	env: Env
): Promise<Response> {
	// Verify signature
	const signature = request.headers.get("x-hub-signature-256");
	if (!signature) {
		return new Response("Missing signature", { status: 401 });
	}

	const body = await request.text();
	const isValid = await verifyWebhookSignature(
		body,
		signature,
		env.GITHUB_WEBHOOK_SECRET
	);
	if (!isValid) {
		return new Response("Invalid signature", { status: 401 });
	}

	// Check event type
	const event = request.headers.get("x-github-event");
	if (event !== "pull_request") {
		return new Response("Ignored event");
	}

	const payload: PRWebhookPayload = JSON.parse(body);

	// Only handle opened, synchronize, reopened
	if (!["opened", "synchronize", "reopened"].includes(payload.action)) {
		return new Response("Ignored action");
	}

	// Create unique workflow ID for idempotency
	const workflowId = `${payload.installation.id}-${payload.repository.id}-${payload.pull_request.number}-${payload.pull_request.head.sha}`;

	// Trigger workflow
	try {
		await env.PR_WORKFLOW.create({
			id: workflowId,
			params: { payload },
		});
	} catch (e: unknown) {
		// Workflow with this ID might already exist (idempotency)
		const error = e as Error;
		if (!error.message?.includes("already exists")) {
			throw e;
		}
		console.log(`Workflow ${workflowId} already exists, skipping`);
	}

	return new Response("Workflow triggered");
}
