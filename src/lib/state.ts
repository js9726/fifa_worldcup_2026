import { getSql } from "./db";
import type { AppState, Draw, Fixture, Participant, Pot, Team } from "./types";

type TeamRow = {
  id: number;
  country: string;
  pot_id: number;
  pot_name: string;
  pot_label: string;
  flag: string;
  confed: string;
  star_player: string;
  player_role: string;
  fifa_rank: number;
  win_rate: string | number;
  top10_rate: string | number;
  expected_rank: number;
  final_rank: number | null;
  eliminated_stage: string | null;
  result_note: string | null;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

export function mapTeam(row: TeamRow): Team {
  return {
    id: row.id,
    country: row.country,
    potId: row.pot_id,
    potName: row.pot_name,
    potLabel: row.pot_label,
    flag: row.flag,
    confed: row.confed,
    starPlayer: row.star_player,
    playerRole: row.player_role,
    fifaRank: row.fifa_rank,
    winRate: toNumber(row.win_rate),
    top10Rate: toNumber(row.top10_rate),
    expectedRank: row.expected_rank,
    finalRank: row.final_rank,
    eliminatedStage: row.eliminated_stage,
    resultNote: row.result_note
  };
}

export async function getAppState(inviteToken?: string | null): Promise<AppState> {
  const sql = getSql();

  const [participantRows, potRows, teamRows, drawRows, fixtureRows] = await Promise.all([
    sql<Participant[]>`
      select id, name
      from participants
      order by name
    `,
    sql<Array<Pot & { available: string | number; total: string | number }>>`
      select
        p.id,
        p.name,
        p.label,
        p.colour,
        count(t.id)::int as total,
        count(t.id) filter (where d.id is null)::int as available
      from pots p
      left join teams t on t.pot_id = p.id
      left join draws d on d.team_id = t.id
      group by p.id
      order by p.id
    `,
    sql<TeamRow[]>`
      select
        t.*,
        p.name as pot_name,
        p.label as pot_label
      from teams t
      join pots p on p.id = t.pot_id
      order by t.pot_id, t.win_rate desc, t.country
    `,
    sql<Array<TeamRow & { participant_name: string; participant_id: number; drawn_at: string }>>`
      select
        t.*,
        p.name as pot_name,
        p.label as pot_label,
        participants.name as participant_name,
        participants.id as participant_id,
        d.drawn_at::text as drawn_at
      from draws d
      join participants on participants.id = d.participant_id
      join teams t on t.id = d.team_id
      join pots p on p.id = t.pot_id
      order by participants.name, t.pot_id
    `,
    sql<Fixture[]>`
      select
        f.id,
        f.kickoff::text as kickoff,
        f.stage,
        f.home_country as "homeCountry",
        f.away_country as "awayCountry",
        f.venue,
        f.home_score as "homeScore",
        f.away_score as "awayScore",
        hp.name as "homeOwner",
        ap.name as "awayOwner"
      from fixtures f
      left join teams ht on ht.country = f.home_country
      left join draws hd on hd.team_id = ht.id
      left join participants hp on hp.id = hd.participant_id
      left join teams at on at.country = f.away_country
      left join draws ad on ad.team_id = at.id
      left join participants ap on ap.id = ad.participant_id
      order by f.kickoff
    `
  ]);

  const participant = inviteToken
    ? (await sql<Participant[]>`
        select id, name
        from participants
        where invite_token = ${inviteToken}
        limit 1
      `)[0] ?? null
    : null;

  const allDraws: Draw[] = drawRows.map((row) => ({
    participantName: row.participant_name,
    participantId: row.participant_id,
    team: mapTeam(row),
    drawnAt: row.drawn_at
  }));

  return {
    participant,
    participants: participantRows,
    pots: potRows.map((pot) => ({
      ...pot,
      available: Number(pot.available),
      total: Number(pot.total)
    })),
    myDraws: participant ? allDraws.filter((draw) => draw.participantId === participant.id) : [],
    allDraws,
    fixtures: fixtureRows,
    teams: teamRows.map(mapTeam)
  };
}
