// YouTube Data API v3 호출 헬퍼.
// 모든 호출은 채널 id 기준으로 yt_accounts에서 토큰을 꺼내 쓰고,
// 만료 1분 이내면 refresh_token으로 갱신한 뒤 DB에 반영한다.

import { refreshAccessToken } from "./oauth";
import {
  getYtAccount,
  updateAccessToken,
  type YtAccountRow,
} from "./repo";

const API_BASE = "https://www.googleapis.com/youtube/v3";

async function ensureAccessToken(account: YtAccountRow): Promise<string> {
  const now = Date.now();
  const expiresAt = account.access_token_expires_at
    ? new Date(account.access_token_expires_at).getTime()
    : 0;
  if (account.access_token && expiresAt - now > 60_000) {
    return account.access_token;
  }
  const refreshed = await refreshAccessToken(account.refresh_token);
  const newExpiresAt = new Date(now + refreshed.expires_in * 1000).toISOString();
  await updateAccessToken({
    channelId: account.channel_id,
    accessToken: refreshed.access_token,
    accessTokenExpiresAt: newExpiresAt,
  });
  return refreshed.access_token;
}

async function authedFetch(
  channelId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const account = await getYtAccount(channelId);
  if (!account) {
    throw new Error(`이 채널에 연결된 YouTube 계정이 없습니다. (channel_id=${channelId})`);
  }
  const token = await ensureAccessToken(account);
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

async function readJsonOrThrow(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${label} 실패 (${res.status}): ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// ─────────────── 채널 정보 ───────────────

export type YtChannelInfo = {
  id: string;
  title: string;
  uploadsPlaylistId: string;
};

export async function fetchOwnChannel(accessToken: string): Promise<YtChannelInfo> {
  // OAuth 직후엔 아직 DB에 account가 없으므로 토큰을 직접 받아 호출.
  const url = `${API_BASE}/channels?part=snippet,contentDetails&mine=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await readJsonOrThrow(res, "channels.list(mine)")) as {
    items?: Array<{
      id: string;
      snippet: { title: string };
      contentDetails: { relatedPlaylists: { uploads: string } };
    }>;
  };
  const item = json.items?.[0];
  if (!item) throw new Error("연결한 구글 계정에 YouTube 채널이 없습니다.");
  return {
    id: item.id,
    title: item.snippet.title,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

// ─────────────── 최근 영상 ───────────────

export type YtVideoSummary = {
  id: string;
  title: string;
  publishedAt: string;
};

export async function fetchRecentVideos(input: {
  channelId: string;
  uploadsPlaylistId: string;
  max?: number;
}): Promise<YtVideoSummary[]> {
  const max = Math.min(input.max ?? 20, 50);
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId: input.uploadsPlaylistId,
    maxResults: String(max),
  });
  const res = await authedFetch(input.channelId, `/playlistItems?${params}`);
  const json = (await readJsonOrThrow(res, "playlistItems.list")) as {
    items?: Array<{
      contentDetails: { videoId: string; videoPublishedAt: string };
      snippet: { title: string };
    }>;
  };
  return (json.items ?? []).map((it) => ({
    id: it.contentDetails.videoId,
    title: it.snippet.title,
    publishedAt: it.contentDetails.videoPublishedAt,
  }));
}

// uploads playlist 끝까지 페이지네이션 — 채널 전체 영상 모음.
// 쿼터: playlistItems.list 1u × (영상 수 / 50)
export async function fetchAllVideosViaPlaylist(input: {
  channelId: string;
  uploadsPlaylistId: string;
}): Promise<YtVideoSummary[]> {
  const all: YtVideoSummary[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      playlistId: input.uploadsPlaylistId,
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await authedFetch(input.channelId, `/playlistItems?${params}`);
    const json = (await readJsonOrThrow(res, "playlistItems.list")) as {
      nextPageToken?: string;
      items?: Array<{
        contentDetails: { videoId: string; videoPublishedAt: string };
        snippet: { title: string };
      }>;
    };
    for (const it of json.items ?? []) {
      all.push({
        id: it.contentDetails.videoId,
        title: it.snippet.title,
        publishedAt: it.contentDetails.videoPublishedAt,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return all;
}

// 한 영상의 모든 top-level 댓글 — 페이지 끝까지.
// 쿼터: commentThreads.list 1u × (댓글 수 / 100)
export async function fetchAllVideoComments(input: {
  channelId: string;
  videoId: string;
}): Promise<YtCommentSummary[]> {
  const all: YtCommentSummary[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const page = await fetchVideoComments({
      channelId: input.channelId,
      videoId: input.videoId,
      pageToken,
    });
    all.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

// ─────────────── 댓글 (top-level) ───────────────

export type YtCommentSummary = {
  id: string;
  authorDisplayName: string;
  authorChannelId: string | null;
  textOriginal: string;
  likeCount: number;
  publishedAt: string;
  totalReplyCount: number;
};

export async function fetchVideoComments(input: {
  channelId: string;
  videoId: string;
  pageToken?: string;
}): Promise<{ items: YtCommentSummary[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    part: "snippet",
    videoId: input.videoId,
    maxResults: "100",
    order: "time",
    textFormat: "plainText",
  });
  if (input.pageToken) params.set("pageToken", input.pageToken);

  const res = await authedFetch(input.channelId, `/commentThreads?${params}`);
  const json = (await readJsonOrThrow(res, "commentThreads.list")) as {
    nextPageToken?: string;
    items?: Array<{
      snippet: {
        totalReplyCount: number;
        topLevelComment: {
          id: string;
          snippet: {
            authorDisplayName: string;
            authorChannelId?: { value: string };
            textOriginal: string;
            likeCount: number;
            publishedAt: string;
          };
        };
      };
    }>;
  };

  const items: YtCommentSummary[] = (json.items ?? []).map((it) => {
    const top = it.snippet.topLevelComment;
    return {
      id: top.id,
      authorDisplayName: top.snippet.authorDisplayName,
      authorChannelId: top.snippet.authorChannelId?.value ?? null,
      textOriginal: top.snippet.textOriginal,
      likeCount: top.snippet.likeCount,
      publishedAt: top.snippet.publishedAt,
      totalReplyCount: it.snippet.totalReplyCount,
    };
  });
  return { items, nextPageToken: json.nextPageToken };
}

// ─────────────── 답글 게시 ───────────────

export async function postReply(input: {
  channelId: string;            // 우리 시스템의 channel_id
  parentCommentId: string;      // YouTube top-level commentId
  text: string;
}): Promise<{ id: string }> {
  const body = {
    snippet: {
      parentId: input.parentCommentId,
      textOriginal: input.text,
    },
  };
  const res = await authedFetch(input.channelId, "/comments?part=snippet", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = (await readJsonOrThrow(res, "comments.insert")) as { id: string };
  return { id: json.id };
}
