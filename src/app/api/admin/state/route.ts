import { NextRequest, NextResponse } from "next/server";
import { requireAdminKey } from "@/lib/db";
import { getAppState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireAdminKey(request.headers.get("x-admin-key"));
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  const groupSlug = request.nextUrl.searchParams.get("group");
  if (!groupSlug) {
    return NextResponse.json({ error: "Group is required" }, { status: 400 });
  }

  const state = await getAppState({ groupSlug });
  if (!state.group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  return NextResponse.json(state);
}
