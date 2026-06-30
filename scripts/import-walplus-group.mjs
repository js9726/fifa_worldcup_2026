import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://fifa-worldcup-2026-sweepstake.vercel.app").replace(
  /\/+$/,
  ""
);

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Put it in .env.local or the shell before running import.");
  process.exit(1);
}

const DEFAULT_GROUP_SLUG = "world-cup-2026";
const DEFAULT_GROUP_NAME = "World Cup Sweepstake 2026";
const GROUP_NAME = "WALPLUS World Cup 2026";
const GROUP_SLUG = "walplus-world-cup-2026";
const PRIZE_POOL_AMOUNT = 400;
const CHAMPION_PRIZE_AMOUNT = 240;
const RUNNER_UP_PRIZE_AMOUNT = 120;
const WOODEN_SPOON_PRIZE_AMOUNT = 40;
const ASSIGNMENTS = [
  { name: "Ada", teams: ["England", "Senegal", "Panama", "Scotland", "Iraq"] },
  { name: "Jie Sheng", teams: ["Turkiye", "Ecuador", "Ghana", "Belgium", "Switzerland"] },
  { name: "Li Anne", teams: ["France", "Australia", "Korea Republic", "South Africa", "Algeria"] },
  { name: "Yo", teams: ["Germany", "Croatia", "Norway", "Bosnia and Herzegovina", "Cape Verde"] },
  { name: "Irene", teams: ["Argentina", "Colombia", "Egypt", "Czechia", "DR Congo"] },
  { name: "Keith", teams: ["Spain", "Iran", "Austria", "Tunisia", "Jordan"] },
  { name: "Vyanne", teams: ["Netherlands", "Morocco", "Canada", "Ivory Coast", "Qatar"] },
  { name: "Keon", teams: ["Portugal", "Uruguay", "USA", "Paraguay", "Saudi Arabia"] },
  { name: "Bernard", teams: ["Brazil", "Japan", "Mexico", "Sweden", "Uzbekistan"] }
];

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
await ensureGroupSchema(sql);

const countries = await sql`select id, country, pot_id from teams order by country`;
const countryMap = buildCountryMap(countries.map((country) => country.country));
const countryByName = new Map(countries.map((country) => [country.country, country]));
const prepared = ASSIGNMENTS.map((assignment) => ({
  name: assignment.name,
  teams: assignment.teams.map((team) => {
    const canonical = countryMap.get(normaliseCountryName(team));
    const row = canonical ? countryByName.get(canonical) : null;
    if (!row) throw new Error(`Unknown country: ${team}`);
    return row;
  })
}));

const seenCountries = new Set();
for (const assignment of prepared) {
  for (const team of assignment.teams) {
    if (seenCountries.has(team.country)) throw new Error(`Duplicate country: ${team.country}`);
    seenCountries.add(team.country);
  }
}

const inviteLinks = await sql.begin(async (tx) => {
  const [group] = await tx`
    insert into sweepstake_groups (
      slug, name, allow_draws, prize_pool_amount, champion_prize_amount,
      runner_up_prize_amount, wooden_spoon_prize_amount
    )
    values (
      ${GROUP_SLUG}, ${GROUP_NAME}, false, ${PRIZE_POOL_AMOUNT}, ${CHAMPION_PRIZE_AMOUNT},
      ${RUNNER_UP_PRIZE_AMOUNT}, ${WOODEN_SPOON_PRIZE_AMOUNT}
    )
    on conflict (slug) do update set
      name = excluded.name,
      allow_draws = excluded.allow_draws,
      prize_pool_amount = excluded.prize_pool_amount,
      champion_prize_amount = excluded.champion_prize_amount,
      runner_up_prize_amount = excluded.runner_up_prize_amount,
      wooden_spoon_prize_amount = excluded.wooden_spoon_prize_amount
    returning id, slug, name
  `;

  const links = [];
  for (const assignment of prepared) {
    const [participant] = await tx`
      insert into participants (pool_id, name, invite_token)
      values (${group.id}, ${assignment.name}, ${tokenFor()})
      on conflict (pool_id, name) do update set name = excluded.name
      returning id, name, invite_token
    `;

    for (const team of assignment.teams) {
      await tx`
        insert into draws (pool_id, participant_id, team_id, pot_id)
        values (${group.id}, ${participant.id}, ${team.id}, ${team.pot_id})
        on conflict (pool_id, team_id) do update set
          participant_id = excluded.participant_id,
          pot_id = excluded.pot_id
      `;
    }

    links.push({
      participant: participant.name,
      url: `${appUrl}/invite/${participant.invite_token}`
    });
  }

  return links;
});

await sql.end();

console.log(`${GROUP_NAME} invite links`);
for (const link of inviteLinks) {
  console.log(`${link.participant}: ${link.url}`);
}

async function ensureGroupSchema(db) {
  await db`
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
  await db`alter table sweepstake_groups add column if not exists allow_draws boolean not null default true`;
  await db`
    alter table sweepstake_groups
      add column if not exists teams_per_participant integer,
      add column if not exists prize_pool_amount numeric(10,2) not null default 600,
      add column if not exists champion_prize_amount numeric(10,2) not null default 360,
      add column if not exists runner_up_prize_amount numeric(10,2) not null default 180,
      add column if not exists wooden_spoon_prize_amount numeric(10,2) not null default 60
  `;
  await db`
    insert into sweepstake_groups (slug, name, allow_draws)
    values (${DEFAULT_GROUP_SLUG}, ${DEFAULT_GROUP_NAME}, true)
    on conflict (slug) do nothing
  `;

  await db`alter table participants add column if not exists pool_id integer references sweepstake_groups(id)`;
  await db`
    update participants
    set pool_id = (select id from sweepstake_groups where slug = ${DEFAULT_GROUP_SLUG})
    where pool_id is null
  `;
  await db`alter table participants alter column pool_id set not null`;

  await db`alter table draws add column if not exists pool_id integer references sweepstake_groups(id)`;
  await db`
    update draws d
    set pool_id = p.pool_id
    from participants p
    where d.participant_id = p.id
      and d.pool_id is null
  `;
  await db`alter table draws alter column pool_id set not null`;

  await db`alter table bet_offers add column if not exists pool_id integer references sweepstake_groups(id)`;
  await db`
    update bet_offers o
    set pool_id = p.pool_id
    from participants p
    where o.creator_participant_id = p.id
      and o.pool_id is null
  `;
  await db`alter table bet_offers alter column pool_id set not null`;

  await db`alter table participants drop constraint if exists participants_name_key`;
  await db`alter table draws drop constraint if exists draws_participant_id_pot_id_key`;
  await db`alter table draws drop constraint if exists draws_team_id_key`;
  await db`create unique index if not exists participants_pool_name_unique on participants(pool_id, name)`;
  await db`create unique index if not exists draws_pool_team_unique on draws(pool_id, team_id)`;
  await db`create index if not exists draws_pool_participant_idx on draws(pool_id, participant_id)`;
  await db`create index if not exists bet_offers_pool_id_idx on bet_offers(pool_id)`;
}

function tokenFor() {
  return crypto.randomBytes(18).toString("base64url");
}

function normaliseCountryName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildCountryMap(countries) {
  const map = new Map(countries.map((country) => [normaliseCountryName(country), country]));
  const byLooseName = (matcher, fallback) => countries.find(matcher) ?? fallback;
  const aliases = {
    "ivory coast": "Cote d'Ivoire",
    "cote d ivoire": "Cote d'Ivoire",
    "south korea": "Korea Republic",
    "republic of korea": "Korea Republic",
    turkey: byLooseName((country) => normaliseCountryName(country).includes("turkiye"), "TÃ¼rkiye"),
    turkiye: byLooseName((country) => normaliseCountryName(country).includes("turkiye"), "TÃ¼rkiye"),
    usa: "United States",
    "united states of america": "United States",
    "dr congo": "DR Congo",
    "democratic republic of congo": "DR Congo",
    "bosnia herzegovina": "Bosnia and Herzegovina",
    "cabo verde": "Cape Verde"
  };

  for (const [alias, country] of Object.entries(aliases)) {
    map.set(normaliseCountryName(alias), country);
  }
  return map;
}

async function loadDotEnvLocal() {
  try {
    const envFile = await fs.readFile(path.join(root, ".env.local"), "utf8");
    for (const rawLine of envFile.split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, "");
      const match = line.match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Vercel and CI provide env vars directly.
  }
}
