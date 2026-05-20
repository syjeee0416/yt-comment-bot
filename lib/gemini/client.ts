import { GoogleGenAI } from "@google/genai";

// 답글은 짧고 빠른 응답이 중요. Flash로 충분 (Pro 대비 503 발생률 ~1/10).
const TEXT_MODEL = "gemini-2.5-flash";
// 1차 모델이 과부하(503) 받을 때 fallback. flash-lite가 더 가벼워서 거의 항상 응답.
const TEXT_LITE_MODEL = "gemini-2.5-flash-lite";

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new GeminiNotConfiguredError();
  }
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

export const GEMINI_MODELS = {
  text: TEXT_MODEL,
  textLite: TEXT_LITE_MODEL,
};

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super(
      "GEMINI_API_KEY 미설정. .env.local 파일에 키를 추가하세요. https://aistudio.google.com/apikey",
    );
    this.name = "GeminiNotConfiguredError";
  }
}
