import { NextRequest, NextResponse } from "next/server";
import {
  fetchRecentVideos,
  fetchAllVideosViaPlaylist,
  fetchVideoComments,
  fetchAllVideoComments,
  type YtCommentSummary,
} from "@/lib/youtube/client";
import {
  getYtAccount,
  upsertVideos,
  upsertComments,
  markOwnChannelCommentsAsSkipped,
} from "@/lib/youtube/repo";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";
// Vercel Hobby 기본 10초 → 60초. "전체 수집"이 영상 많을 때 대비.
export const maxDuration = 60;

// 채널 ID(UC...)를 그 채널의 uploads playlist ID(UU...)로 변환.
// YouTube에서 보장하는 변환 규칙. channels.list 한 번 더 호출하는 쿼터 절약.
function toUploadsPlaylistId(ytChannelId: string): string {
  if (!ytChannelId.startsWith("UC")) {
    throw new Error(`예상치 못한 YouTube channel ID 형식: ${ytChannelId}`);
  }
  return "UU" + ytChannelId.slice(2);
}

// POST /api/yt-comments/sync { channelId, maxVideos?: number, mode?: 'recent' | 'all' }
//
// mode='recent' (기본): 최근 영상 N개 × 댓글 1페이지(100개) — 빠른 폴링.
//   쿼터: 1u + N (대략)
// mode='all': 채널의 모든 영상 × 영상당 모든 페이지 — 백필용 1회 수집.
//   쿼터: (영상수/50) + sum(영상당 댓글수/100)
//   ※ 답글 단 댓글은 ignoreDuplicates로 상태 유지됨.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      channelId?: string;
      maxVideos?: number;
      mode?: "recent" | "all";
    };
    const channelId = body.channelId;
    if (!channelId) {
      return NextResponse.json({ error: "channelId 필요" }, { status: 400 });
    }
    const mode: "recent" | "all" = body.mode === "all" ? "all" : "recent";
    const maxVideos = Math.min(Math.max(body.maxVideos ?? 5, 1), 20);

    const account = await getYtAccount(channelId);
    if (!account) {
      return NextResponse.json(
        { error: "이 채널에 연결된 YouTube 계정이 없습니다." },
        { status: 400 },
      );
    }

    const uploadsPlaylistId = toUploadsPlaylistId(account.yt_channel_id);
    const videos =
      mode === "all"
        ? await fetchAllVideosViaPlaylist({ channelId, uploadsPlaylistId })
        : await fetchRecentVideos({
            channelId,
            uploadsPlaylistId,
            max: maxVideos,
          });

    const nowIso = new Date().toISOString();
    await upsertVideos(
      videos.map((v) => ({
        id: v.id,
        channel_id: channelId,
        title: v.title,
        published_at: v.publishedAt,
        comment_count: 0,
        last_synced_at: nowIso,
      })),
    );

    // 기존에 들어와 있던 본인 채널 댓글들을 한 번에 skipped로 정리.
    // 새 sync에서는 처음부터 안 들어가지만, 과거에 수집된 행은 여기서 청소.
    const ownCleared = await markOwnChannelCommentsAsSkipped({
      channelId,
      ownYtChannelId: account.yt_channel_id,
    });

    let totalNewComments = 0;
    const perVideo: Array<{
      videoId: string;
      fetched: number;
      skipped?: string;
      error?: string;
    }> = [];
    const skippedReasons: string[] = [];

    for (const v of videos) {
      // recent 모드: 영상당 1페이지(100개)만. 빠른 폴링용.
      // all 모드: 영상당 모든 페이지. 백필용.
      // 어느 쪽이든 댓글 꺼진 영상(commentsDisabled) 등 영상 단위 실패는 다음 영상으로 넘어감.
      try {
        const items: YtCommentSummary[] =
          mode === "all"
            ? await fetchAllVideoComments({ channelId, videoId: v.id })
            : (await fetchVideoComments({ channelId, videoId: v.id })).items;

        // 본인 채널(=운영자)이 단 댓글은 처음부터 제외 — 고정 댓글·공지·CTA가 여기 거의 다 들어감.
        const filtered = items.filter(
          (c) => c.authorChannelId !== account.yt_channel_id,
        );

        const rows = filtered.map((c) => ({
          id: c.id,
          video_id: v.id,
          channel_id: channelId,
          author_display_name: c.authorDisplayName,
          author_channel_id: c.authorChannelId,
          text_original: c.textOriginal,
          like_count: c.likeCount,
          published_at: c.publishedAt,
          is_reply: false,
          parent_comment_id: null,
          status: "new" as const,
          classification: null,
        }));
        await upsertComments(rows);
        totalNewComments += rows.length;
        perVideo.push({ videoId: v.id, fetched: rows.length });
      } catch (videoErr) {
        const msg = videoErr instanceof Error ? videoErr.message : String(videoErr);
        // YouTube가 반환하는 영상 단위 에러들 — sync 전체를 죽이지 않고 다음으로.
        if (/commentsDisabled|disabled comments/i.test(msg)) {
          perVideo.push({ videoId: v.id, fetched: 0, skipped: "commentsDisabled" });
          skippedReasons.push(`${v.id}: 댓글 비활성화`);
        } else if (/videoNotFound|forbidden/i.test(msg)) {
          perVideo.push({ videoId: v.id, fetched: 0, skipped: "videoNotFound" });
          skippedReasons.push(`${v.id}: 영상 접근 불가`);
        } else {
          perVideo.push({ videoId: v.id, fetched: 0, error: msg.slice(0, 200) });
          skippedReasons.push(`${v.id}: ${msg.slice(0, 80)}`);
          // 영상 1~2개 실패는 OK지만, 모든 영상이 실패하면 토큰 문제일 수 있어
          // 마지막 영상이 모두 error로 끝나면 응답에 그대로 노출.
        }
      }
    }

    return NextResponse.json({
      ok: true,
      videos: videos.length,
      comments: totalNewComments,
      perVideo,
      skipped: skippedReasons,
      ownChannelCommentsCleared: ownCleared,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
