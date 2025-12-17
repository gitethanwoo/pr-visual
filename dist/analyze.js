import { GoogleGenAI } from "@google/genai";
const ANALYSIS_MODEL = "gemini-3-flash-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const STYLE_INSTRUCTIONS = {
    clean: `
## Visual Style: CLEAN / CORPORATE
- Professional PowerPoint/Keynote aesthetic
- Polished boxes with subtle shadows and rounded corners
- Color palette: Blues, grays, and one accent color (teal or orange)
- Clean sans-serif fonts (like Inter, Helvetica)
- Structured grid layout with clear visual hierarchy
- Subtle gradients, no harsh colors
- Icons should be simple line icons (Lucide/Feather style)`,
    excalidraw: `
## Visual Style: EXCALIDRAW / HAND-DRAWN
- Sketchy, hand-drawn whiteboard aesthetic
- Rough, imperfect lines and shapes (like drawn with a marker)
- Color palette: Black lines on white/cream background, with pastel highlights (light blue, light green, light yellow)
- Hand-written style fonts (or clean fonts that feel casual)
- Arrows should look hand-drawn with slightly wobbly lines
- Boxes should have rough edges, not perfect rectangles
- Feel like someone quickly sketched this on a whiteboard to explain a concept`,
    minimal: `
## Visual Style: MINIMAL / ICON-HEAVY
- Extreme simplicity with lots of whitespace
- Large, bold icons as the primary visual elements
- Color palette: Monochrome (black, white, one accent color)
- Very limited text - let icons tell the story
- Clean geometric shapes
- Typography: Bold headers, minimal body text
- Think Apple keynote slides - one idea per section`,
    tech: `
## Visual Style: TECH / DARK MODE
- Dark background (#0d1117 or similar GitHub dark)
- Neon accent colors: Cyan (#00d4ff), Magenta (#ff00ff), Green (#00ff00)
- Terminal/code aesthetic with monospace fonts
- Glowing effects on key elements
- Matrix/cyberpunk vibes
- Code snippets should look like they're in a terminal
- Grid lines or subtle tech patterns in background`,
    playful: `
## Visual Style: PLAYFUL / COLORFUL
- Bright, cheerful colors (not neon, but saturated and fun)
- Rounded, friendly shapes
- Cartoon-style illustrations or characters if appropriate
- Color palette: Rainbow but harmonious (think Notion or Linear)
- Playful icons with personality
- Casual, friendly tone in any text
- Could include small illustrations of developers, computers, etc.
- Fun but still professional - think startup pitch deck`,
};
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
export async function analyzeDiff(diff, style, accessToken) {
    const styleInstructions = STYLE_INSTRUCTIONS[style];
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

${styleInstructions}

Git diff:
\`\`\`
${diff.slice(0, 15000)}
\`\`\`

Create a comprehensive visual explainer that an image generation model can turn into a polished infographic. Be specific about layout, sections, and visual hierarchy. The STYLE INSTRUCTIONS above are CRITICAL - make sure to emphasize these in your visual design notes. Output the full explainer - do not truncate.`;
    if (accessToken) {
        return generateWithOAuth(prompt, accessToken);
    }
    if (process.env.GEMINI_API_KEY) {
        return generateWithApiKey(prompt);
    }
    throw new Error("No authentication available");
}
