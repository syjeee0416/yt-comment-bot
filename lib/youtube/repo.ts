// yt_accounts / yt_videos / yt_comments / yt_replies 테이블 헬퍼.
import { getSupabaseAdmin } from "../supabase/server";

export type YtAccountRow = {
  channel_id: string;
  yt_channel_id: string;
  yt_channel_title: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  scope: string;
  reply_persona: string;
  reply_mode: "manual" | "auto";
  connected_at: string;
  updated_at: string;
};

export type YtVideoRow = {
  id: string;
  channel_id: string;
  title: string;
  published_at: string | null;
  comment_count: number;
  last_synced_at: string | null;
};

export type YtCommentRow = {
  id: string;
  video_id: string;
  channel_id: string;
  author_display_name: string;
  author_channel_id: string | null;
  text_original: string;
  like_count: number;
  published_at: string | null;
  is_reply: boolean;
  parent_comment_id: string | null;
  status: "new" | "drafted" | "approved" | "replied" | "skipped";
  classification: string | null;
  fetched_at: string;
};

export type YtReplyRow = {
  id: string;
  comment_id: string;
  channel_id: string;
  draft_text: string;
  final_text: string | null;
  yt_reply_id: string | null;
  status: "draft" | "posted" | "failed" | "discarded";
  error_message: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function getYtAccount(channelId: string): Promise<YtAccountRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_accounts")
    .select("*")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listYtAccounts(): Promise<YtAccountRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_accounts")
    .select("*")
    .order("connected_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function upsertYtAccount(input: {
  channelId: string;
  ytChannelId: string;
  ytChannelTitle: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  scope: string;
}): Promise<YtAccountRow> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_accounts")
    .upsert({
      channel_id: input.channelId,
      yt_channel_id: input.ytChannelId,
      yt_channel_title: input.ytChannelTitle,
      refresh_token: input.refreshToken,
      access_token: input.accessToken,
      access_token_expires_at: input.accessTokenExpiresAt,
      scope: input.scope,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAccessToken(input: {
  channelId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("yt_accounts")
    .update({
      access_token: input.accessToken,
      access_token_expires_at: input.accessTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", input.channelId);
  if (error) throw error;
}

export async function updateReplyPersona(input: {
  channelId: string;
  persona: string;
  mode: "manual" | "auto";
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("yt_accounts")
    .update({
      reply_persona: input.persona,
      reply_mode: input.mode,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", input.channelId);
  if (error) throw error;
}

export async function disconnectYtAccount(channelId: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("yt_accounts").delete().eq("channel_id", channelId);
  if (error) throw error;
}

// ─────────────── 영상 ───────────────

export async function upsertVideos(rows: YtVideoRow[]): Promise<void> {
  if (rows.length === 0) return;
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("yt_videos").upsert(rows);
  if (error) throw error;
}

export async function listVideos(channelId: string): Promise<YtVideoRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_videos")
    .select("*")
    .eq("channel_id", channelId)
    .order("published_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─────────────── 댓글 ───────────────

export async function upsertComments(rows: Omit<YtCommentRow, "fetched_at">[]): Promise<void> {
  if (rows.length === 0) return;
  const sb = getSupabaseAdmin();
  // id로 중복은 무시 — 이미 있는 댓글은 상태(replied 등) 유지.
  const { error } = await sb.from("yt_comments").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

export async function updateCommentStatus(input: {
  commentId: string;
  status: YtCommentRow["status"];
  classification?: string;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { status: input.status };
  if (input.classification !== undefined) patch.classification = input.classification;
  const { error } = await sb.from("yt_comments").update(patch).eq("id", input.commentId);
  if (error) throw error;
}

// 본인 채널(=운영자 본인)이 단 top-level 댓글은 답글 대상이 아니므로 모두 skipped 처리.
// 고정 댓글은 보통 본인이 단 공지·CTA라 이 한 줄로 거의 다 잡힘.
// idempotent — 이미 skipped/replied인 행은 안 건드림.
export async function markOwnChannelCommentsAsSkipped(input: {
  channelId: string;
  ownYtChannelId: string;
}): Promise<number> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_comments")
    .update({ status: "skipped", classification: "own_channel" })
    .eq("channel_id", input.channelId)
    .eq("author_channel_id", input.ownYtChannelId)
    .in("status", ["new", "drafted", "approved"])
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// 사용자가 유튜브에서 직접 답글 단 댓글들을 replied로 마킹.
// (우리 도구를 거치지 않고 유튜브에서 직접 단 답글까지 추적해서 큐에서 빼는 용도)
export async function markCommentsAsAlreadyReplied(input: {
  channelId: string;
  commentIds: string[];
}): Promise<number> {
  if (input.commentIds.length === 0) return 0;
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_comments")
    .update({ status: "replied", classification: "external_reply" })
    .eq("channel_id", input.channelId)
    .in("id", input.commentIds)
    .in("status", ["new", "drafted", "approved"])
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// ─────────────── 답글 ───────────────

export async function insertReplyDraft(input: {
  commentId: string;
  channelId: string;
  draftText: string;
}): Promise<YtReplyRow> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_replies")
    .insert({
      comment_id: input.commentId,
      channel_id: input.channelId,
      draft_text: input.draftText,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateReply(input: {
  id: string;
  finalText?: string;
  status?: YtReplyRow["status"];
  ytReplyId?: string;
  errorMessage?: string;
  postedAt?: string;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.finalText !== undefined) patch.final_text = input.finalText;
  if (input.status !== undefined) patch.status = input.status;
  if (input.ytReplyId !== undefined) patch.yt_reply_id = input.ytReplyId;
  if (input.errorMessage !== undefined) patch.error_message = input.errorMessage;
  if (input.postedAt !== undefined) patch.posted_at = input.postedAt;
  const { error } = await sb.from("yt_replies").update(patch).eq("id", input.id);
  if (error) throw error;
}

export async function getLatestReplyForComment(
  commentId: string,
): Promise<YtReplyRow | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("yt_replies")
    .select("*")
    .eq("comment_id", commentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
