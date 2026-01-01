import { createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowInstance } from 'cloudflare:workers';
import type { PRWebhookPayload } from '../src/types';
import worker from '../src';

const { createCheckoutMock } = vi.hoisted(() => ({
	createCheckoutMock: vi.fn(),
}));

vi.mock('@polar-sh/sdk', () => ({
	Polar: class {
		checkouts = {
			create: createCheckoutMock,
		};
	},
}));

function makeEnv() {
	const workflowInstance = {} as WorkflowInstance;
	const workflow = {
		create: vi.fn().mockResolvedValue(workflowInstance),
		get: vi.fn().mockResolvedValue(workflowInstance),
		createBatch: vi.fn().mockResolvedValue([] as WorkflowInstance[]),
	} satisfies Workflow<{ payload: PRWebhookPayload }>;

	return {
		GITHUB_APP_ID: 'app',
		GITHUB_PRIVATE_KEY: 'key',
		GITHUB_WEBHOOK_SECRET: 'secret',
		GEMINI_API_KEY: 'gemini',
		POLAR_API_KEY: 'polar',
		PR_WORKFLOW: workflow,
		IMAGES: {} as R2Bucket,
	};
}

async function signPayload(payload: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
	const hex = Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `sha256=${hex}`;
}

describe('worker fetch routes', () => {
	it('returns ok for /health (integration style)', async () => {
		const response = await SELF.fetch(new Request('http://example.com/health'));
		expect(await response.text()).toBe('ok');
	});

	it('returns HTML for /success', async () => {
		const env = makeEnv();
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/success'), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.headers.get('Content-Type')).toContain('text/html');
		expect(await response.text()).toContain("You're all set!");
	});

	it('rejects /setup without installation_id', async () => {
		const env = makeEnv();
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request('http://example.com/setup'), env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Missing installation_id');
	});

	it('redirects /setup to Polar checkout', async () => {
		createCheckoutMock.mockResolvedValue({ url: 'https://checkout.example.com' });
		const env = makeEnv();
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request('http://example.com/setup?installation_id=123'),
			env,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(302);
		const location = response.headers.get('Location') ?? '';
		expect(location.replace(/\/$/, '')).toBe('https://checkout.example.com');
	});

	it('rejects GitHub webhooks without signature', async () => {
		const env = makeEnv();
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request('http://example.com/webhooks/github', { method: 'POST', body: '{}' }),
			env,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Missing signature');
	});

	it('rejects GitHub webhooks with invalid signature', async () => {
		const env = makeEnv();
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			new Request('http://example.com/webhooks/github', {
				method: 'POST',
				headers: {
					'x-hub-signature-256': 'sha256=bad',
				},
				body: '{}',
			}),
			env,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Invalid signature');
	});

	it('ignores non pull_request events', async () => {
		const env = makeEnv();
		const ctx = createExecutionContext();
		const signature = await signPayload('{}', env.GITHUB_WEBHOOK_SECRET);
		const response = await worker.fetch(
			new Request('http://example.com/webhooks/github', {
				method: 'POST',
				headers: {
					'x-hub-signature-256': signature,
					'x-github-event': 'push',
				},
				body: '{}',
			}),
			env,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(await response.text()).toBe('Ignored event');
	});

	it('ignores unsupported pull_request actions', async () => {
		const env = makeEnv();
		const ctx = createExecutionContext();
		const payload: PRWebhookPayload = {
			action: 'closed',
			number: 1,
			pull_request: {
				number: 1,
				title: 'title',
				body: null,
				head: { sha: 'sha', ref: 'branch' },
				base: { ref: 'main' },
			},
			repository: {
				id: 1,
				full_name: 'owner/repo',
				owner: { login: 'owner' },
				name: 'repo',
				private: false,
			},
			installation: { id: 1 },
		};
		const body = JSON.stringify(payload);
		const signature = await signPayload(body, env.GITHUB_WEBHOOK_SECRET);
		const response = await worker.fetch(
			new Request('http://example.com/webhooks/github', {
				method: 'POST',
				headers: {
					'x-hub-signature-256': signature,
					'x-github-event': 'pull_request',
				},
				body,
			}),
			env,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(await response.text()).toBe('Ignored action');
	});

	it('triggers workflow for supported pull_request events', async () => {
		const env = makeEnv();
		const ctx = createExecutionContext();
		const payload: PRWebhookPayload = {
			action: 'opened',
			number: 42,
			pull_request: {
				number: 42,
				title: 'title',
				body: null,
				head: { sha: 'deadbeef', ref: 'branch' },
				base: { ref: 'main' },
			},
			repository: {
				id: 99,
				full_name: 'owner/repo',
				owner: { login: 'owner' },
				name: 'repo',
				private: false,
			},
			installation: { id: 7 },
		};
		const body = JSON.stringify(payload);
		const signature = await signPayload(body, env.GITHUB_WEBHOOK_SECRET);
		const response = await worker.fetch(
			new Request('http://example.com/webhooks/github', {
				method: 'POST',
				headers: {
					'x-hub-signature-256': signature,
					'x-github-event': 'pull_request',
				},
				body,
			}),
			env,
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(await response.text()).toBe('Workflow triggered');
		expect(env.PR_WORKFLOW.create).toHaveBeenCalledWith({
			id: '7-99-42-deadbeef',
			params: { payload },
		});
	});
});
