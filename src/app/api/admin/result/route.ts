import { NextRequest, NextResponse } from "next/server";
import { getSql, requireAdminKey } from "@/lib/db";
import { ensureFixtureScoreColumns } from "@/lib/state";

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
    regularHomeScore?: number | null;
    regularAwayScore?: number | null;
    extraHomeScore?: number | null;
    extraAwayScore?: number | null;
    scoreDuration?: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT" | null;
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
    await ensureFixtureScoreColumns(sql);

    await sql`
      update fixtures
      set home_score = ${body.homeScore ?? null},
          away_score = ${body.awayScore ?? null},
          regular_home_score = coalesce(${body.regularHomeScore ?? null}, regular_home_score),
          regular_away_score = coalesce(${body.regularAwayScore ?? null}, regular_away_score),
          extra_home_score = case
            when ${body.scoreDuration ?? null} = 'REGULAR' then null
            else coalesce(${body.extraHomeScore ?? null}, extra_home_score)
          end,
          extra_away_score = case
            when ${body.scoreDuration ?? null} = 'REGULAR' then null
            else coalesce(${body.extraAwayScore ?? null}, extra_away_score)
          end,
          score_duration = coalesce(${body.scoreDuration ?? null}, score_duration)
      where id = ${body.fixtureId}
    `;
  }

  return NextResponse.json({ ok: true });
}
