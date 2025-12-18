export interface PRWebhookPayload {
	action: string;
	number: number;
	pull_request: {
		number: number;
		title: string;
		body: string | null;
		head: {
			sha: string;
			ref: string;
		};
		base: {
			ref: string;
		};
	};
	repository: {
		id: number;
		full_name: string;
		owner: {
			login: string;
		};
		name: string;
		private: boolean;
	};
	installation: {
		id: number;
	};
}

export interface PRFile {
	filename: string;
	status: string;
	patch?: string;
	additions: number;
	deletions: number;
	changes: number;
}

export interface ProcessedPR {
	id: string;
	status: "processing" | "success" | "failed";
	image_url: string | null;
	error: string | null;
	created_at: number;
	updated_at: number;
}
