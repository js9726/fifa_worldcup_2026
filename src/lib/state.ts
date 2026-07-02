import { getSql } from "./db";
import { buildBettingState } from "./betting";
import { ensureGroupSchema, mapGroup } from "./groups";
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
  SweepstakeGroup,
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
let fixtureScoreSchemaReady: Promise<void> | null = null;

type BetOfferRow = {
  id: number;
  pool_id: number;
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

type StateOptions = {
  inviteToken?: string | null;
  groupSlug?: string | null;
};

type ParticipantRow = {
  id: number;
  name: string;
  groupId: number;
};

type StateGroupRow = {
  id: number;
  slug: string;
  name: string;
  allow_draws: boolean;
  teams_per_participant: number | null;
  prize_pool_amount: string | number;
  champion_prize_amount: string | number;
  runner_up_prize_amount: string | number;
  wooden_spoon_prize_amount: string | number;
  created_at: string;
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

function ensureFixtureScoreColumns(sql: SqlClient) {
  fixtureScoreSchemaReady ??= sql`
    alter table fixtures
      add column if not exists regular_home_score integer,
      add column if not exists regular_away_score integer
  `.then(() => undefined);

  return fixtureScoreSchemaReady;
}

export function ensureBettingTables(sql: SqlClient = getSql()) {
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

async function getBetOffers(sql: SqlClient, groupId: number): Promise<BetOffer[]> {
  const [offerRows, acceptanceRows] = await Promise.all([
    sql<BetOfferRow[]>`
      select
        o.id,
        o.pool_id,
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
      where o.pool_id = ${groupId}
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
      join bet_offers o on o.id = a.offer_id
      where o.pool_id = ${groupId}
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
      groupId: row.pool_id,
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

export async function getAppState(input?: string | null | StateOptions): Promise<AppState> {
  const options =
    typeof input === "string" || input === null || input === undefined ? { inviteToken: input } : input;
  const inviteToken = options.inviteToken ?? null;
  const groupSlug = options.groupSlug ?? null;
  const sql = getSql();
  await ensureBettingTables(sql);
  await Promise.all([ensureOddsColumns(sql), ensureFixtureScoreColumns(sql), ensureGroupSchema(sql)]);

  const context = await resolveStateContext(sql, { inviteToken, groupSlug });
  if (!context.group) return emptyAppState();

  const groupId = context.group.id;
  const participant = context.participant;

  const [participantRows, potRows, teamRows, drawRows, fixtureRows, betOffers] = await Promise.all([
    sql<ParticipantRow[]>`
      select id, name, pool_id as "groupId"
      from participants
      where pool_id = ${groupId}
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
      left join draws d on d.team_id = t.id and d.pool_id = ${groupId}
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
      where d.pool_id = ${groupId}
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
        f.regular_home_score as "regularHomeScore",
        f.regular_away_score as "regularAwayScore",
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
      left join draws hd on hd.team_id = ht.id and hd.pool_id = ${groupId}
      left join participants hp on hp.id = hd.participant_id
      left join teams at on at.country = f.away_country
      left join draws ad on ad.team_id = at.id and ad.pool_id = ${groupId}
      left join participants ap on ap.id = ad.participant_id
      order by f.kickoff
    `,
    getBetOffers(sql, groupId)
  ]);

  const allDraws: Draw[] = drawRows.map((row) => ({
    participantName: row.participant_name,
    participantId: row.participant_id,
    team: mapTeam(row),
    drawnAt: row.drawn_at
  }));

  return {
    group: context.group,
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

async function resolveStateContext(
  sql: SqlClient,
  { inviteToken, groupSlug }: { inviteToken: string | null; groupSlug: string | null }
): Promise<{ group: SweepstakeGroup | null; participant: Participant | null }> {
  if (inviteToken) {
    const [row] = await sql<
      Array<
        ParticipantRow & {
          slug: string;
          group_name: string;
          allow_draws: boolean;
          teams_per_participant: number | null;
          prize_pool_amount: string | number;
          champion_prize_amount: string | number;
          runner_up_prize_amount: string | number;
          wooden_spoon_prize_amount: string | number;
          created_at: string;
        }
      >
    >`
      select
        p.id,
        p.name,
        p.pool_id as "groupId",
        g.slug,
        g.name as group_name,
        g.allow_draws,
        g.teams_per_participant,
        g.prize_pool_amount,
        g.champion_prize_amount,
        g.runner_up_prize_amount,
        g.wooden_spoon_prize_amount,
        g.created_at::text as created_at
      from participants p
      join sweepstake_groups g on g.id = p.pool_id
      where p.invite_token = ${inviteToken}
      limit 1
    `;
    if (!row) return { group: null, participant: null };

    return {
      group: mapGroup({
        id: row.groupId,
        slug: row.slug,
        name: row.group_name,
        allow_draws: row.allow_draws,
        teams_per_participant: row.teams_per_participant,
        prize_pool_amount: row.prize_pool_amount,
        champion_prize_amount: row.champion_prize_amount,
        runner_up_prize_amount: row.runner_up_prize_amount,
        wooden_spoon_prize_amount: row.wooden_spoon_prize_amount,
        created_at: row.created_at
      }),
      participant: { id: row.id, name: row.name, groupId: row.groupId }
    };
  }

  if (groupSlug) {
    const [row] = await sql<StateGroupRow[]>`
      select
        id, slug, name, allow_draws, teams_per_participant, prize_pool_amount, champion_prize_amount,
        runner_up_prize_amount, wooden_spoon_prize_amount, created_at::text as created_at
      from sweepstake_groups
      where slug = ${groupSlug}
      limit 1
    `;
    return { group: row ? mapGroup(row) : null, participant: null };
  }

  return { group: null, participant: null };
}

function emptyAppState(): AppState {
  return {
    group: null,
    participant: null,
    participants: [],
    pots: [],
    myDraws: [],
    allDraws: [],
    fixtures: [],
    teams: [],
    betting: buildBettingState([], null, [])
  };
}
