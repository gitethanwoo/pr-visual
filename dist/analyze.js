import { GoogleGenAI } from "@google/genai";
const ANALYSIS_MODEL = "gemini-3-flash-preview";
export async function analyzeDiff(diff) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required");
    }
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `You are an expert at creating visual representations of code changes.

Analyze this git diff and create a detailed image prompt for an infographic that visually explains what changed.

The image should:
- Be a clean, professional infographic style
- Show the key concepts/components that were added, modified, or removed
- Use visual metaphors to represent the code changes (e.g., boxes for components, arrows for data flow)
- Include a title that summarizes the change
- Use a modern, tech-focused color scheme

Git diff:
\`\`\`
${diff.slice(0, 15000)}
\`\`\`

Respond with ONLY the image prompt, no explanations. The prompt should be detailed enough for an image generation model to create a meaningful infographic. Keep it under 500 words.`;
    const response = await ai.models.generateContent({
        model: ANALYSIS_MODEL,
        contents: prompt,
    });
    const text = response.text;
    if (!text) {
        throw new Error("No response from Gemini Flash");
    }
    return text.trim();
}
