import { getSql } from "./db";
import { buildBettingState } from "./betting";
import type {
  AppState,
  BetAcceptance,
  BetAcceptanceResult,
  BetAcceptanceStatus,
  BetMarket,
  BetOffer,
  BetOfferStatus,
  BetSettlementBasis,
  Draw,
  Fixture,
  Participant,
  Pot,
  Team
} from "./types";

type SqlClient = ReturnType<typeof getSql>;

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

type FixtureRow = Omit<Fixture, "oddsHandicapLine" | "oddsHomePrice" | "oddsAwayPrice"> & {
  oddsHandicapLine: string | number | null;
  oddsHomePrice: string | number | null;
  oddsAwayPrice: string | number | null;
};

let oddsSchemaReady: Promise<void> | null = null;
let bettingSchemaReady: Promise<void> | null = null;

type BetOfferRow = {
  id: number;
  fixture_id: number;
  creator_participant_id: number;
  creator_name: string;
  market: string;
  creator_side: string;
  opponent_side: string;
  settlement_basis: string;
  handicap_team: string | null;
  handicap_line: string | number | null;
  max_amount: string | number;
  status: string;
  created_at: string;
  note: string | null;
};

type BetAcceptanceRow = {
  id: number;
  offer_id: number;
  participant_id: number;
  participant_name: string;
  amount: string | number;
  status: string;
  result: string;
  ledger_delta: string | number;
  accepted_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNumber(value: string | number | null) {
  return value === null ? null : toNumber(value);
}

function ensureOddsColumns(sql: SqlClient) {
  oddsSchemaReady ??= sql`
    alter table fixtures
      add column if not exists odds_provider text,
      add column if not exists odds_bookmaker text,
      add column if not exists odds_market text,
      add column if not exists odds_favourite text,
      add column if not exists odds_handicap_line numeric(5,2),
      add column if not exists odds_home_price numeric(10,4),
      add column if not exists odds_away_price numeric(10,4),
      add column if not exists odds_last_updated timestamptz,
      add column if not exists odds_external_event_id text
  `.then(() => undefined);

  return oddsSchemaReady;
}

function ensureBettingTables(sql: SqlClient) {
  bettingSchemaReady ??= (async () => {
    await sql`
      create table if not exists bet_offers (
        id serial primary key,
        fixture_id integer not null references fixtures(id) on delete cascade,
        creator_participant_id integer not null references participants(id) on delete cascade,
        market text not null,
        creator_side text not null,
        opponent_side text not null,
        settlement_basis text not null,
        handicap_team text,
        handicap_line numeric(5,2),
        max_amount numeric(10,2) not null,
        status text not null default 'open',
        note text,
        created_at timestamptz not null default now()
      )
    `;
    await sql`
      create table if not exists bet_acceptances (
        id serial primary key,
        offer_id integer not null references bet_offers(id) on delete cascade,
        participant_id integer not null references participants(id) on delete cascade,
        amount numeric(10,2) not null,
        status text not null default 'pending',
        result text not null default 'pending',
        ledger_delta numeric(10,2) not null default 0,
        accepted_at timestamptz not null default now()
      )
    `;
  })();

  return bettingSchemaReady;
}

async function getBetOffers(sql: SqlClient): Promise<BetOffer[]> {
  const [offerRows, acceptanceRows] = await Promise.all([
    sql<BetOfferRow[]>`
      select
        o.id,
        o.fixture_id,
        o.creator_participant_id,
        c.name as creator_name,
        o.market,
        o.creator_side,
        o.opponent_side,
        o.settlement_basis,
        o.handicap_team,
        o.handicap_line,
        o.max_amount,
        o.status,
        o.created_at::text as created_at,
        o.note
      from bet_offers o
      join participants c on c.id = o.creator_participant_id
      order by o.created_at desc, o.id desc
    `,
    sql<BetAcceptanceRow[]>`
      select
        a.id,
        a.offer_id,
        a.participant_id,
        p.name as participant_name,
        a.amount,
        a.status,
        a.result,
        a.ledger_delta,
        a.accepted_at::text as accepted_at
      from bet_acceptances a
      join participants p on p.id = a.participant_id
      order by a.accepted_at, a.id
    `
  ]);

  const acceptancesByOffer = new Map<number, BetAcceptance[]>();
  for (const row of acceptanceRows) {
    const acceptance: BetAcceptance = {
      id: row.id,
      offerId: row.offer_id,
      participantId: row.participant_id,
      participantName: row.participant_name,
      amount: toNumber(row.amount),
      status: row.status as BetAcceptanceStatus,
      result: row.result as BetAcceptanceResult,
      ledgerDelta: toNumber(row.ledger_delta),
      acceptedAt: row.accepted_at
    };
    const list = acceptancesByOffer.get(row.offer_id);
    if (list) list.push(acceptance);
    else acceptancesByOffer.set(row.offer_id, [acceptance]);
  }

  return offerRows.map((row) => {
    const acceptances = acceptancesByOffer.get(row.id) ?? [];
    const maxAmount = toNumber(row.max_amount);
    const acceptedAmount = acceptances
      .filter((acceptance) => acceptance.status !== "void")
      .reduce((total, acceptance) => total + acceptance.amount, 0);

    return {
      id: row.id,
      fixtureId: row.fixture_id,
      creatorParticipantId: row.creator_participant_id,
      creatorName: row.creator_name,
      market: row.market as BetMarket,
      creatorSide: row.creator_side,
      opponentSide: row.opponent_side,
      settlementBasis: row.settlement_basis as BetSettlementBasis,
      handicapTeam: row.handicap_team,
      handicapLine: toNullableNumber(row.handicap_line),
      maxAmount,
      acceptedAmount,
      remainingAmount: Math.max(0, maxAmount - acceptedAmount),
      status: row.status as BetOfferStatus,
      createdAt: row.created_at,
      note: row.note,
      acceptances
    } satisfies BetOffer;
  });
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
  await Promise.all([ensureOddsColumns(sql), ensureBettingTables(sql)]);

  const [participantRows, potRows, teamRows, drawRows, fixtureRows, betOffers] = await Promise.all([
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
    sql<FixtureRow[]>`
      select
        f.id,
        f.kickoff::text as kickoff,
        f.stage,
        f.home_country as "homeCountry",
        f.away_country as "awayCountry",
        f.venue,
        f.home_score as "homeScore",
        f.away_score as "awayScore",
        f.odds_provider as "oddsProvider",
        f.odds_bookmaker as "oddsBookmaker",
        f.odds_market as "oddsMarket",
        f.odds_favourite as "oddsFavourite",
        f.odds_handicap_line as "oddsHandicapLine",
        f.odds_home_price as "oddsHomePrice",
        f.odds_away_price as "oddsAwayPrice",
        f.odds_last_updated::text as "oddsLastUpdated",
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
    `,
    getBetOffers(sql)
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
    fixtures: fixtureRows.map((fixture) => ({
      ...fixture,
      oddsHandicapLine: toNullableNumber(fixture.oddsHandicapLine),
      oddsHomePrice: toNullableNumber(fixture.oddsHomePrice),
      oddsAwayPrice: toNullableNumber(fixture.oddsAwayPrice)
    })),
    teams: teamRows.map(mapTeam),
    betting: buildBettingState(participantRows, participant, betOffers)
  };
}
