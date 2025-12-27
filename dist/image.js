import { GoogleGenAI } from "@google/genai";
const IMAGE_MODEL = "gemini-3-pro-image-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Known finish reasons that indicate why image generation failed
const FINISH_REASON_MESSAGES = {
    IMAGE_SAFETY: "Image blocked due to safety filters",
    IMAGE_PROHIBITED_CONTENT: "Image blocked due to prohibited content",
    SAFETY: "Response blocked due to safety filters",
    RECITATION: "Response blocked due to recitation concerns",
    BLOCKLIST: "Response blocked due to blocklist",
    PROHIBITED_CONTENT: "Response blocked due to prohibited content",
    SPII: "Response blocked due to sensitive personal information",
    MALFORMED_FUNCTION_CALL: "Malformed function call in response",
};
function buildNoImageError(finishReason, textResponse, blockReason) {
    const parts = [];
    // Check for known finish reasons
    if (finishReason && FINISH_REASON_MESSAGES[finishReason]) {
        parts.push(FINISH_REASON_MESSAGES[finishReason]);
    }
    else if (finishReason && finishReason !== "STOP") {
        parts.push(`Finish reason: ${finishReason}`);
    }
    // Check for prompt block reason
    if (blockReason) {
        parts.push(`Prompt blocked: ${blockReason}`);
    }
    // Include text response if model explained why
    if (textResponse) {
        const truncated = textResponse.length > 200
            ? textResponse.slice(0, 200) + "..."
            : textResponse;
        parts.push(`Model response: "${truncated}"`);
    }
    if (parts.length === 0) {
        parts.push("Model returned no image (reason unknown)");
    }
    return new Error(parts.join(". "));
}
async function generateWithOAuth(prompt, accessToken) {
    const response = await fetch(`${API_BASE}/models/${IMAGE_MODEL}:generateContent`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
            },
        }),
    });
    const data = await response.json();
    // Check for API error
    if (data.error) {
        throw new Error(`API error: ${data.error.message}`);
    }
    // Check for prompt-level blocking
    if (data.promptFeedback?.blockReason) {
        throw new Error(`Prompt blocked: ${data.promptFeedback.blockReason}`);
    }
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) {
        throw buildNoImageError(candidate?.finishReason, undefined, data.promptFeedback?.blockReason);
    }
    const parts = candidate.content.parts;
    const finishReason = candidate.finishReason;
    // Look for image data
    for (const part of parts) {
        if (part.inlineData?.data) {
            return Buffer.from(part.inlineData.data, "base64");
        }
    }
    // No image found - extract any text response for diagnostics
    const textParts = parts.filter(p => p.text).map(p => p.text).join(" ");
    throw buildNoImageError(finishReason, textParts || undefined);
}
async function generateWithApiKey(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: prompt,
        config: {
            responseModalities: ["TEXT", "IMAGE"],
        },
    });
    const candidate = response.candidates?.[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finishReason = candidate?.finishReason;
    if (!candidate?.content?.parts) {
        throw buildNoImageError(finishReason);
    }
    // Look for image data
    for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
            return Buffer.from(part.inlineData.data, "base64");
        }
    }
    // No image found - extract any text response for diagnostics
    const textParts = candidate.content.parts
        .filter(p => p.text)
        .map(p => p.text)
        .join(" ");
    throw buildNoImageError(finishReason, textParts || undefined);
}
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Wrap prompt to explicitly request image generation
function wrapPromptForImage(prompt) {
    return `Generate an image based on the following description. You MUST output an image.

${prompt}

Remember: Output an image, not just text.`;
}
export async function generateImage(prompt, accessToken, retries = 3, onRetry) {
    const imagePrompt = wrapPromptForImage(prompt);
    const generate = accessToken
        ? () => generateWithOAuth(imagePrompt, accessToken)
        : process.env.GEMINI_API_KEY
            ? () => generateWithApiKey(imagePrompt)
            : null;
    if (!generate) {
        throw new Error("No authentication available");
    }
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await generate();
        }
        catch (err) {
            lastError = err;
            if (attempt < retries) {
                onRetry?.(attempt, lastError);
                // Exponential backoff: 2s, 4s, 8s...
                await sleep(Math.pow(2, attempt) * 1000);
            }
        }
    }
    throw lastError;
}
