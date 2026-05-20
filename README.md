# yt-comment-bot

YouTube 댓글에 답글을 자동으로 다는 도구. 댓글 수집 → Gemini가 채널 페르소나에 맞춰 답글 초안 생성 → 본인이 검토·편집 후 게시 → DB에 게시 이력 저장.

채널 N개를 동시에 관리할 수 있고, 채널마다 다른 구글 계정·다른 답글 톤(페르소나)을 붙일 수 있다. 톤이 안정되면 풀자동 모드로 전환 예정.

## 일회성 셋업

### 1) 의존성 설치

```sh
npm install
```

### 2) Supabase

[Supabase Dashboard](https://supabase.com/dashboard)에서 새 프로젝트 만든 뒤:

- Project Settings → API에서 URL과 키 복사
- SQL Editor에서 `supabase/migrations/0001_init.sql` 내용 붙여넣고 Run

### 3) Gemini API

[https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)에서 API 키 발급.

### 4) YouTube OAuth 클라이언트

[Google Cloud Console](https://console.cloud.google.com)에서:

1. **APIs & Services → Library** → "YouTube Data API v3" Enable
2. **OAuth consent screen**
   - User type: External
   - App name 입력, 본인 이메일 등록
   - **Test users**에 답글을 달 본인 구글 계정 추가 (publish 안 해도 됨)
3. **Credentials → Create credentials → OAuth client ID**
   - Application type: Web application
   - **Authorized redirect URIs**에 `http://localhost:3000/api/yt-auth/callback` 등록
   - 배포 후에는 `https://<도메인>/api/yt-auth/callback` 도 추가
4. 발급된 Client ID / Secret 복사

### 5) `.env.local` 작성

`.env.local.example`을 복사해서 `.env.local` 만들고 위에서 모은 값 채우기:

```
GEMINI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
YOUTUBE_OAUTH_CLIENT_ID=
YOUTUBE_OAUTH_CLIENT_SECRET=
YOUTUBE_OAUTH_REDIRECT_BASE=http://localhost:3000
```

### 6) 실행

```sh
npm run dev
```

[http://localhost:3000](http://localhost:3000) 접속 → 채널 추가 → "구글 계정으로 연결" → 동의 → 끝.

## 일상 사용

1. **댓글 동기화** 버튼: 최근 영상 N개의 top-level 댓글을 가져옴 (쿼터: `1 + N` units)
2. 댓글마다 **답글 초안 생성** — Gemini가 페르소나에 맞춰 작성, 스팸은 자동으로 `skipped` 분류
3. 초안을 그 자리에서 편집 → **유튜브에 게시**
4. 게시된 답글은 `replied` 상태로 굳어 다시 안 잡힘

### YouTube API 쿼터

기본 일일 쿼터 10,000 units.
- `commentThreads.list`: 1 unit per video
- `playlistItems.list`: 1 unit per sync
- `comments.insert` (답글 게시): **50 units** per reply

→ 하루 게시 답글 ~180개가 한계. 그 이상은 Google Cloud Console에서 쿼터 증액 신청.

## 의도적으로 나중에

- 풀자동 모드 (UI에 토글만 있고 동작은 manual만 — 톤 안정화 후 활성화)
- Vercel Cron 폴링 (지금은 수동 "댓글 동기화" 버튼)
- top-level 댓글의 reply 트리 따라가기 (지금은 top-level만)
- 한 영상 댓글이 100개 넘는 케이스 페이지네이션 (지금은 한 페이지만, 다음 sync에서 신규만 잡힘)
