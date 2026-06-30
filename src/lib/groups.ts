import crypto from "node:crypto";
import postgres from "postgres";
import { getSql } from "./db";
import { WALPLUS_GROUP_ASSIGNMENTS, WALPLUS_GROUP_NAME, WALPLUS_GROUP_SLUG } from "./group-presets";
import type { SweepstakeGroup, SweepstakeGroupSummary } from "./types";

type SqlClient = ReturnType<typeof postgres>;

export const DEFAULT_GROUP_SLUG = "world-cup-2026";
export const DEFAULT_GROUP_NAME = "World Cup Sweepstake 2026";
export { WALPLUS_GROUP_ASSIGNMENTS, WALPLUS_GROUP_NAME, WALPLUS_GROUP_SLUG };

export type PoolAssignment = {
  name: string;
  teams: string[];
};

export type GroupParticipantInput = {
  name: string;
};

export type CreatedInviteLink = {
  participantId: number;
  participantName: string;
  inviteToken: string;
  inviteUrl: string;
};

type GroupRow = {
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

export type PrizeSettingsInput = {
  prizePoolAmount: number;
  championPrizeAmount: number;
  runnerUpPrizeAmount: number;
  woodenSpoonPrizeAmount: number;
};

let groupSchemaReady: Promise<void> | null = null;

export function ensureGroupSchema(sql: SqlClient = getSql()) {
  groupSchemaReady ??= (async () => {
    await sql`
      create table if not exists sweepstake_groups (
        id serial primary key,
        slug text not null unique,
        name text not null,
        allow_draws boolean not null default true,
        teams_per_participant integer,
        prize_pool_amount numeric(10,2) not null default 600,
        champion_prize_amount numeric(10,2) not null default 360,
        runner_up_prize_amount numeric(10,2) not null default 180,
        wooden_spoon_prize_amount numeric(10,2) not null default 60,
        created_at timestamptz not null default now()
      )
    `;
    await sql`alter table sweepstake_groups add column if not exists allow_draws boolean not null default true`;
    await sql`
      alter table sweepstake_groups
        add column if not exists teams_per_participant integer,
        add column if not exists prize_pool_amount numeric(10,2) not null default 600,
        add column if not exists champion_prize_amount numeric(10,2) not null default 360,
        add column if not exists runner_up_prize_amount numeric(10,2) not null default 180,
        add column if not exists wooden_spoon_prize_amount numeric(10,2) not null default 60
    `;
    await sql`
      insert into sweepstake_groups (slug, name, allow_draws)
      values (${DEFAULT_GROUP_SLUG}, ${DEFAULT_GROUP_NAME}, true)
      on conflict (slug) do nothing
    `;

    await sql`alter table participants add column if not exists pool_id integer references sweepstake_groups(id)`;
    await sql`
      update participants
      set pool_id = (select id from sweepstake_groups where slug = ${DEFAULT_GROUP_SLUG})
      where pool_id is null
    `;
    await sql`alter table participants alter column pool_id set not null`;

    await sql`alter table draws add column if not exists pool_id integer references sweepstake_groups(id)`;
    await sql`
      update draws d
      set pool_id = p.pool_id
      from participants p
      where d.participant_id = p.id
        and d.pool_id is null
    `;
    await sql`alter table draws alter column pool_id set not null`;

    await sql`alter table bet_offers add column if not exists pool_id integer references sweepstake_groups(id)`;
    await sql`
      update bet_offers o
      set pool_id = p.pool_id
      from participants p
      where o.creator_participant_id = p.id
        and o.pool_id is null
    `;
    await sql`alter table bet_offers alter column pool_id set not null`;

    await sql`alter table participants drop constraint if exists participants_name_key`;
    await sql`alter table draws drop constraint if exists draws_participant_id_pot_id_key`;
    await sql`alter table draws drop constraint if exists draws_team_id_key`;

    await sql`create unique index if not exists participants_pool_name_unique on participants(pool_id, name)`;
    await sql`create unique index if not exists draws_pool_team_unique on draws(pool_id, team_id)`;
    await sql`create index if not exists draws_pool_participant_idx on draws(pool_id, participant_id)`;
    await sql`create index if not exists bet_offers_pool_id_idx on bet_offers(pool_id)`;
  })();

  return groupSchemaReady;
}

export function mapGroup(row: GroupRow): SweepstakeGroup {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    allowDraws: row.allow_draws,
    teamsPerParticipant: row.teams_per_participant == null ? null : Number(row.teams_per_participant),
    prizePoolAmount: toNumber(row.prize_pool_amount),
    championPrizeAmount: toNumber(row.champion_prize_amount),
    runnerUpPrizeAmount: toNumber(row.runner_up_prize_amount),
    woodenSpoonPrizeAmount: toNumber(row.wooden_spoon_prize_amount),
    createdAt: row.created_at
  };
}

export function slugifyGroupName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

export function cleanDisplayName(value: string) {
  return value
    .replace(/^[\u200B-\u200D\u2060\uFEFF]+/, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]+$/, "")
    .trim();
}

export function normaliseCountryName(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function listSweepstakeGroups(sql: SqlClient = getSql()): Promise<SweepstakeGroupSummary[]> {
  await ensureGroupSchema(sql);

  const rows = await sql<
    Array<
      GroupRow & {
        participant_count: number;
        draw_count: number;
        offer_count: number;
      }
    >
  >`
    select
      g.id,
      g.slug,
      g.name,
      g.allow_draws,
      g.teams_per_participant,
      g.prize_pool_amount,
      g.champion_prize_amount,
      g.runner_up_prize_amount,
      g.wooden_spoon_prize_amount,
      g.created_at::text as created_at,
      count(distinct p.id)::int as participant_count,
      count(distinct d.id)::int as draw_count,
      count(distinct o.id)::int as offer_count
    from sweepstake_groups g
    left join participants p on p.pool_id = g.id
    left join draws d on d.pool_id = g.id
    left join bet_offers o on o.pool_id = g.id
    group by g.id
    order by g.id
  `;

  return rows.map((row) => ({
    ...mapGroup(row),
    participantCount: Number(row.participant_count),
    drawCount: Number(row.draw_count),
    offerCount: Number(row.offer_count)
  }));
}

export async function createGroupFromAssignments({
  sql = getSql(),
  name,
  slug,
  assignments,
  appUrl,
  allowDraws = false,
  teamsPerParticipant = null,
  prizeSettings = defaultPrizeSettings()
}: {
  sql?: SqlClient;
  name: string;
  slug?: string | null;
  assignments: PoolAssignment[];
  appUrl: string;
  allowDraws?: boolean;
  teamsPerParticipant?: number | null;
  prizeSettings?: PrizeSettingsInput;
}): Promise<{ group: SweepstakeGroup; inviteLinks: CreatedInviteLink[] }> {
  await ensureGroupSchema(sql);

  const cleanName = cleanDisplayName(name);
  if (!cleanName) throw new Error("Group name is required");

  const groupSlug = slugifyGroupName(slug || cleanName);
  if (!groupSlug) throw new Error("Group slug is required");

  const prizes = validatePrizeSettings(prizeSettings);
  const preparedAssignments = prepareAssignments(assignments, teamsPerParticipant);
  const countries = await sql<Array<{ id: number; country: string; pot_id: number }>>`
    select id, country, pot_id
    from teams
  `;
  const countryMap = buildCountryMap(countries.map((country) => country.country));

  const preparedDraws = preparedAssignments.map((assignment) => ({
    name: assignment.name,
    teams: assignment.teams.map((team) => {
      const country = countryMap.get(normaliseCountryName(team));
      if (!country) throw new Error(`Unknown country: ${team}`);
      const row = countries.find((candidate) => candidate.country === country);
      if (!row) throw new Error(`Unknown country: ${team}`);
      return row;
    })
  }));

  const seenCountries = new Set<string>();
  for (const assignment of preparedDraws) {
    for (const team of assignment.teams) {
      if (seenCountries.has(team.country)) throw new Error(`Duplicate country in group: ${team.country}`);
      seenCountries.add(team.country);
    }
  }

  return sql.begin(async (tx) => {
    const [groupRow] = await tx<GroupRow[]>`
      insert into sweepstake_groups (
        slug, name, allow_draws, teams_per_participant, prize_pool_amount, champion_prize_amount,
        runner_up_prize_amount, wooden_spoon_prize_amount
      )
      values (
        ${groupSlug}, ${cleanName}, ${allowDraws}, ${teamsPerParticipant}, ${prizes.prizePoolAmount},
        ${prizes.championPrizeAmount}, ${prizes.runnerUpPrizeAmount}, ${prizes.woodenSpoonPrizeAmount}
      )
      on conflict (slug) do update set
        name = excluded.name,
        allow_draws = excluded.allow_draws,
        teams_per_participant = excluded.teams_per_participant,
        prize_pool_amount = excluded.prize_pool_amount,
        champion_prize_amount = excluded.champion_prize_amount,
        runner_up_prize_amount = excluded.runner_up_prize_amount,
        wooden_spoon_prize_amount = excluded.wooden_spoon_prize_amount
      returning
        id, slug, name, allow_draws, teams_per_participant, prize_pool_amount, champion_prize_amount,
        runner_up_prize_amount, wooden_spoon_prize_amount, created_at::text as created_at
    `;

    const inviteLinks: CreatedInviteLink[] = [];
    for (const assignment of preparedDraws) {
      const [participant] = await tx<Array<{ id: number; name: string; invite_token: string }>>`
        insert into participants (pool_id, name, invite_token)
        values (${groupRow.id}, ${assignment.name}, ${tokenFor()})
        on conflict (pool_id, name) do update set name = excluded.name
        returning id, name, invite_token
      `;

      for (const team of assignment.teams) {
        await tx`
          insert into draws (pool_id, participant_id, team_id, pot_id)
          values (${groupRow.id}, ${participant.id}, ${team.id}, ${team.pot_id})
          on conflict (pool_id, team_id) do update set
            participant_id = excluded.participant_id,
            pot_id = excluded.pot_id
        `;
      }

      inviteLinks.push({
        participantId: participant.id,
        participantName: participant.name,
        inviteToken: participant.invite_token,
        inviteUrl: `${appUrl.replace(/\/+$/, "")}/invite/${participant.invite_token}`
      });
    }

    return { group: mapGroup(groupRow), inviteLinks };
  });
}

export async function createGroupForDraw({
  sql = getSql(),
  name,
  slug,
  participants,
  appUrl,
  teamsPerParticipant,
  prizeSettings = defaultPrizeSettings()
}: {
  sql?: SqlClient;
  name: string;
  slug?: string | null;
  participants: GroupParticipantInput[];
  appUrl: string;
  teamsPerParticipant?: number | null;
  prizeSettings?: PrizeSettingsInput;
}): Promise<{ group: SweepstakeGroup; inviteLinks: CreatedInviteLink[] }> {
  await ensureGroupSchema(sql);

  const cleanName = cleanDisplayName(name);
  if (!cleanName) throw new Error("Group name is required");

  const groupSlug = slugifyGroupName(slug || cleanName);
  if (!groupSlug) throw new Error("Group slug is required");

  const drawQuota = validateTeamsPerParticipant(teamsPerParticipant, true);
  const prizes = validatePrizeSettings(prizeSettings);
  const preparedParticipants = prepareParticipants(participants);
  const requiredTeamCount = preparedParticipants.length * drawQuota;
  const [{ active_count: activeTeamCount }] = await sql<Array<{ active_count: number }>>`
    select count(*)::int as active_count
    from teams
    where final_rank is null
  `;

  if (activeTeamCount < requiredTeamCount) {
    throw new Error(
      `Only ${activeTeamCount} active countries left; ${preparedParticipants.length} players need ${requiredTeamCount} teams`
    );
  }

  return sql.begin(async (tx) => {
    const [groupRow] = await tx<GroupRow[]>`
      insert into sweepstake_groups (
        slug, name, allow_draws, teams_per_participant, prize_pool_amount, champion_prize_amount,
        runner_up_prize_amount, wooden_spoon_prize_amount
      )
      values (
        ${groupSlug}, ${cleanName}, true, ${drawQuota}, ${prizes.prizePoolAmount},
        ${prizes.championPrizeAmount}, ${prizes.runnerUpPrizeAmount}, ${prizes.woodenSpoonPrizeAmount}
      )
      on conflict (slug) do update set
        name = excluded.name,
        allow_draws = excluded.allow_draws,
        teams_per_participant = excluded.teams_per_participant,
        prize_pool_amount = excluded.prize_pool_amount,
        champion_prize_amount = excluded.champion_prize_amount,
        runner_up_prize_amount = excluded.runner_up_prize_amount,
        wooden_spoon_prize_amount = excluded.wooden_spoon_prize_amount
      returning
        id, slug, name, allow_draws, teams_per_participant, prize_pool_amount, champion_prize_amount,
        runner_up_prize_amount, wooden_spoon_prize_amount, created_at::text as created_at
    `;

    const inviteLinks: CreatedInviteLink[] = [];
    for (const entry of preparedParticipants) {
      const [participant] = await tx<Array<{ id: number; name: string; invite_token: string }>>`
        insert into participants (pool_id, name, invite_token)
        values (${groupRow.id}, ${entry.name}, ${tokenFor()})
        on conflict (pool_id, name) do update set name = excluded.name
        returning id, name, invite_token
      `;

      inviteLinks.push({
        participantId: participant.id,
        participantName: participant.name,
        inviteToken: participant.invite_token,
        inviteUrl: `${appUrl.replace(/\/+$/, "")}/invite/${participant.invite_token}`
      });
    }

    return { group: mapGroup(groupRow), inviteLinks };
  });
}

export async function updateGroupPrizeSettings({
  sql = getSql(),
  slug,
  prizeSettings
}: {
  sql?: SqlClient;
  slug: string;
  prizeSettings: PrizeSettingsInput;
}) {
  await ensureGroupSchema(sql);
  const prizes = validatePrizeSettings(prizeSettings);
  const [row] = await sql<GroupRow[]>`
    update sweepstake_groups
    set
      prize_pool_amount = ${prizes.prizePoolAmount},
      champion_prize_amount = ${prizes.championPrizeAmount},
      runner_up_prize_amount = ${prizes.runnerUpPrizeAmount},
      wooden_spoon_prize_amount = ${prizes.woodenSpoonPrizeAmount}
    where slug = ${slug}
    returning
      id, slug, name, allow_draws, teams_per_participant, prize_pool_amount, champion_prize_amount,
      runner_up_prize_amount, wooden_spoon_prize_amount, created_at::text as created_at
  `;
  if (!row) throw new Error("Group not found");
  return mapGroup(row);
}

export function defaultPrizeSettings(): PrizeSettingsInput {
  return {
    prizePoolAmount: 600,
    championPrizeAmount: 360,
    runnerUpPrizeAmount: 180,
    woodenSpoonPrizeAmount: 60
  };
}

export function walplusPrizeSettings(): PrizeSettingsInput {
  return {
    prizePoolAmount: 400,
    championPrizeAmount: 240,
    runnerUpPrizeAmount: 120,
    woodenSpoonPrizeAmount: 40
  };
}

function prepareAssignments(assignments: PoolAssignment[], teamsPerParticipant: number | null) {
  const expectedTeamsPerParticipant = validateTeamsPerParticipant(teamsPerParticipant, false);
  const preparedParticipants = prepareParticipants(assignments);

  return preparedParticipants.map((participant, index) => {
    const assignment = assignments[index];
    const teams = (assignment.teams ?? []).map(cleanDisplayName).filter(Boolean);
    if (!teams.length) throw new Error(`${participant.name} needs at least one team`);
    if (expectedTeamsPerParticipant !== null && teams.length !== expectedTeamsPerParticipant) {
      throw new Error(`${participant.name} needs exactly ${expectedTeamsPerParticipant} assigned teams`);
    }

    return { name: participant.name, teams };
  });
}

function prepareParticipants(participants: GroupParticipantInput[]) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error("At least one participant is required");
  }

  const seenNames = new Set<string>();
  return participants.map((participant) => {
    const name = cleanDisplayName(participant.name);
    if (!name) throw new Error("Every participant needs a name");
    if (seenNames.has(name)) throw new Error(`Duplicate participant: ${name}`);
    seenNames.add(name);

    return { name };
  });
}

function validateTeamsPerParticipant(value: number | null | undefined, required: true): number;
function validateTeamsPerParticipant(value: number | null | undefined, required: false): number | null;
function validateTeamsPerParticipant(value: number | null | undefined, required: boolean) {
  if (value === null || value === undefined) {
    if (required) throw new Error("Team format is required");
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || ![3, 4, 5].includes(parsed)) {
    throw new Error("Team format must be 3, 4 or 5 teams per participant");
  }

  return parsed;
}

function validatePrizeSettings(input: PrizeSettingsInput) {
  const values = {
    prizePoolAmount: Number(input.prizePoolAmount),
    championPrizeAmount: Number(input.championPrizeAmount),
    runnerUpPrizeAmount: Number(input.runnerUpPrizeAmount),
    woodenSpoonPrizeAmount: Number(input.woodenSpoonPrizeAmount)
  };

  for (const [key, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${key} must be a non-negative amount`);
    }
  }

  const tierTotal =
    values.championPrizeAmount + values.runnerUpPrizeAmount + values.woodenSpoonPrizeAmount;
  if (Math.round(tierTotal * 100) !== Math.round(values.prizePoolAmount * 100)) {
    throw new Error("Prize tiers must add up to the total prize pool");
  }

  return values;
}

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function buildCountryMap(countries: string[]) {
  const map = new Map(countries.map((country) => [normaliseCountryName(country), country]));
  const byLooseName = (matcher: (country: string) => boolean, fallback: string) =>
    countries.find(matcher) ?? fallback;

  const aliases: Record<string, string> = {
    "ivory coast": "Cote d'Ivoire",
    "cote d ivoire": "Cote d'Ivoire",
    "cote divoire": "Cote d'Ivoire",
    "south korea": "Korea Republic",
    "republic of korea": "Korea Republic",
    "korea south": "Korea Republic",
    turkey: byLooseName((country) => normaliseCountryName(country).includes("turkiye"), "TÃ¼rkiye"),
    turkiye: byLooseName((country) => normaliseCountryName(country).includes("turkiye"), "TÃ¼rkiye"),
    "türkiye": byLooseName((country) => normaliseCountryName(country).includes("turkiye"), "TÃ¼rkiye"),
    usa: "United States",
    "united states of america": "United States",
    "dr congo": "DR Congo",
    "congo dr": "DR Congo",
    "democratic republic of congo": "DR Congo",
    "democratic republic of the congo": "DR Congo",
    "bosnia herzegovina": "Bosnia and Herzegovina",
    "cabo verde": "Cape Verde",
    "cape verde islands": "Cape Verde",
    "curacao": byLooseName((country) => normaliseCountryName(country).startsWith("curacao"), "Curacao")
  };

  for (const [alias, country] of Object.entries(aliases)) {
    map.set(normaliseCountryName(alias), country);
  }

  return map;
}

function tokenFor() {
  return crypto.randomBytes(18).toString("base64url");
}
