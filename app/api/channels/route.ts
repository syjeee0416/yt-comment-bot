import { NextRequest, NextResponse } from "next/server";
import { createChannel, listChannels } from "@/lib/supabase/channels";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const channels = await listChannels();
    return NextResponse.json({ channels });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      name: string;
      description?: string;
      dotColor?: string;
    };
    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json({ error: "채널 이름이 필요합니다." }, { status: 400 });
    }
    const channel = await createChannel(body);
    return NextResponse.json({ channel });
  } catch (err) {
    return errorResponse(err);
  }
}
