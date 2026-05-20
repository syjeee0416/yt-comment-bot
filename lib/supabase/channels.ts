// 채널 = 댓글 답글을 관리할 단위. 보통 YouTube 채널 1개에 1:1.
// 멀티채널 양산 컨텍스트에서는 채널마다 다른 페르소나·다른 구글 계정 연결.
import { getSupabaseAdmin } from "./server";

export type ChannelRow = {
  id: string;
  name: string;
  description: string;
  dot_color: string;
};

export async function listChannels(): Promise<ChannelRow[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("channels")
    .select("id, name, description, dot_color")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createChannel(input: {
  name: string;
  description?: string;
  dotColor?: string;
}): Promise<ChannelRow> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("channels")
    .insert({
      name: input.name,
      description: input.description ?? "",
      dot_color: input.dotColor ?? "#a78bfa",
    })
    .select("id, name, description, dot_color")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteChannel(id: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("channels").delete().eq("id", id);
  if (error) throw error;
}
