import { NextRequest, NextResponse } from "next/server";
import { getSql, requireAdminKey } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    key?: string;
    country?: string;
    finalRank?: number | null;
    eliminatedStage?: string | null;
    resultNote?: string | null;
    homeScore?: number | null;
    awayScore?: number | null;
    fixtureId?: number | null;
  };

  try {
    requireAdminKey(body.key ?? null);
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  const sql = getSql();

  if (body.country) {
    await sql`
      update teams
      set
        final_rank = ${body.finalRank ?? null},
        eliminated_stage = ${body.eliminatedStage || null},
        result_note = ${body.resultNote || null},
        updated_at = now()
      where country = ${body.country}
    `;
  }

  if (body.fixtureId) {
    await sql`
      update fixtures
      set home_score = ${body.homeScore ?? null},
          away_score = ${body.awayScore ?? null}
      where id = ${body.fixtureId}
    `;
  }

  return NextResponse.json({ ok: true });
}
