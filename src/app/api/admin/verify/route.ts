import { NextRequest, NextResponse } from "next/server";
import { requireAdminKey } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { key } = (await request.json()) as { key?: string };

  try {
    requireAdminKey(key ?? null);
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
