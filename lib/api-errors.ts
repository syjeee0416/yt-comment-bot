import { NextResponse } from "next/server";
import { GeminiNotConfiguredError } from "./gemini/client";
import { SupabaseNotConfiguredError } from "./supabase/server";
import { YouTubeOAuthNotConfiguredError } from "./youtube/oauth";

export function errorResponse(err: unknown) {
  if (err instanceof GeminiNotConfiguredError) {
    return NextResponse.json(
      { error: err.message, code: "GEMINI_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  if (err instanceof SupabaseNotConfiguredError) {
    return NextResponse.json(
      { error: err.message, code: "SUPABASE_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  if (err instanceof YouTubeOAuthNotConfiguredError) {
    return NextResponse.json(
      { error: err.message, code: "YOUTUBE_OAUTH_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const message = stringifyError(err);
  console.error("[api error]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    // Supabase PostgrestError, fetch Response 등 message 필드 있는 객체는 그걸 우선.
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    try {
      return JSON.stringify(err);
    } catch {
      return "[unserializable error]";
    }
  }
  return String(err);
}
