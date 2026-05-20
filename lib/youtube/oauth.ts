// YouTube OAuth 2.0 — fetch 기반. googleapis 라이브러리 의존 없이 처리.
//
// 흐름:
//  1) /api/yt-auth/start?channel_id=...  → 사용자를 Google 동의 화면으로 보냄
//  2) Google이 /api/yt-auth/callback?code=... 로 리다이렉트
//  3) code → access_token + refresh_token 교환
//  4) refresh_token은 DB에 저장 (한 번만 발급되므로 분실하면 재연결 필요)

export class YouTubeOAuthNotConfiguredError extends Error {
  constructor() {
    super(
      "YouTube OAuth 미설정. .env.local에 YOUTUBE_OAUTH_CLIENT_ID/SECRET을 추가하세요.",
    );
    this.name = "YouTubeOAuthNotConfiguredError";
  }
}

// 댓글 읽기·작성 + 채널 정보 읽기.
// youtube.force-ssl이 댓글 답글 게시(comments.insert)에 필요.
export const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

function getConfig() {
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  const redirectBase = process.env.YOUTUBE_OAUTH_REDIRECT_BASE ?? "http://localhost:3000";
  if (!clientId || !clientSecret) {
    throw new YouTubeOAuthNotConfiguredError();
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${redirectBase.replace(/\/$/, "")}/api/yt-auth/callback`,
  };
}

export function isYouTubeOAuthConfigured(): boolean {
  return Boolean(
    process.env.YOUTUBE_OAUTH_CLIENT_ID && process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
  );
}

export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    access_type: "offline",   // refresh_token 발급
    prompt: "consent",        // 재연결 시에도 refresh_token 재발급
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = getConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google 토큰 교환 실패 (${res.status}): ${body}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google 토큰 갱신 실패 (${res.status}): ${body}`);
  }
  return (await res.json()) as TokenResponse;
}
