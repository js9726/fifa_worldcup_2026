import { NextRequest, NextResponse } from "next/server";
import { getAppState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const state = await getAppState(token);

  if (token && !state.participant) {
    return NextResponse.json({ error: "Invite link not recognised" }, { status: 404 });
  }

  return NextResponse.json(state);
}
