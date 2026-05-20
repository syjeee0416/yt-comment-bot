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
  const message = err instanceof Error ? err.message : String(err);
  console.error("[api error]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}
