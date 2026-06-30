import { NextRequest, NextResponse } from "next/server";
import { getSql, requireAdminKey } from "@/lib/db";
import {
  createGroupForDraw,
  createGroupFromAssignments,
  listSweepstakeGroups,
  updateGroupPrizeSettings,
  type PrizeSettingsInput
} from "@/lib/groups";
import { ensureBettingTables } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateGroupBody = {
  key?: string;
  mode?: "assign" | "draw";
  name?: string;
  slug?: string | null;
  teamsPerParticipant?: number | null;
  participants?: Array<{ name?: string; teams?: string[] }>;
  prizeSettings?: PrizeSettingsInput;
};

type UpdatePrizeBody = {
  key?: string;
  slug?: string | null;
  prizeSettings?: PrizeSettingsInput;
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
    const result =
      body.mode === "draw"
        ? await createGroupForDraw({
            sql,
            name: body.name ?? "",
            slug: body.slug ?? null,
            participants: (body.participants ?? []).map((participant) => ({
              name: participant.name ?? ""
            })),
            appUrl,
            teamsPerParticipant: body.teamsPerParticipant ?? null,
            prizeSettings: body.prizeSettings
          })
        : await createGroupFromAssignments({
            sql,
            name: body.name ?? "",
            slug: body.slug ?? null,
            assignments: (body.participants ?? []).map((participant) => ({
              name: participant.name ?? "",
              teams: participant.teams ?? []
            })),
            appUrl,
            allowDraws: false,
            teamsPerParticipant: body.teamsPerParticipant ?? null,
            prizeSettings: body.prizeSettings
          });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create group";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as UpdatePrizeBody;

  try {
    requireAdminKey(request.headers.get("x-admin-key") ?? body.key ?? null);
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  try {
    if (!body.slug) throw new Error("Group slug is required");
    if (!body.prizeSettings) throw new Error("Prize settings are required");

    const sql = getSql();
    await ensureBettingTables(sql);
    const group = await updateGroupPrizeSettings({
      sql,
      slug: body.slug,
      prizeSettings: body.prizeSettings
    });

    return NextResponse.json({ group });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update prize settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
