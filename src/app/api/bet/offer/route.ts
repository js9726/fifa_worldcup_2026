import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureBettingTables } from "@/lib/state";
import { ensureGroupSchema } from "@/lib/groups";
import type { BetSettlementBasis } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETS = new Set(["winner", "asian_handicap"]);
const WINNER_SETTLEMENT_BASES = new Set(["advance_winner", "ninety_minutes", "after_extra_time"]);
const AH_SETTLEMENT_BASES = new Set(["ninety_minutes", "extra_time"]);

type OfferBody = {
  token?: string;
  fixtureId?: number;
  market?: string;
  backedCountry?: string;
  settlementBasis?: string;
  handicapLine?: number | null;
  maxAmount?: number;
  note?: string | null;
};

function formatLine(line: number) {
  if (line === 0) return "0";
  return line > 0 ? `+${line}` : `${line}`;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as OfferBody;
  const { token } = body;

  if (!token) {
    return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.fixtureId)) {
    return NextResponse.json({ error: "A fixture is required" }, { status: 400 });
  }
  if (!MARKETS.has(body.market ?? "")) {
    return NextResponse.json({ error: "Unknown betting market" }, { status: 400 });
  }
  if (!body.backedCountry) {
    return NextResponse.json({ error: "Pick the team you are backing" }, { status: 400 });
  }

  const market = body.market as "winner" | "asian_handicap";
  const requestedSettlementBasis = body.settlementBasis;
  const allowedSettlementBases = market === "asian_handicap" ? AH_SETTLEMENT_BASES : WINNER_SETTLEMENT_BASES;
  if (!allowedSettlementBases.has(requestedSettlementBasis ?? "")) {
    return NextResponse.json({ error: "Unknown settlement basis" }, { status: 400 });
  }
  const settlementBasis = requestedSettlementBasis as BetSettlementBasis;

  const maxAmount = Number(body.maxAmount);

  if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
    return NextResponse.json({ error: "Offer stake must be greater than zero" }, { status: 400 });
  }

  let handicapLine: number | null = null;
  if (market === "asian_handicap") {
    handicapLine = Number(body.handicapLine);
    if (!Number.isFinite(handicapLine) || Math.abs(handicapLine) > 5 || (handicapLine * 4) % 1 !== 0) {
      return NextResponse.json(
        { error: "Handicap line must be a 0.25 step between -5 and +5" },
        { status: 400 }
      );
    }
  }

  const note = body.note ? String(body.note).trim().slice(0, 280) || null : null;

  const sql = getSql();

  try {
    await ensureBettingTables(sql);
    await ensureGroupSchema(sql);

    const offer = await sql.begin(async (tx) => {
      const participantRows = (await tx`
        select id, name, pool_id
        from participants
        where invite_token = ${token}
        limit 1
      `) as Array<{ id: number; name: string; pool_id: number }>;
      const [participant] = participantRows;

      if (!participant) {
        throw new Response("Invite link not recognised", { status: 404 });
      }

      const fixtureRows = (await tx`
        select id, home_country, away_country, home_score, kickoff <= now() as match_started
        from fixtures
        where id = ${body.fixtureId!}
        limit 1
      `) as Array<{
        id: number;
        home_country: string;
        away_country: string;
        home_score: number | null;
        match_started: boolean;
      }>;
      const [fixture] = fixtureRows;

      if (!fixture) {
        throw new Response("Fixture not found", { status: 404 });
      }
      if (fixture.match_started) {
        throw new Response("Betting has closed - this match has already started", { status: 409 });
      }
      if (fixture.home_score !== null) {
        throw new Response("That fixture has already been played", { status: 409 });
      }

      const backed = body.backedCountry;
      if (backed !== fixture.home_country && backed !== fixture.away_country) {
        throw new Response("Backed team is not in this fixture", { status: 400 });
      }
      const opponent = backed === fixture.home_country ? fixture.away_country : fixture.home_country;

      let creatorSide: string;
      let opponentSide: string;
      let handicapTeam: string | null;

      if (market === "winner") {
        creatorSide = backed;
        opponentSide = opponent;
        handicapTeam = null;
      } else {
        creatorSide = `${backed} ${formatLine(handicapLine!)}`;
        opponentSide = `${opponent} ${formatLine(-handicapLine!)}`;
        handicapTeam = backed;
      }

      const insertedRows = (await tx`
        insert into bet_offers (
          pool_id, fixture_id, creator_participant_id, market, creator_side, opponent_side,
          settlement_basis, handicap_team, handicap_line, max_amount, status, note
        )
        values (
          ${participant.pool_id}, ${fixture.id}, ${participant.id}, ${market}, ${creatorSide}, ${opponentSide},
          ${settlementBasis}, ${handicapTeam}, ${handicapLine}, ${maxAmount}, 'open', ${note}
        )
        returning id
      `) as unknown as Array<{ id: number }>;

      return { id: insertedRows[0].id };
    });

    return NextResponse.json({ offer });
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Could not create offer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
