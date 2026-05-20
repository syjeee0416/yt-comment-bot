import { NextRequest, NextResponse } from "next/server";
import {
  listYtAccounts,
  updateReplyPersona,
  disconnectYtAccount,
} from "@/lib/youtube/repo";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

// GET /api/yt-accounts — 연결된 YouTube 계정 목록.
// refresh_token / access_token은 보안상 응답에서 제외.
export async function GET() {
  try {
    const all = await listYtAccounts();
    const items = all.map((a) => ({
      channel_id: a.channel_id,
      yt_channel_id: a.yt_channel_id,
      yt_channel_title: a.yt_channel_title,
      scope: a.scope,
      reply_persona: a.reply_persona,
      reply_mode: a.reply_mode,
      connected_at: a.connected_at,
      updated_at: a.updated_at,
    }));
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/yt-accounts { channelId, replyPersona?, replyMode? }
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      channelId?: string;
      replyPersona?: string;
      replyMode?: "manual" | "auto";
    };
    if (!body.channelId) {
      return NextResponse.json({ error: "channelId 필요" }, { status: 400 });
    }
    await updateReplyPersona({
      channelId: body.channelId,
      persona: body.replyPersona ?? "",
      mode: body.replyMode ?? "manual",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/yt-accounts?channel_id=...
export async function DELETE(req: NextRequest) {
  try {
    const channelId = req.nextUrl.searchParams.get("channel_id");
    if (!channelId) {
      return NextResponse.json({ error: "channel_id 필요" }, { status: 400 });
    }
    await disconnectYtAccount(channelId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
