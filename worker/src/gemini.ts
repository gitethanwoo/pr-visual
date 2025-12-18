const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const FLASH_MODEL = "gemini-3-flash-preview";
const IMAGE_MODEL = "gemini-3-pro-image-preview";

interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
				inlineData?: {
					mimeType: string;
					data: string;
				};
			}>;
		};
	}>;
	error?: {
		message: string;
	};
}

export async function generateBrief(
	diffContext: string,
	apiKey: string
): Promise<string> {
	const prompt = `You are a senior engineer creating a visual summary of a code change for your team.

Given this PR diff, create a creative brief for an infographic that explains:
1. WHAT changed (the technical details)
2. WHY it matters (the purpose/impact)

The brief should describe:
- A title for the infographic
- 1-4 distinct panels (if multiple unrelated changes, each gets its own panel)
- For each panel: what diagram/visual to show, what text to include
- Layout suggestion (single panel, side-by-side, 2x2 grid, etc.)

Keep it concise but specific. Focus on making the change understandable to someone reviewing the PR.

PR DIFF:
${diffContext}

CREATIVE BRIEF:`;

	const response = await fetch(
		`${GEMINI_API}/models/${FLASH_MODEL}:generateContent?key=${apiKey}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
			}),
		}
	);

	const data: GeminiResponse = await response.json();

	if (data.error) {
		throw new Error(`Gemini Flash error: ${data.error.message}`);
	}

	const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) {
		throw new Error("No response from Gemini Flash");
	}

	return text;
}

export async function generateImage(
	brief: string,
	apiKey: string
): Promise<ArrayBuffer> {
	const prompt = `Create a clean, professional infographic based on this creative brief.

Style: Modern, minimal, with clear visual hierarchy. Use a light background.
Make sure all text is legible and the diagram clearly explains the code change.

CREATIVE BRIEF:
${brief}

Generate the infographic image now.`;

	const response = await fetch(
		`${GEMINI_API}/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				generationConfig: {
					responseModalities: ["TEXT", "IMAGE"],
				},
			}),
		}
	);

	const data: GeminiResponse = await response.json();

	if (data.error) {
		throw new Error(`Gemini Image error: ${data.error.message}`);
	}

	const parts = data.candidates?.[0]?.content?.parts;
	if (!parts) {
		throw new Error("No response from Gemini Image");
	}

	for (const part of parts) {
		if (part.inlineData?.data) {
			// Convert base64 to ArrayBuffer
			const binary = atob(part.inlineData.data);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i);
			}
			return bytes.buffer;
		}
	}

	throw new Error("No image data in response");
}
