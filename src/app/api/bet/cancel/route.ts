import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureBettingTables } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANCEL_LOCK_HOURS = 1;

type CancelBody = {
  token?: string;
  offerId?: number;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CancelBody;
  const { token } = body;

  if (!token) {
    return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.offerId)) {
    return NextResponse.json({ error: "An offer is required" }, { status: 400 });
  }

  const sql = getSql();

  try {
    await ensureBettingTables(sql);

    await sql.begin(async (tx) => {
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
        select
          o.id,
          o.creator_participant_id,
          o.status,
          f.kickoff <= now() as match_started,
          f.kickoff - (${CANCEL_LOCK_HOURS}::int * interval '1 hour') <= now() as cancel_locked
        from bet_offers o
        join fixtures f on f.id = o.fixture_id
        where o.id = ${body.offerId!}
        for update of o
      `) as Array<{
        id: number;
        creator_participant_id: number;
        status: string;
        match_started: boolean;
        cancel_locked: boolean;
      }>;
      const [offer] = offerRows;

      if (!offer) {
        throw new Response("Offer not found", { status: 404 });
      }
      if (offer.creator_participant_id !== participant.id) {
        throw new Response("You can only cancel your own offers", { status: 403 });
      }
      if (offer.status !== "open" && offer.status !== "filled") {
        throw new Response("This offer can no longer be cancelled", { status: 409 });
      }

      const activeRows = (await tx`
        select count(*)::int as active
        from bet_acceptances
        where offer_id = ${offer.id}
          and status = 'pending'
      `) as Array<{ active: number }>;
      const hasActiveBets = activeRows[0].active > 0;

      // No bet pool changes are allowed once a match is live.
      if (offer.match_started) {
        throw new Response("Offers cannot be cancelled after kickoff", { status: 409 });
      }

      // Unmatched offers can be pulled before kickoff. Once a bet is matched,
      // the creator can only cancel up until the cut-off before kickoff.
      if (hasActiveBets && offer.cancel_locked) {
        throw new Response(
          `Once a bet is matched, cancellation closes ${CANCEL_LOCK_HOURS} hour before kickoff`,
          { status: 409 }
        );
      }

      // Refund any matched-but-unsettled stakes, then void the offer.
      await tx`
        update bet_acceptances
        set status = 'void', result = 'void', ledger_delta = 0
        where offer_id = ${offer.id}
          and status = 'pending'
      `;
      await tx`update bet_offers set status = 'void' where id = ${offer.id}`;
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Could not cancel offer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
