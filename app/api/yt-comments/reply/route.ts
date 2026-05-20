import { NextRequest, NextResponse } from "next/server";
import { postReply } from "@/lib/youtube/client";
import { updateReply, updateCommentStatus } from "@/lib/youtube/repo";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

// POST /api/yt-comments/reply { replyId, finalText? }
// 사용자가 검토·편집한 답글을 YouTube에 게시하고 결과를 DB에 반영.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { replyId?: string; finalText?: string };
    const replyId = body.replyId;
    if (!replyId) {
      return NextResponse.json({ error: "replyId 필요" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { data: reply, error } = await sb
      .from("yt_replies")
      .select("*")
      .eq("id", replyId)
      .single();
    if (error || !reply) {
      return NextResponse.json({ error: "답글을 찾을 수 없습니다." }, { status: 404 });
    }
    if (reply.status === "posted") {
      return NextResponse.json({ error: "이미 게시된 답글입니다." }, { status: 409 });
    }

    const textToPost = (body.finalText ?? reply.final_text ?? reply.draft_text).trim();
    if (textToPost.length === 0) {
      return NextResponse.json({ error: "답글 본문이 비었습니다." }, { status: 400 });
    }

    try {
      const posted = await postReply({
        channelId: reply.channel_id,
        parentCommentId: reply.comment_id,
        text: textToPost,
      });
      const now = new Date().toISOString();
      await updateReply({
        id: replyId,
        finalText: textToPost,
        status: "posted",
        ytReplyId: posted.id,
        postedAt: now,
      });
      await updateCommentStatus({
        commentId: reply.comment_id,
        status: "replied",
      });
      return NextResponse.json({ ok: true, ytReplyId: posted.id });
    } catch (postErr) {
      const message = postErr instanceof Error ? postErr.message : String(postErr);
      await updateReply({
        id: replyId,
        status: "failed",
        errorMessage: message,
      });
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
