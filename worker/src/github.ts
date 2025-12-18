import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { PRFile } from "./types";

export async function getInstallationOctokit(
	installationId: number,
	appId: string,
	privateKey: string
): Promise<Octokit> {
	const auth = createAppAuth({
		appId,
		privateKey,
		installationId,
	});

	const installationAuth = await auth({ type: "installation" });

	return new Octokit({
		auth: installationAuth.token,
	});
}

export async function getPRFiles(
	octokit: Octokit,
	owner: string,
	repo: string,
	prNumber: number
): Promise<PRFile[]> {
	const { data } = await octokit.pulls.listFiles({
		owner,
		repo,
		pull_number: prNumber,
		per_page: 100,
	});

	return data as PRFile[];
}

export interface ExistingComment {
	id: number;
	body: string;
}

export async function findExistingComment(
	octokit: Octokit,
	owner: string,
	repo: string,
	prNumber: number,
	marker: string
): Promise<ExistingComment | null> {
	const { data: comments } = await octokit.issues.listComments({
		owner,
		repo,
		issue_number: prNumber,
		per_page: 100,
	});

	const existing = comments.find((c) => c.body?.includes(marker));
	if (!existing || !existing.body) return null;
	return { id: existing.id, body: existing.body };
}

export async function postPRComment(
	octokit: Octokit,
	owner: string,
	repo: string,
	prNumber: number,
	body: string,
	existingCommentId: number | null
): Promise<void> {
	if (existingCommentId) {
		await octokit.issues.updateComment({
			owner,
			repo,
			comment_id: existingCommentId,
			body,
		});
	} else {
		await octokit.issues.createComment({
			owner,
			repo,
			issue_number: prNumber,
			body,
		});
	}
}
