"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Channel = {
  id: string;
  name: string;
  description: string;
  dot_color: string;
};

type YtAccount = {
  channel_id: string;
  yt_channel_id: string;
  yt_channel_title: string;
  scope: string;
  reply_persona: string;
  reply_mode: "manual" | "auto";
  connected_at: string;
  updated_at: string;
};

type Reply = {
  id: string;
  comment_id: string;
  draft_text: string;
  final_text: string | null;
  yt_reply_id: string | null;
  status: "draft" | "posted" | "failed" | "discarded";
  error_message: string | null;
  posted_at: string | null;
};

type Comment = {
  id: string;
  video_id: string;
  video_title: string;
  channel_id: string;
  author_display_name: string;
  text_original: string;
  like_count: number;
  published_at: string | null;
  status: "new" | "drafted" | "approved" | "replied" | "skipped";
  classification: string | null;
  latest_reply: Reply | null;
};

// 어떤 형태의 에러든 안전한 문자열로 변환. 객체일 때 [object Object] 노출 방지.
function safeMessage(v: unknown, fallback = "오류"): string {
  if (typeof v === "string" && v.length > 0) return v;
  if (v instanceof Error) return v.message;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    try {
      return JSON.stringify(v);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

// 답글 게시 실패 시 카드에 보일 메시지를 한국어로 친절하게 변환.
function prettifyReplyError(raw: string): string {
  if (/quotaExceeded|exceeded your.+quota/i.test(raw)) {
    return "YouTube 일일 쿼터 초과 — 한국시간 오후 4~5시쯤 리셋 후 다시 시도하세요.";
  }
  if (/spam/i.test(raw)) {
    return "유튜브가 스팸으로 판단했어요. 본문을 살짝 바꿔서 다시 시도해 보세요.";
  }
  if (/commentsDisabled|disabled comments/i.test(raw)) {
    return "이 영상의 댓글이 꺼져 있어요.";
  }
  if (/forbidden|\b403\b/i.test(raw)) {
    return "권한 부족 또는 영상 설정 문제 (비공개·연령 제한 등).";
  }
  if (/processingFailure|backend|\b500\b/i.test(raw)) {
    return "유튜브 일시 오류. 잠시 후 다시 시도해 주세요.";
  }
  return raw.length > 160 ? raw.slice(0, 160) + "..." : raw;
}

const DEFAULT_PERSONA_HINT = `예시:
당신은 사주·운세 채널 운영자입니다.
- 시청자에게 따뜻하고 친근하게 응답합니다.
- 사주적 표현은 절대로 단정 짓지 않고 "참고용"임을 자연스럽게 알립니다.
- 1~2문장, 짧게. 이모지 1개까지.`;

export default function CommentsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string>("");
  const [accounts, setAccounts] = useState<YtAccount[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [totalWaiting, setTotalWaiting] = useState<number>(0);
  const [bulk, setBulk] = useState<{
    type: "draft" | "post";
    current: number;
    total: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [maxVideos, setMaxVideos] = useState(5);
  const [editPersona, setEditPersona] = useState("");
  const [editedDrafts, setEditedDrafts] = useState<Record<string, string>>({});
  const [newChannelName, setNewChannelName] = useState("");

  const account = useMemo(
    () => accounts.find((a) => a.channel_id === channelId) ?? null,
    [accounts, channelId],
  );

  // URL 쿼리: OAuth 콜백 결과 표시
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setBanner({ kind: "ok", text: "구글 계정이 연결됐어요." });
    } else if (params.get("auth_error")) {
      setBanner({ kind: "warn", text: `OAuth 오류: ${params.get("auth_error")}` });
    }
    const q = params.get("channel_id");
    if (q) setChannelId(q);
  }, []);

  const loadChannelsAndAccounts = useCallback(async () => {
    try {
      const [chRes, acRes] = await Promise.all([
        fetch("/api/channels"),
        fetch("/api/yt-accounts"),
      ]);
      if (chRes.ok) {
        const chData = await chRes.json();
        const list: Channel[] = chData.channels ?? [];
        setChannels(list);
        setChannelId((prev) => prev || list[0]?.id || "");
      } else {
        const data = await chRes.json().catch(() => ({}));
        setBanner({
          kind: "warn",
          text: safeMessage(
            data.error,
            "채널 로드 실패 — Supabase 설정을 확인하세요.",
          ),
        });
      }
      if (acRes.ok) {
        const acData = await acRes.json();
        setAccounts(acData.items ?? []);
      }
    } catch (err) {
      setBanner({ kind: "warn", text: safeMessage(err, "요청 실패") });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannelsAndAccounts();
  }, [loadChannelsAndAccounts]);

  useEffect(() => {
    setEditPersona(account?.reply_persona ?? "");
  }, [account?.channel_id, account?.reply_persona]);

  const loadComments = useCallback(async () => {
    if (!channelId) return;
    try {
      const res = await fetch(`/api/yt-comments?channel_id=${channelId}`);
      const data = await res.json();
      if (res.ok) {
        setComments(data.items ?? []);
        setTotalWaiting(Number(data.total ?? data.items?.length ?? 0));
      } else
        setBanner({
          kind: "warn",
          text: safeMessage(data.error, "댓글 로드 실패"),
        });
    } catch (err) {
      setBanner({ kind: "warn", text: safeMessage(err, "요청 실패") });
    }
  }, [channelId]);

  useEffect(() => {
    if (channelId && account) loadComments();
    else {
      setComments([]);
      setTotalWaiting(0);
    }
  }, [channelId, account, loadComments]);

  const addChannel = async () => {
    const name = newChannelName.trim();
    if (!name) return;
    setBusy("addChannel");
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (res.ok) {
        setChannels((prev) => [...prev, data.channel]);
        setChannelId(data.channel.id);
        setNewChannelName("");
        setBanner({ kind: "ok", text: `채널 "${name}" 추가됐어요.` });
      } else {
        setBanner({ kind: "warn", text: safeMessage(data.error, "추가 실패") });
      }
    } finally {
      setBusy(null);
    }
  };

  const connect = () => {
    if (!channelId) return;
    window.location.href = `/api/yt-auth/start?channel_id=${channelId}`;
  };

  const disconnect = async () => {
    if (!channelId) return;
    if (!confirm("이 채널의 유튜브 계정 연결을 해제할까요?")) return;
    setBusy("disconnect");
    try {
      await fetch(`/api/yt-accounts?channel_id=${channelId}`, { method: "DELETE" });
      setAccounts((prev) => prev.filter((a) => a.channel_id !== channelId));
      setComments([]);
      setBanner({ kind: "ok", text: "연결을 해제했습니다." });
    } finally {
      setBusy(null);
    }
  };

  const savePersona = async () => {
    if (!channelId) return;
    setBusy("persona");
    try {
      const res = await fetch("/api/yt-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, replyPersona: editPersona, replyMode: "manual" }),
      });
      if (res.ok) {
        setAccounts((prev) =>
          prev.map((a) =>
            a.channel_id === channelId ? { ...a, reply_persona: editPersona } : a,
          ),
        );
        setBanner({ kind: "ok", text: "답글 페르소나를 저장했어요." });
      } else {
        const data = await res.json();
        setBanner({ kind: "warn", text: safeMessage(data.error, "저장 실패") });
      }
    } finally {
      setBusy(null);
    }
  };

  const sync = async (mode: "recent" | "all" = "recent") => {
    if (!channelId) return;
    if (mode === "all") {
      if (
        !confirm(
          "전체 수집은 채널의 모든 영상의 모든 댓글을 한 번에 가져옵니다.\n" +
            "영상이 많은 채널은 1~5분 걸릴 수 있고 YouTube API 쿼터를 더 소모해요.\n계속할까요?",
        )
      )
        return;
    }
    setBusy(`sync:${mode}`);
    try {
      const res = await fetch("/api/yt-comments/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, maxVideos, mode }),
      });
      const data = await res.json();
      if (res.ok) {
        const skipped = Array.isArray(data.skipped) ? data.skipped : [];
        const own = Number(data.ownChannelCommentsCleared ?? 0);
        const already = Number(data.alreadyRepliedCleared ?? 0);
        const base = `영상 ${data.videos}개 · 댓글 ${data.comments}개 가져왔어요.`;
        const tailSkip =
          skipped.length > 0
            ? ` (건너뛴 영상 ${skipped.length}개: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "..." : ""})`
            : "";
        const tailOwn = own > 0 ? ` · 본인 댓글 ${own}개 정리됨` : "";
        const tailAlready =
          already > 0 ? ` · 이미 답글 단 댓글 ${already}개 정리됨` : "";
        setBanner({ kind: "ok", text: base + tailSkip + tailOwn + tailAlready });
        await loadComments();
      } else {
        setBanner({ kind: "warn", text: safeMessage(data.error, "동기화 실패") });
      }
    } finally {
      setBusy(null);
    }
  };

  const draft = async (commentId: string, regenerate = false) => {
    setBusy(`draft:${commentId}`);
    try {
      const res = await fetch("/api/yt-comments/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, regenerate }),
      });
      const data = await res.json();
      if (!res.ok) {
        const raw = safeMessage(data.error, "초안 생성 실패");
        let nice = raw;
        if (/503|UNAVAILABLE|overloaded|high demand/i.test(raw)) {
          nice = "Gemini가 일시적으로 바빠요. 1~2분 후 다시 눌러주세요.";
        } else if (/429|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
          nice = "Gemini 일일 한도 도달. 24시간 후 또는 결제 등급 업그레이드 필요.";
        }
        setBanner({ kind: "warn", text: nice });
        return;
      }
      if (data.skipped) {
        setBanner({
          kind: "ok",
          text: `스팸·부적절 댓글로 분류되어 건너뜀 (${data.classification}).`,
        });
      }
      await loadComments();
    } finally {
      setBusy(null);
    }
  };

  // ─── 일괄 처리 ───────────────────────────────────────────
  const bulkAbortRef = useRef(false);

  const stopBulk = () => {
    bulkAbortRef.current = true;
  };

  const bulkDraft = async () => {
    const targets = comments.filter((c) => c.status === "new");
    if (targets.length === 0) {
      setBanner({ kind: "ok", text: "초안 생성할 새 댓글이 없어요." });
      return;
    }
    if (
      !confirm(
        `${targets.length}개 댓글에 답글 초안을 자동 생성합니다.\n` +
          `한 건당 5~10초 정도 걸리고 중간에 중지할 수 있어요. 계속할까요?`,
      )
    )
      return;
    bulkAbortRef.current = false;
    setBulk({ type: "draft", current: 0, total: targets.length });
    let ok = 0,
      skip = 0,
      err = 0;
    for (let i = 0; i < targets.length; i++) {
      if (bulkAbortRef.current) break;
      try {
        const res = await fetch("/api/yt-comments/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId: targets[i].id }),
        });
        const data = await res.json();
        if (res.ok) {
          if (data.skipped) skip++;
          else ok++;
        } else err++;
      } catch {
        err++;
      }
      setBulk({ type: "draft", current: i + 1, total: targets.length });
    }
    const stopped = bulkAbortRef.current;
    setBulk(null);
    await loadComments();
    setBanner({
      kind: "ok",
      text:
        (stopped ? "중지됨. " : "") +
        `초안 생성 ${ok}개 · 스팸 건너뜀 ${skip}개 · 실패 ${err}개`,
    });
  };

  const bulkPost = async () => {
    const targets = comments.filter(
      (c) => c.latest_reply && c.latest_reply.status === "draft",
    );
    if (targets.length === 0) {
      setBanner({ kind: "ok", text: "게시할 답글 초안이 없어요." });
      return;
    }
    const minutes = Math.ceil((targets.length * 2) / 60);
    if (
      !confirm(
        `⚠️ 검토 없이 ${targets.length}개 답글을 유튜브에 자동 게시합니다.\n\n` +
          `톤이 마음에 안 드는 답글도 그대로 올라가니, 시간이 있으면 검토 후 게시를 권장해요.\n\n` +
          `한 건당 2초 간격 · 약 ${minutes}분 소요 · 중간 중지 가능.\n\n계속할까요?`,
      )
    )
      return;
    bulkAbortRef.current = false;
    setBulk({ type: "post", current: 0, total: targets.length });
    let ok = 0,
      err = 0;
    let quotaHit = false;
    for (let i = 0; i < targets.length; i++) {
      if (bulkAbortRef.current) break;
      const reply = targets[i].latest_reply!;
      const finalText = (editedDrafts[reply.id] ?? reply.draft_text).trim();
      if (!finalText) {
        err++;
      } else {
        try {
          const res = await fetch("/api/yt-comments/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ replyId: reply.id, finalText }),
          });
          if (res.ok) ok++;
          else {
            err++;
            // 쿼터 초과면 더 시도해도 무의미. 즉시 중단.
            const data = await res.json().catch(() => ({}));
            const errMsg = safeMessage(data.error, "");
            if (/quotaExceeded|exceeded your.+quota/i.test(errMsg)) {
              quotaHit = true;
              bulkAbortRef.current = true;
            }
          }
        } catch {
          err++;
        }
      }
      setBulk({ type: "post", current: i + 1, total: targets.length });
      // YouTube spam 신호 회피를 위해 2초 간격
      if (i < targets.length - 1 && !bulkAbortRef.current) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const stopped = bulkAbortRef.current && !quotaHit;
    setBulk(null);
    await loadComments();
    if (quotaHit) {
      setBanner({
        kind: "warn",
        text: `YouTube 일일 쿼터 초과 — 게시 ${ok}개 완료, 미게시 ${targets.length - ok - err + 1}개는 한국시간 오후 4~5시 리셋 후 "일괄 게시" 다시 누르면 자동 처리됩니다.`,
      });
    } else {
      setBanner({
        kind: "ok",
        text: (stopped ? "중지됨. " : "") + `게시 ${ok}개 · 실패 ${err}개`,
      });
    }
  };

  const post = async (reply: Reply) => {
    const finalText = editedDrafts[reply.id] ?? reply.draft_text;
    if (!finalText.trim()) {
      setBanner({ kind: "warn", text: "답글 본문이 비었습니다." });
      return;
    }
    if (!confirm("이 답글을 유튜브에 게시할까요?\n\n" + finalText)) return;
    setBusy(`post:${reply.id}`);
    try {
      const res = await fetch("/api/yt-comments/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyId: reply.id, finalText }),
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ kind: "ok", text: "답글을 게시했어요." });
        await loadComments();
      } else {
        setBanner({ kind: "warn", text: safeMessage(data.error, "게시 실패") });
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-12 py-12 text-[var(--color-subtle)]">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-12 py-12">
      <div className="text-[13px] uppercase tracking-[0.15em] text-[var(--color-accent-text)] font-bold mb-3">
        yt-comment-bot
      </div>
      <h1 className="brand-text text-4xl font-extrabold leading-[1.1] tracking-tight mb-3">
        유튜브 댓글 답글 자동화
      </h1>
      <p className="text-[var(--color-muted)] text-sm mb-8 max-w-2xl">
        구글 계정 연결 → 최근 영상 댓글 수집 → Gemini가 초안 생성 → 검토 후 게시.
        풀자동 모드는 톤 안정화 후 도입할게요.
      </p>

      {/* 채널 선택 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => setChannelId(ch.id)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              channelId === ch.id
                ? "border-[rgba(167,139,250,0.6)] bg-[rgba(167,139,250,0.1)]"
                : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]"
            }`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
              style={{ background: ch.dot_color }}
            />
            {ch.name}
            {accounts.find((a) => a.channel_id === ch.id) ? " · 연결됨" : ""}
          </button>
        ))}
      </div>

      {/* 채널 추가 */}
      <div className="flex items-center gap-2 mb-6">
        <input
          value={newChannelName}
          onChange={(e) => setNewChannelName(e.target.value)}
          placeholder="새 채널 이름 (예: 운세오늘)"
          className="text-sm rounded-md bg-[var(--color-card)] border border-[var(--color-line)] px-3 py-1.5 flex-1 max-w-xs"
        />
        <button
          onClick={addChannel}
          disabled={busy === "addChannel" || !newChannelName.trim()}
          className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-line)] hover:border-[var(--color-line-strong)] disabled:opacity-40"
        >
          + 추가
        </button>
      </div>

      {/* 배너 */}
      {banner && (
        <div
          className={`rounded-xl px-4 py-3 text-sm mb-6 border ${
            banner.kind === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200"
              : "bg-amber-500/10 border-amber-500/20 text-amber-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* 채널이 아예 없는 경우 */}
      {channels.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--color-line)] bg-[var(--color-card)] p-6 mb-6 text-sm text-[var(--color-muted)]">
          채널이 없어요. 위 입력창에서 채널 하나 추가하고 시작하세요.
          <div className="mt-2 text-xs text-[var(--color-subtle)]">
            (Supabase 미설정 상태면 채널 추가도 안 됩니다. README 참고)
          </div>
        </div>
      )}

      {/* 계정 카드 */}
      {channelId && !account && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-6 mb-8">
          <div className="font-semibold mb-1">아직 구글 계정이 연결되지 않았어요</div>
          <div className="text-sm text-[var(--color-muted)] mb-4">
            선택한 채널에 답글을 달 유튜브 계정을 연결하세요. OAuth로 한 번만 동의하면
            refresh token이 저장돼 이후엔 재로그인 없이 자동 갱신됩니다.
          </div>
          <button
            onClick={connect}
            className="px-4 py-2 rounded-lg bg-[rgba(167,139,250,0.2)] border border-[rgba(167,139,250,0.4)] text-sm hover:bg-[rgba(167,139,250,0.3)] transition-colors"
          >
            구글 계정으로 연결
          </button>
        </div>
      )}

      {account && (
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-6 mb-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="text-xs text-[var(--color-subtle)] uppercase tracking-wider mb-1">
                연결된 YouTube 채널
              </div>
              <div className="font-semibold">{account.yt_channel_title}</div>
              <div className="text-xs text-[var(--color-subtle)]">{account.yt_channel_id}</div>
            </div>
            <button
              onClick={disconnect}
              disabled={busy === "disconnect"}
              className="text-xs text-[var(--color-subtle)] hover:text-amber-300"
            >
              연결 해제
            </button>
          </div>

          <div className="mb-4">
            <label className="block text-xs uppercase tracking-wider text-[var(--color-subtle)] mb-2">
              답글 페르소나 (선택)
            </label>
            <textarea
              value={editPersona}
              onChange={(e) => setEditPersona(e.target.value)}
              placeholder={DEFAULT_PERSONA_HINT}
              rows={5}
              className="w-full text-sm rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] px-3 py-2 font-mono"
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={savePersona}
                disabled={busy === "persona"}
                className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-line)] hover:border-[var(--color-line-strong)]"
              >
                {busy === "persona" ? "저장 중..." : "페르소나 저장"}
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--color-line)] space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-[var(--color-muted)]">최근 영상</label>
              <input
                type="number"
                min={1}
                max={20}
                value={maxVideos}
                onChange={(e) => setMaxVideos(Number(e.target.value))}
                className="w-16 text-sm rounded-md bg-[var(--color-bg)] border border-[var(--color-line)] px-2 py-1"
              />
              <span className="text-xs text-[var(--color-muted)]">
                개에서 댓글 가져오기 (빠른 폴링)
              </span>
              <button
                onClick={() => sync("recent")}
                disabled={busy?.startsWith("sync:")}
                className="ml-auto px-3 py-1.5 rounded-lg bg-[rgba(167,139,250,0.2)] border border-[rgba(167,139,250,0.4)] text-sm hover:bg-[rgba(167,139,250,0.3)] disabled:opacity-40"
              >
                {busy === "sync:recent" ? "가져오는 중..." : "댓글 동기화"}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--color-subtle)]">
                또는 채널 전체 영상에서 답글 안 단 모든 댓글 한 번에 수집 (오래된 것부터 보임)
              </span>
              <button
                onClick={() => sync("all")}
                disabled={busy?.startsWith("sync:")}
                className="ml-auto px-3 py-1.5 rounded-lg border border-[var(--color-line)] hover:border-[var(--color-line-strong)] text-sm disabled:opacity-40"
              >
                {busy === "sync:all" ? "전체 수집 중..." : "전체 수집"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 댓글 리스트 */}
      {account && (
        <>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="text-xs uppercase tracking-wider text-[var(--color-subtle)]">
              답글 대기 ({totalWaiting}
              {totalWaiting > comments.length ? ` · 화면 ${comments.length}` : ""})
            </div>
            {!bulk ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={bulkDraft}
                  disabled={comments.filter((c) => c.status === "new").length === 0}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-line)] hover:border-[var(--color-line-strong)] disabled:opacity-40"
                  title="화면의 새 댓글 전부에 답글 초안 자동 생성"
                >
                  일괄 초안 생성 (
                  {comments.filter((c) => c.status === "new").length})
                </button>
                <button
                  onClick={bulkPost}
                  disabled={
                    comments.filter(
                      (c) => c.latest_reply && c.latest_reply.status === "draft",
                    ).length === 0
                  }
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40"
                  title="검토 없이 초안들을 유튜브에 일괄 게시 (2초 간격)"
                >
                  일괄 게시 (
                  {
                    comments.filter(
                      (c) => c.latest_reply && c.latest_reply.status === "draft",
                    ).length
                  }
                  )
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="text-xs text-[var(--color-muted)]">
                  {bulk.type === "draft" ? "초안 생성 중" : "게시 중"} ·{" "}
                  {bulk.current}/{bulk.total}
                </div>
                <div className="w-32 h-1.5 rounded-full bg-[var(--color-line)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-accent-text)] transition-all"
                    style={{
                      width: `${Math.round((bulk.current / bulk.total) * 100)}%`,
                    }}
                  />
                </div>
                <button
                  onClick={stopBulk}
                  className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                >
                  중지
                </button>
              </div>
            )}
          </div>
          {comments.length === 0 ? (
            <div className="text-sm text-[var(--color-muted)] rounded-xl border border-dashed border-[var(--color-line)] px-5 py-8 text-center">
              아직 가져온 댓글이 없어요. 위의 &quot;댓글 동기화&quot;를 눌러주세요.
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((c) => {
                const r = c.latest_reply;
                const draftValue = r ? (editedDrafts[r.id] ?? r.final_text ?? r.draft_text) : "";
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="text-xs text-[var(--color-subtle)] truncate flex-1">
                        🎬 {c.video_title}
                      </div>
                      <StatusPill status={c.status} classification={c.classification} />
                    </div>

                    <div className="text-sm mb-1 flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-[var(--color-accent-text)]">
                        {c.author_display_name}
                      </span>
                      <span className="text-[var(--color-subtle)] text-xs">
                        ♥ {c.like_count}
                      </span>
                      <a
                        href={`https://www.youtube.com/watch?v=${c.video_id}&lc=${c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--color-accent-chip)] hover:underline ml-auto"
                        title="유튜브에서 이 댓글로 바로 이동 — 거기서 좋아요(👍)·하트(❤️) 누르세요"
                      >
                        유튜브에서 보기 ↗
                      </a>
                    </div>
                    <div className="text-sm whitespace-pre-wrap mb-3">{c.text_original}</div>

                    {!r ? (
                      <div className="flex justify-end">
                        <button
                          onClick={() => draft(c.id)}
                          disabled={busy === `draft:${c.id}`}
                          className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-line)] hover:border-[var(--color-line-strong)]"
                        >
                          {busy === `draft:${c.id}` ? "생성 중..." : "답글 초안 생성"}
                        </button>
                      </div>
                    ) : (
                      <div className="border-t border-[var(--color-line)] pt-3 mt-1">
                        <div className="text-xs text-[var(--color-subtle)] mb-2">답글 초안</div>
                        <textarea
                          value={draftValue}
                          onChange={(e) =>
                            setEditedDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                          rows={3}
                          disabled={r.status === "posted"}
                          className="w-full text-sm rounded-lg bg-[var(--color-bg)] border border-[var(--color-line)] px-3 py-2"
                        />
                        {r.error_message && (
                          <div className="text-xs text-amber-300 mt-2">
                            ⚠️ {prettifyReplyError(r.error_message)}
                          </div>
                        )}
                        <div className="flex gap-2 justify-end mt-2">
                          <button
                            onClick={() => draft(c.id, true)}
                            disabled={busy === `draft:${c.id}` || r.status === "posted"}
                            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--color-line)] hover:border-[var(--color-line-strong)]"
                          >
                            다시 생성
                          </button>
                          <button
                            onClick={() => post(r)}
                            disabled={busy === `post:${r.id}` || r.status === "posted"}
                            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30"
                          >
                            {r.status === "posted"
                              ? "게시됨"
                              : busy === `post:${r.id}`
                                ? "게시 중..."
                                : "유튜브에 게시"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusPill({
  status,
  classification,
}: {
  status: Comment["status"];
  classification: string | null;
}) {
  const map: Record<Comment["status"], { label: string; cls: string }> = {
    new: { label: "신규", cls: "bg-sky-500/15 text-sky-200 border-sky-500/30" },
    drafted: {
      label: "초안",
      cls: "bg-violet-500/15 text-violet-200 border-violet-500/30",
    },
    approved: {
      label: "승인",
      cls: "bg-amber-500/15 text-amber-200 border-amber-500/30",
    },
    replied: {
      label: "게시됨",
      cls: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
    },
    skipped: {
      label: "건너뜀",
      cls: "bg-stone-500/15 text-stone-200 border-stone-500/30",
    },
  };
  const { label, cls } = map[status];
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cls} whitespace-nowrap`}>
      {label}
      {classification ? ` · ${classification}` : ""}
    </span>
  );
}
