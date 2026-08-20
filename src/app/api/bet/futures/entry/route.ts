import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureBettingTables } from "@/lib/state";
import { ensureGroupSchema } from "@/lib/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EntryBody = {
  token?: string;
  marketId?: number;
  optionId?: number;
  amount?: number;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as EntryBody;

  if (!body.token) {
    return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.marketId)) {
    return NextResponse.json({ error: "A futures pool is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.optionId)) {
    return NextResponse.json({ error: "Pick an option" }, { status: 400 });
  }

  const stake = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(stake) || stake <= 0) {
    return NextResponse.json({ error: "Stake must be greater than zero" }, { status: 400 });
  }

  const sql = getSql();

  try {
    await ensureBettingTables(sql);
    await ensureGroupSchema(sql);

    const entry = await sql.begin(async (tx) => {
      const participantRows = (await tx`
        select id, name, pool_id
        from participants
        where invite_token = ${body.token!}
        limit 1
      `) as Array<{ id: number; name: string; pool_id: number }>;
      const [participant] = participantRows;
      if (!participant) throw new Response("Invite link not recognised", { status: 404 });

      const marketRows = (await tx`
        select
          id,
          pool_id,
          status,
          opens_at is not null and opens_at > now() as not_open_yet,
          closes_at <= now() as deadline_passed
        from futures_markets
        where id = ${body.marketId!}
        for update
      `) as Array<{
        id: number;
        pool_id: number;
        status: string;
        not_open_yet: boolean;
        deadline_passed: boolean;
      }>;
      const [market] = marketRows;
      if (!market || market.pool_id !== participant.pool_id) {
        throw new Response("Futures pool not found", { status: 404 });
      }
      if (market.status !== "open") {
        throw new Response("This futures pool is no longer open", { status: 409 });
      }
      if (market.not_open_yet) {
        throw new Response("This futures pool is not open for entries yet", { status: 409 });
      }
      if (market.deadline_passed) {
        throw new Response("This futures pool has passed its deadline", { status: 409 });
      }

      const optionRows = (await tx`
        select id
        from futures_options
        where id = ${body.optionId!}
          and market_id = ${market.id}
        limit 1
      `) as Array<{ id: number }>;
      if (!optionRows.length) throw new Response("Option not found", { status: 404 });

      const insertedRows = (await tx`
        insert into futures_entries (market_id, option_id, participant_id, amount, status, result, payout_amount)
        values (${market.id}, ${optionRows[0].id}, ${participant.id}, ${stake}, 'active', 'pending', 0)
        returning id, amount
      `) as Array<{ id: number; amount: string | number }>;

      return { id: insertedRows[0].id, amount: Number(insertedRows[0].amount) };
    });

    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Could not place futures entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
