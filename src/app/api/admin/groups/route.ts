import { NextRequest, NextResponse } from "next/server";
import { getSql, requireAdminKey } from "@/lib/db";
import { createGroupFromAssignments, listSweepstakeGroups, type PoolAssignment } from "@/lib/groups";
import { ensureBettingTables } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateGroupBody = {
  key?: string;
  name?: string;
  slug?: string | null;
  teamsPerParticipant?: number | null;
  participants?: PoolAssignment[];
};

export async function GET(request: NextRequest) {
  try {
    requireAdminKey(request.headers.get("x-admin-key"));
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  const sql = getSql();
  await ensureBettingTables(sql);
  const groups = await listSweepstakeGroups(sql);
  return NextResponse.json({ groups });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateGroupBody;

  try {
    requireAdminKey(request.headers.get("x-admin-key") ?? body.key ?? null);
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/+$/, "");

  try {
    const sql = getSql();
    await ensureBettingTables(sql);
    const result = await createGroupFromAssignments({
      sql,
      name: body.name ?? "",
      slug: body.slug ?? null,
      assignments: body.participants ?? [],
      appUrl,
      allowDraws: false,
      teamsPerParticipant: body.teamsPerParticipant ?? null
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create group";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
