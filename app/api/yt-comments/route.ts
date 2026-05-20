import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/api-errors";
import type { YtCommentRow, YtReplyRow, YtVideoRow } from "@/lib/youtube/repo";

export const runtime = "nodejs";

// GET /api/yt-comments?channel_id=...&statuses=new,drafted
// 댓글 + 영상 제목 + 최신 답글을 합쳐 UI가 한 번에 그릴 수 있게 반환.
export async function GET(req: NextRequest) {
  try {
    const channelId = req.nextUrl.searchParams.get("channel_id");
    if (!channelId) {
      return NextResponse.json({ error: "channel_id 필요" }, { status: 400 });
    }
    const statusesParam = req.nextUrl.searchParams.get("statuses");
    const statuses = statusesParam
      ? statusesParam.split(",").map((s) => s.trim()).filter(Boolean)
      : ["new", "drafted", "approved"];

    const sb = getSupabaseAdmin();
    const { data: comments, error } = await sb
      .from("yt_comments")
      .select("*")
      .eq("channel_id", channelId)
      .in("status", statuses)
      // 오래된 댓글부터 — 묵힌 댓글을 먼저 처리해서 시청자가 잊기 전에 답글 달기.
      .order("published_at", { ascending: true })
      .limit(200);
    if (error) throw error;

    const list = (comments ?? []) as YtCommentRow[];
    const videoIds = Array.from(new Set(list.map((c) => c.video_id)));
    const commentIds = list.map((c) => c.id);

    const [videosRes, repliesRes] = await Promise.all([
      videoIds.length > 0
        ? sb.from("yt_videos").select("*").in("id", videoIds)
        : Promise.resolve({ data: [] as YtVideoRow[], error: null }),
      commentIds.length > 0
        ? sb
            .from("yt_replies")
            .select("*")
            .in("comment_id", commentIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as YtReplyRow[], error: null }),
    ]);
    if (videosRes.error) throw videosRes.error;
    if (repliesRes.error) throw repliesRes.error;

    const videosById = new Map<string, YtVideoRow>(
      (videosRes.data ?? []).map((v) => [v.id, v as YtVideoRow]),
    );
    const latestReplyByComment = new Map<string, YtReplyRow>();
    for (const r of (repliesRes.data ?? []) as YtReplyRow[]) {
      if (!latestReplyByComment.has(r.comment_id)) {
        latestReplyByComment.set(r.comment_id, r);
      }
    }

    const items = list.map((c) => ({
      ...c,
      video_title: videosById.get(c.video_id)?.title ?? "(unknown)",
      latest_reply: latestReplyByComment.get(c.id) ?? null,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
