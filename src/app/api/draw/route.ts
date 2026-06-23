import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { ensureBettingTables, mapTeam } from "@/lib/state";
import { ensureGroupSchema } from "@/lib/groups";
import type { Draw } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeamRow = Parameters<typeof mapTeam>[0];

export async function POST(request: NextRequest) {
  const { token, potId } = (await request.json()) as { token?: string; potId?: number };

  if (!token || !Number.isInteger(potId)) {
    return NextResponse.json({ error: "Invite token and potId are required" }, { status: 400 });
  }

  const requestedPotId = Number(potId);
  const sql = getSql();

  try {
    await ensureBettingTables(sql);
    await ensureGroupSchema(sql);

    const draw = await sql.begin(async (tx) => {
      const participantRows = (await tx`
        select p.id, p.name, p.pool_id, g.allow_draws
        from participants p
        join sweepstake_groups g on g.id = p.pool_id
        where p.invite_token = ${token}
        limit 1
      `) as Array<{ id: number; name: string; pool_id: number; allow_draws: boolean }>;
      const [participant] = participantRows;

      if (!participant) {
        throw new Response("Invite link not recognised", { status: 404 });
      }
      if (!participant.allow_draws) {
        throw new Response("This group already has assigned teams. Draws are locked.", { status: 409 });
      }

      const existingRows = (await tx`
        select
          t.*,
          p.name as pot_name,
          p.label as pot_label,
          d.drawn_at::text as drawn_at
        from draws d
        join teams t on t.id = d.team_id
        join pots p on p.id = t.pot_id
        where d.participant_id = ${participant.id}
          and d.pool_id = ${participant.pool_id}
          and d.pot_id = ${requestedPotId}
        limit 1
      `) as Array<TeamRow & { drawn_at: string }>;
      const [existing] = existingRows;

      if (existing) {
        return {
          participantName: participant.name,
          participantId: participant.id,
          team: mapTeam(existing),
          drawnAt: existing.drawn_at
        } satisfies Draw;
      }

      const teamRows = (await tx`
        select
          t.*,
          p.name as pot_name,
          p.label as pot_label
        from teams t
        join pots p on p.id = t.pot_id
        where t.pot_id = ${requestedPotId}
          and not exists (
            select 1
            from draws d
            where d.team_id = t.id
              and d.pool_id = ${participant.pool_id}
          )
        order by random()
        limit 1
        for update of t skip locked
      `) as TeamRow[];
      const [team] = teamRows;

      if (!team) {
        throw new Response("This tier has no countries left", { status: 409 });
      }

      const insertedRows = (await tx`
        insert into draws (pool_id, participant_id, team_id, pot_id)
        values (${participant.pool_id}, ${participant.id}, ${team.id}, ${requestedPotId})
        returning drawn_at::text
      `) as Array<{ drawn_at: string }>;
      const [inserted] = insertedRows;

      return {
        participantName: participant.name,
        participantId: participant.id,
        team: mapTeam(team),
        drawnAt: inserted.drawn_at
      } satisfies Draw;
    });

    return NextResponse.json({ draw });
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Draw failed";
    const status = message.includes("duplicate") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
