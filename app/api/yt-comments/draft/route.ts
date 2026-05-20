import { NextRequest, NextResponse } from "next/server";
import { generateReply } from "@/lib/gemini/generate-reply";
import {
  getYtAccount,
  insertReplyDraft,
  updateCommentStatus,
  getLatestReplyForComment,
} from "@/lib/youtube/repo";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";
// Gemini retry + fallback이 총 30초 이내. 여유롭게 45초.
export const maxDuration = 45;

// POST /api/yt-comments/draft { commentId, regenerate?: boolean }
// Gemini가 답글 초안을 만들어 yt_replies에 저장하고 댓글 상태를 'drafted'로.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { commentId?: string; regenerate?: boolean };
    const commentId = body.commentId;
    if (!commentId) {
      return NextResponse.json({ error: "commentId 필요" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { data: comment, error } = await sb
      .from("yt_comments")
      .select("*")
      .eq("id", commentId)
      .single();
    if (error || !comment) {
      return NextResponse.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
    }

    // 이미 초안이 있고 regenerate=false면 그대로 반환
    if (!body.regenerate) {
      const existing = await getLatestReplyForComment(commentId);
      if (existing && existing.status === "draft") {
        return NextResponse.json({ reply: existing, classification: comment.classification });
      }
    }

    const account = await getYtAccount(comment.channel_id);
    if (!account) {
      return NextResponse.json(
        { error: "이 채널에 연결된 YouTube 계정이 없습니다." },
        { status: 400 },
      );
    }

    const { data: video } = await sb
      .from("yt_videos")
      .select("title")
      .eq("id", comment.video_id)
      .maybeSingle();

    const generated = await generateReply({
      commentText: comment.text_original,
      videoTitle: video?.title ?? "(영상 제목 미확인)",
      authorDisplayName: comment.author_display_name,
      replyPersona: account.reply_persona,
    });

    // 스팸/욕설은 skipped로 분류만 하고 초안은 만들지 않음.
    if (!generated.should_reply) {
      await updateCommentStatus({
        commentId,
        status: "skipped",
        classification: generated.classification,
      });
      return NextResponse.json({
        skipped: true,
        classification: generated.classification,
        reason: generated.reason,
      });
    }

    const reply = await insertReplyDraft({
      commentId,
      channelId: comment.channel_id,
      draftText: generated.reply,
    });

    await updateCommentStatus({
      commentId,
      status: "drafted",
      classification: generated.classification,
    });

    return NextResponse.json({
      reply,
      classification: generated.classification,
      reason: generated.reason,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
