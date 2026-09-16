import { GoogleGenAI } from "@google/genai";

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

type AIProvider = "openrouter" | "gemini";

function getProvider(): AIProvider {
  const provider = (process.env.AI_PROVIDER || "openrouter").toLowerCase();
  return provider === "gemini" ? "gemini" : "openrouter";
}

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const baseUrl = (process.env.OPENROUTER_BASE_URL || process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error("OpenRouter API key is missing. Set OPENROUTER_API_KEY or AI_INTEGRATIONS_GEMINI_API_KEY.");
  }

  return { apiKey, baseUrl, model };
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  if (!apiKey) {
    throw new Error("Gemini API key is missing. Set GEMINI_API_KEY or AI_INTEGRATIONS_GEMINI_API_KEY.");
  }

  return { apiKey, model };
}

async function generateWithOpenRouter(prompt: string, options: { systemPrompt?: string; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const { apiKey, baseUrl, model } = getOpenRouterConfig();

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:4300",
      "X-Title": "TheSocialPundit",
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : []),
        { role: "user", content: prompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
  }

  const json = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").join("").trim();
  }

  return "";
}

async function generateWithGemini(prompt: string, options: { systemPrompt?: string; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const { apiKey, model } = getGeminiConfig();
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt }] }],
    config: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 1024,
    },
  });

  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || "";
  return text.trim();
}

export async function generateText(prompt: string, options: { systemPrompt?: string; temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const provider = getProvider();

  if (provider === "gemini") {
    return generateWithGemini(prompt, options);
  }

  return generateWithOpenRouter(prompt, options);
}
