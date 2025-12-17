import { GoogleGenAI } from "@google/genai";
const ANALYSIS_MODEL = "gemini-3-flash-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
async function generateWithOAuth(prompt, accessToken) {
    const response = await fetch(`${API_BASE}/models/${ANALYSIS_MODEL}:generateContent`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
        }),
    });
    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.message);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error("No response from Gemini");
    }
    return text.trim();
}
async function generateWithApiKey(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: ANALYSIS_MODEL,
        contents: prompt,
    });
    const text = response.text;
    if (!text) {
        throw new Error("No response from Gemini");
    }
    return text.trim();
}
export async function analyzeDiff(diff, accessToken) {
    const prompt = `You are an expert technical writer creating visual explainers for code changes. Your output will be passed to an image generation model to create an infographic.

Analyze this git diff and create a detailed, structured visual explainer. Think like you're designing an infographic that tells the story of this change.

Your output should include these sections (adapt based on what's relevant):

1. **Title & Problem Statement** - What problem does this change solve? One compelling headline.

2. **Before → After Flow** - Show the user journey or system state change. Use ASCII-style diagrams:
   \`\`\`
   ┌─────────────┐     ┌─────────────┐
   │   Before    │ ──→ │   After     │
   └─────────────┘     └─────────────┘
   \`\`\`

3. **Data Flow / Architecture Diagram** - How do components interact? Show the flow with boxes and arrows.

4. **Key Components Changed** - List files/modules with bullet points showing what each contributes.

5. **Why This Matters** - 2-3 bullet points on the impact or questions this enables.

Use these visual conventions:
- Boxes for components: ┌───┐ └───┘
- Arrows for flow: ──→ ──▶
- Checkmarks/X for before-after: ✅ ❌
- Icons for concepts: 📊 🔄 ⚡ 🔒

Git diff:
\`\`\`
${diff.slice(0, 15000)}
\`\`\`

Create a comprehensive visual explainer that an image generation model can turn into a polished infographic. Be specific about layout, sections, and visual hierarchy. Output the full explainer - do not truncate.`;
    if (accessToken) {
        return generateWithOAuth(prompt, accessToken);
    }
    if (process.env.GEMINI_API_KEY) {
        return generateWithApiKey(prompt);
    }
    throw new Error("No authentication available");
}
