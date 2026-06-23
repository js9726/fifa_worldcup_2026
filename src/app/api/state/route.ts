import { NextRequest, NextResponse } from "next/server";
import { getAppState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
  }

  const state = await getAppState({ inviteToken: token });

  if (!state.participant) {
    return NextResponse.json({ error: "Invite link not recognised" }, { status: 404 });
  }

  return NextResponse.json(state);
}
