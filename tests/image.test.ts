import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { FinishReason } from "@google/genai";
import { generateImage } from "../src/image";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = {
        generateContent: generateContentMock,
      };
    },
  };
});

describe("generateImage", () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    generateContentMock.mockReset();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("uses OAuth flow when access token is provided", async () => {
    const imageBytes = Buffer.from("hello");
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: imageBytes.toString("base64"),
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage("prompt", "token", 1);

    expect(result.toString()).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const init = fetchMock.mock.calls[0]?.[1];
    if (!init || typeof init.body !== "string") {
      throw new Error("Expected JSON body");
    }
    const body = JSON.parse(init.body) as { contents: Array<{ parts: Array<{ text: string }> }> };
    expect(body.contents[0]?.parts[0]?.text).toContain("Generate an image");
  });

  it("reports prompt feedback blocks", async () => {
    const payload = {
      promptFeedback: {
        blockReason: "SAFETY",
      },
    };

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImage("prompt", "token", 1)).rejects.toThrow("Prompt blocked: SAFETY");
  });

  it("errors when no auth is available", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateImage("prompt")).rejects.toThrow("No authentication available");
  });

  it("uses API key flow when GEMINI_API_KEY is set", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const imageBytes = Buffer.from("world");
    const response: GenerateContentResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: imageBytes.toString("base64"),
                  mimeType: "image/png",
                },
              },
            ],
          },
          finishReason: FinishReason.STOP,
        },
      ],
    };

    generateContentMock.mockResolvedValue(response);

    const result = await generateImage("prompt");

    expect(result.toString()).toBe("world");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const args = generateContentMock.mock.calls[0]?.[0];
    if (!args || typeof args.contents !== "string") {
      throw new Error("Expected string contents");
    }
    expect(args.contents).toContain("Generate an image");
  });

  it("reports missing images from API key responses", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const response: GenerateContentResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: "no image here",
              },
            ],
          },
          finishReason: FinishReason.SAFETY,
        },
      ],
    };

    generateContentMock.mockResolvedValue(response);

    await expect(generateImage("prompt", undefined, 1)).rejects.toThrow("Response blocked due to safety filters");
  });
});
