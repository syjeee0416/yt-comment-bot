import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/youtube/oauth";
import { fetchOwnChannel } from "@/lib/youtube/client";
import { upsertYtAccount } from "@/lib/youtube/repo";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";
// OAuth 토큰 교환 + YouTube channels.list = 짧지만 외부 호출 2번이라 여유.
export const maxDuration = 20;

// Google → 우리 콜백: ?code=...&state=<base64url JSON>
export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get("code");
    const stateRaw = req.nextUrl.searchParams.get("state");
    const errorParam = req.nextUrl.searchParams.get("error");

    if (errorParam) {
      return NextResponse.redirect(
        new URL(`/?auth_error=${encodeURIComponent(errorParam)}`, req.url),
      );
    }
    if (!code || !stateRaw) {
      return NextResponse.json({ error: "code/state 누락" }, { status: 400 });
    }

    let channelId: string;
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      channelId = parsed.channelId;
    } catch {
      return NextResponse.json({ error: "state 디코딩 실패" }, { status: 400 });
    }
    if (!channelId) {
      return NextResponse.json({ error: "state에 channelId 없음" }, { status: 400 });
    }

    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // prompt=consent를 줬는데도 빠지면 사용자가 이미 동의했고 동일 클라이언트라
      // refresh_token이 누락되는 케이스. Google 계정에서 앱 권한 제거 후 재시도 안내.
      return NextResponse.redirect(
        new URL("/?auth_error=no_refresh_token", req.url),
      );
    }

    const info = await fetchOwnChannel(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await upsertYtAccount({
      channelId,
      ytChannelId: info.id,
      ytChannelTitle: info.title,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope,
    });

    return NextResponse.redirect(new URL(`/?connected=1&channel_id=${channelId}`, req.url));
  } catch (err) {
    return errorResponse(err);
  }
}
