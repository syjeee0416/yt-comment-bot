import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/youtube/oauth";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

// /api/yt-auth/start?channel_id=<우리 시스템 channel_id>
// → Google 동의 화면으로 302
export async function GET(req: NextRequest) {
  try {
    const channelId = req.nextUrl.searchParams.get("channel_id");
    if (!channelId) {
      return NextResponse.json({ error: "channel_id가 필요합니다." }, { status: 400 });
    }
    const state = Buffer.from(JSON.stringify({ channelId })).toString("base64url");
    const url = buildAuthUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    return errorResponse(err);
  }
}
