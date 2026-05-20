import { NextRequest, NextResponse } from "next/server";
import { deleteChannel } from "@/lib/supabase/channels";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    await deleteChannel(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
