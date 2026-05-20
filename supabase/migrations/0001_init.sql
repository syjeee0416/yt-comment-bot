-- yt-comment-bot · 초기 스키마
-- 실행: Supabase Dashboard → SQL Editor → 이 파일 내용 붙여넣고 Run

-- ─────────────────────────────────────────────
-- 1. 채널 (관리 단위. 보통 YouTube 채널 1개에 1:1)
-- ─────────────────────────────────────────────
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  dot_color text default '#a78bfa',
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- 2. YouTube OAuth 토큰 (channels:yt_accounts = 1:1)
-- ─────────────────────────────────────────────
create table if not exists yt_accounts (
  channel_id uuid primary key references channels(id) on delete cascade,
  yt_channel_id text not null,          -- UCxxxx (유튜브 채널 ID)
  yt_channel_title text not null,
  refresh_token text not null,          -- 장기 토큰 (DB에만 저장)
  access_token text,                    -- 만료 시 refresh로 갱신
  access_token_expires_at timestamptz,
  scope text not null default '',
  reply_persona text default '',        -- 채널별 답글 톤·페르소나 프롬프트
  reply_mode text not null default 'manual' check (reply_mode in ('manual','auto')),
  connected_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- 3. 동기화한 영상 (댓글 폴링 대상)
-- ─────────────────────────────────────────────
create table if not exists yt_videos (
  id text primary key,                  -- YouTube videoId
  channel_id uuid not null references channels(id) on delete cascade,
  title text not null,
  published_at timestamptz,
  comment_count integer default 0,
  last_synced_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists yt_videos_channel_id_idx
  on yt_videos(channel_id);

-- ─────────────────────────────────────────────
-- 4. 댓글 (top-level 우선)
-- ─────────────────────────────────────────────
create table if not exists yt_comments (
  id text primary key,                  -- YouTube commentId
  video_id text not null references yt_videos(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  author_display_name text not null,
  author_channel_id text,
  text_original text not null,
  like_count integer default 0,
  published_at timestamptz,
  is_reply boolean default false,
  parent_comment_id text,
  status text not null default 'new'
    check (status in ('new','drafted','approved','replied','skipped')),
  classification text,                  -- question | thanks | compliment | complaint | other | spam
  fetched_at timestamptz default now()
);

create index if not exists yt_comments_video_id_idx on yt_comments(video_id);
create index if not exists yt_comments_channel_id_status_idx
  on yt_comments(channel_id, status);

-- ─────────────────────────────────────────────
-- 5. 우리가 생성한 답글 (초안 → 승인 → 게시)
-- ─────────────────────────────────────────────
create table if not exists yt_replies (
  id uuid primary key default gen_random_uuid(),
  comment_id text not null references yt_comments(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  draft_text text not null,
  final_text text,
  yt_reply_id text,                     -- 게시 후 YouTube가 돌려준 commentId
  status text not null default 'draft'
    check (status in ('draft','posted','failed','discarded')),
  error_message text,
  posted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists yt_replies_comment_id_idx on yt_replies(comment_id);
create index if not exists yt_replies_channel_id_status_idx
  on yt_replies(channel_id, status);

-- ─────────────────────────────────────────────
-- 6. RLS — 개인 도구라 모두 open. 추후 auth 붙이면 정책 추가.
-- ─────────────────────────────────────────────
alter table channels enable row level security;
alter table yt_accounts enable row level security;
alter table yt_videos enable row level security;
alter table yt_comments enable row level security;
alter table yt_replies enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'allow_all' and tablename = 'channels') then
    create policy "allow_all" on channels for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'allow_all' and tablename = 'yt_accounts') then
    create policy "allow_all" on yt_accounts for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'allow_all' and tablename = 'yt_videos') then
    create policy "allow_all" on yt_videos for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'allow_all' and tablename = 'yt_comments') then
    create policy "allow_all" on yt_comments for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'allow_all' and tablename = 'yt_replies') then
    create policy "allow_all" on yt_replies for all using (true) with check (true);
  end if;
end $$;
