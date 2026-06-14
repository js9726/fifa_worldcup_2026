import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureBettingTables } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AcceptBody = {
  token?: string;
  offerId?: number;
  amount?: number;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as AcceptBody;
  const { token } = body;

  if (!token) {
    return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.offerId)) {
    return NextResponse.json({ error: "An offer is required" }, { status: 400 });
  }

  const stake = Number(body.amount);
  if (!Number.isFinite(stake) || stake <= 0) {
    return NextResponse.json({ error: "Stake must be greater than zero" }, { status: 400 });
  }
  const roundedStake = Math.round(stake * 100) / 100;

  const sql = getSql();

  try {
    await ensureBettingTables(sql);

    const acceptance = await sql.begin(async (tx) => {
      const participantRows = (await tx`
        select id, name
        from participants
        where invite_token = ${token}
        limit 1
      `) as Array<{ id: number; name: string }>;
      const [participant] = participantRows;

      if (!participant) {
        throw new Response("Invite link not recognised", { status: 404 });
      }

      const offerRows = (await tx`
        select o.id, o.creator_participant_id, o.max_amount, o.status, f.kickoff::text as kickoff
        from bet_offers o
        join fixtures f on f.id = o.fixture_id
        where o.id = ${body.offerId!}
        for update of o
      `) as Array<{
        id: number;
        creator_participant_id: number;
        max_amount: string | number;
        status: string;
        kickoff: string;
      }>;
      const [offer] = offerRows;

      if (!offer) {
        throw new Response("Offer not found", { status: 404 });
      }
      if (offer.creator_participant_id === participant.id) {
        throw new Response("You cannot accept your own offer", { status: 400 });
      }
      if (offer.status !== "open") {
        throw new Response("Offer is no longer open", { status: 409 });
      }
      if (new Date(offer.kickoff).getTime() <= Date.now()) {
        throw new Response("Betting has closed — this match has already started", { status: 409 });
      }

      const matchedRows = (await tx`
        select coalesce(sum(amount), 0)::float8 as matched
        from bet_acceptances
        where offer_id = ${offer.id}
          and status <> 'void'
      `) as Array<{ matched: number }>;
      const matched = Number(matchedRows[0].matched);
      const maxAmount = Number(offer.max_amount);
      const remaining = Math.round((maxAmount - matched) * 100) / 100;

      if (remaining <= 0) {
        throw new Response("Offer is fully matched", { status: 409 });
      }
      if (roundedStake > remaining + 1e-9) {
        throw new Response(`Only RM${remaining} remaining on this offer`, { status: 409 });
      }

      const insertedRows = (await tx`
        insert into bet_acceptances (offer_id, participant_id, amount, status, result, ledger_delta)
        values (${offer.id}, ${participant.id}, ${roundedStake}, 'pending', 'pending', 0)
        returning id
      `) as Array<{ id: number }>;

      if (matched + roundedStake >= maxAmount - 1e-9) {
        await tx`update bet_offers set status = 'filled' where id = ${offer.id}`;
      }

      return { id: insertedRows[0].id, amount: roundedStake };
    });

    return NextResponse.json({ acceptance });
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Could not accept offer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
