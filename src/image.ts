import { GoogleGenAI } from "@google/genai";

const IMAGE_MODEL = "gemini-3-pro-image-preview";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiImageResponse {
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

async function generateWithOAuth(prompt: string, accessToken: string): Promise<Buffer> {
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

  const data: GeminiImageResponse = await response.json();

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

async function generateWithApiKey(prompt: string): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY!;
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

export async function generateImage(prompt: string, accessToken?: string): Promise<Buffer> {
  if (accessToken) {
    return generateWithOAuth(prompt, accessToken);
  }

  if (process.env.GEMINI_API_KEY) {
    return generateWithApiKey(prompt);
  }

  throw new Error("No authentication available");
}
