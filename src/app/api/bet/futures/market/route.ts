import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureGroupSchema } from "@/lib/groups";
import { ensureBettingTables } from "@/lib/state";
import {
  buildParticipantFuturesTemplate,
  participantFuturesTemplateFor,
  type ParticipantFuturesEventType
} from "@/lib/futures-event-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_ENTRY_WINDOW_HOURS = 8;
const CLOSE_BEFORE_KICKOFF_HOURS = 1;
type CreateParticipantMarketBody = {
  token?: string;
  fixtureId?: number;
  eventType?: ParticipantFuturesEventType;
  coldCountry?: string | null;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateParticipantMarketBody;

  if (!body.token) {
    return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.fixtureId)) {
    return NextResponse.json({ error: "Choose a fixture for this event pool" }, { status: 400 });
  }

  const template = participantFuturesTemplateFor(body.eventType);
  if (!template) return NextResponse.json({ error: "Choose a supported event type" }, { status: 400 });

  const sql = getSql();

  try {
    await ensureBettingTables(sql);
    await ensureGroupSchema(sql);

    const result = await sql.begin(async (tx) => {
      const participantRows = (await tx`
        select id, name, pool_id
        from participants
        where invite_token = ${body.token!}
        limit 1
      `) as Array<{ id: number; name: string; pool_id: number }>;
      const [participant] = participantRows;
      if (!participant) throw new Response("Invite link not recognised", { status: 404 });

      const fixtureRows = (await tx`
        select id, kickoff, stage, home_country, away_country, home_score, away_score
        from fixtures
        where id = ${body.fixtureId!}
        limit 1
      `) as Array<{
        id: number;
        kickoff: string;
        stage: string;
        home_country: string;
        away_country: string;
        home_score: number | null;
        away_score: number | null;
      }>;
      const [fixture] = fixtureRows;
      if (!fixture) throw new Response("Fixture not found", { status: 404 });
      if (fixture.home_score !== null || fixture.away_score !== null) {
        throw new Response("This fixture already has a result", { status: 409 });
      }

      const now = new Date();
      const kickoff = new Date(fixture.kickoff);
      const closesAt = new Date(kickoff.getTime() - CLOSE_BEFORE_KICKOFF_HOURS * 60 * 60 * 1000);
      const entryWindowMs = closesAt.getTime() - now.getTime();
      if (!Number.isFinite(kickoff.getTime()) || kickoff.getTime() <= now.getTime()) {
        throw new Response("This fixture has already started", { status: 409 });
      }
      if (entryWindowMs < MIN_ENTRY_WINDOW_HOURS * 60 * 60 * 1000) {
        throw new Response("Create the event earlier: players need 8 hours before the 1-hour pre-kickoff close", {
          status: 409
        });
      }

      let coldCountry: string | null = null;
      if (template.needsColdOption) {
        coldCountry = clean(body.coldCountry);
        if (!coldCountry) throw new Response("Choose a cold option country", { status: 400 });
        if ([fixture.home_country, fixture.away_country].includes(coldCountry)) {
          throw new Response("Cold option must be a third country", { status: 400 });
        }
        const coldRows = (await tx`
          select country
          from teams
          where country = ${coldCountry}
            and final_rank is null
            and eliminated_stage is null
          limit 1
        `) as Array<{ country: string }>;
        if (!coldRows.length) throw new Response("Cold option country is not active", { status: 400 });
      }

      const generated = buildParticipantFuturesTemplate({
        type: template.type,
        homeCountry: fixture.home_country,
        awayCountry: fixture.away_country,
        coldCountry
      });
      if (!generated) throw new Response("Choose a supported event type", { status: 400 });

      const targetRows = (await tx`
        select id, title
        from futures_markets
        where pool_id = ${participant.pool_id}
          and market_type = 'world_cup_winner'
          and status in ('open', 'closed')
        order by id desc
        limit 1
      `) as Array<{ id: number; title: string }>;
      const [target] = targetRows;
      if (!target) {
        throw new Response("World Cup Winner Jackpot must exist before event pools can be created", { status: 409 });
      }

      const [market] = (await tx`
        insert into futures_markets (
          pool_id, creator_participant_id, fixture_id, title, market_type, settlement_basis,
          opens_at, closes_at, rollover_target_market_id, auto_created, open_window_note,
          loss_rule, status
        )
        values (
          ${participant.pool_id}, ${participant.id}, ${fixture.id}, ${generated.title}, ${generated.marketType},
          ${generated.settlementBasis},
          ${now.toISOString()}, ${closesAt.toISOString()}, ${target.id}, false,
          ${`Created by ${participant.name}. Opens immediately and closes 1 hour before kickoff. ${generated.settlementNote}`},
          ${`Wrong or partially unpaid picks lose that amount into ${target.title}. Entries cannot be cancelled.`},
          'open'
        )
        returning id, closes_at::text as closes_at
      `) as Array<{ id: number; closes_at: string }>;

      for (const [index, option] of generated.options.entries()) {
        await tx`
          insert into futures_options (market_id, label, sort_order)
          values (${market.id}, ${option}, ${index})
        `;
      }

      return {
        marketId: market.id,
        closesAt: market.closes_at,
        target: target.title,
        fixture: `${fixture.home_country} v ${fixture.away_country}`,
        title: generated.title,
        options: generated.options
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not create event pool";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
