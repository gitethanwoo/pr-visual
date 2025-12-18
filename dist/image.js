import { GoogleGenAI } from "@google/genai";
const IMAGE_MODEL = "gemini-3-pro-image-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
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
    if (data.error) {
        throw new Error(data.error.message);
    }
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts) {
        throw new Error("No response from Gemini image model");
    }
    for (const part of parts) {
        if (part.inlineData?.data) {
            return Buffer.from(part.inlineData.data, "base64");
        }
    }
    throw new Error("No image data in response");
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
    if (!candidate?.content?.parts) {
        throw new Error("No response from Gemini image model");
    }
    for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
            return Buffer.from(part.inlineData.data, "base64");
        }
    }
    throw new Error("No image data in response");
}
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function generateImage(prompt, accessToken, retries = 3, onRetry) {
    const generate = accessToken
        ? () => generateWithOAuth(prompt, accessToken)
        : process.env.GEMINI_API_KEY
            ? () => generateWithApiKey(prompt)
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
