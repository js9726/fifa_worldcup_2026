import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
const seed = JSON.parse(await fs.readFile(path.join(root, "data.seed.json"), "utf8"));

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

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Put it in .env.local or the shell before running setup.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: shouldUseSsl(databaseUrl) ? "require" : false, max: 1 });

const tokenFor = () => crypto.randomBytes(18).toString("base64url");
const DEFAULT_GROUP_SLUG = "world-cup-2026";
const DEFAULT_GROUP_NAME = "World Cup Sweepstake 2026";

await sql.begin(async (tx) => {
  await tx`
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

  await tx`alter table sweepstake_groups add column if not exists allow_draws boolean not null default true`;
  await tx`
    alter table sweepstake_groups
      add column if not exists teams_per_participant integer,
      add column if not exists prize_pool_amount numeric(10,2) not null default 600,
      add column if not exists champion_prize_amount numeric(10,2) not null default 360,
      add column if not exists runner_up_prize_amount numeric(10,2) not null default 180,
      add column if not exists wooden_spoon_prize_amount numeric(10,2) not null default 60
  `;
  await tx`
    insert into sweepstake_groups (slug, name, allow_draws)
    values (${DEFAULT_GROUP_SLUG}, ${DEFAULT_GROUP_NAME}, true)
    on conflict (slug) do nothing
  `;

  await tx`
    create table if not exists pots (
      id integer primary key,
      name text not null,
      label text not null,
      colour text not null
    )
  `;

  await tx`
    create table if not exists participants (
      id serial primary key,
      pool_id integer not null references sweepstake_groups(id),
      name text not null,
      invite_token text not null unique,
      created_at timestamptz not null default now()
    )
  `;

  await tx`
    create table if not exists teams (
      id serial primary key,
      country text not null unique,
      pot_id integer not null references pots(id),
      flag text not null,
      confed text not null,
      star_player text not null,
      player_role text not null,
      fifa_rank integer not null,
      win_rate numeric(5,2) not null,
      top10_rate numeric(5,2) not null,
      expected_rank integer not null,
      final_rank integer,
      eliminated_stage text,
      result_note text,
      updated_at timestamptz not null default now()
    )
  `;

  await tx`
    create table if not exists draws (
      id serial primary key,
      pool_id integer not null references sweepstake_groups(id),
      participant_id integer not null references participants(id) on delete cascade,
      team_id integer not null references teams(id) on delete restrict,
      pot_id integer not null references pots(id),
      drawn_at timestamptz not null default now()
    )
  `;

  await tx`
    create table if not exists fixtures (
      id serial primary key,
      external_id bigint unique,
      kickoff timestamptz not null,
      stage text not null,
      home_country text not null,
      away_country text not null,
      venue text not null,
      home_score integer,
      away_score integer,
      regular_home_score integer,
      regular_away_score integer,
      regular_score_manual boolean not null default false,
      extra_home_score integer,
      extra_away_score integer,
      score_duration text,
      odds_provider text,
      odds_bookmaker text,
      odds_market text,
      odds_favourite text,
      odds_handicap_line numeric(5,2),
      odds_home_price numeric(10,4),
      odds_away_price numeric(10,4),
      odds_last_updated timestamptz,
      odds_external_event_id text,
      unique(kickoff, home_country, away_country)
    )
  `;

  await tx`
    alter table fixtures
      add column if not exists regular_home_score integer,
      add column if not exists regular_away_score integer,
      add column if not exists regular_score_manual boolean not null default false,
      add column if not exists extra_home_score integer,
      add column if not exists extra_away_score integer,
      add column if not exists score_duration text,
      add column if not exists odds_provider text,
      add column if not exists odds_bookmaker text,
      add column if not exists odds_market text,
      add column if not exists odds_favourite text,
      add column if not exists odds_handicap_line numeric(5,2),
      add column if not exists odds_home_price numeric(10,4),
      add column if not exists odds_away_price numeric(10,4),
      add column if not exists odds_last_updated timestamptz,
      add column if not exists odds_external_event_id text
  `;

  await tx`
    create table if not exists bet_offers (
      id serial primary key,
      pool_id integer not null references sweepstake_groups(id),
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

  await tx`
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

  await tx`
    create table if not exists futures_markets (
      id serial primary key,
      pool_id integer not null references sweepstake_groups(id) on delete cascade,
      creator_participant_id integer references participants(id) on delete set null,
      fixture_id integer references fixtures(id) on delete set null,
      title text not null,
      market_type text not null default 'generic',
      settlement_basis text,
      rollover_target_market_id integer references futures_markets(id),
      auto_created boolean not null default false,
      open_window_note text,
      loss_rule text,
      status text not null default 'open',
      opens_at timestamptz,
      closes_at timestamptz not null,
      settled_option_id integer,
      rollover_amount numeric(10,2) not null default 0,
      created_at timestamptz not null default now(),
      settled_at timestamptz
    )
  `;
  await tx`
    alter table futures_markets
      add column if not exists creator_participant_id integer references participants(id) on delete set null,
      add column if not exists fixture_id integer references fixtures(id) on delete set null,
      add column if not exists settlement_basis text,
      add column if not exists rollover_target_market_id integer references futures_markets(id),
      add column if not exists auto_created boolean not null default false,
      add column if not exists open_window_note text,
      add column if not exists loss_rule text,
      add column if not exists opens_at timestamptz
  `;

  await tx`
    create table if not exists futures_options (
      id serial primary key,
      market_id integer not null references futures_markets(id) on delete cascade,
      label text not null,
      sort_order integer not null default 0,
      unique (market_id, label)
    )
  `;

  await tx`
    create table if not exists futures_entries (
      id serial primary key,
      market_id integer not null references futures_markets(id) on delete cascade,
      option_id integer not null references futures_options(id) on delete cascade,
      participant_id integer not null references participants(id) on delete cascade,
      amount numeric(10,2) not null,
      status text not null default 'active',
      result text not null default 'pending',
      payout_amount numeric(10,2) not null default 0,
      placed_at timestamptz not null default now()
    )
  `;

  await tx`alter table participants add column if not exists pool_id integer references sweepstake_groups(id)`;
  await tx`
    update participants
    set pool_id = (select id from sweepstake_groups where slug = ${DEFAULT_GROUP_SLUG})
    where pool_id is null
  `;
  await tx`alter table participants alter column pool_id set not null`;

  await tx`alter table draws add column if not exists pool_id integer references sweepstake_groups(id)`;
  await tx`
    update draws d
    set pool_id = p.pool_id
    from participants p
    where d.participant_id = p.id
      and d.pool_id is null
  `;
  await tx`alter table draws alter column pool_id set not null`;

  await tx`alter table bet_offers add column if not exists pool_id integer references sweepstake_groups(id)`;
  await tx`
    update bet_offers o
    set pool_id = p.pool_id
    from participants p
    where o.creator_participant_id = p.id
      and o.pool_id is null
  `;
  await tx`alter table bet_offers alter column pool_id set not null`;

  await tx`alter table participants drop constraint if exists participants_name_key`;
  await tx`alter table draws drop constraint if exists draws_participant_id_pot_id_key`;
  await tx`alter table draws drop constraint if exists draws_team_id_key`;
  await tx`create unique index if not exists participants_pool_name_unique on participants(pool_id, name)`;
  await tx`create unique index if not exists draws_pool_team_unique on draws(pool_id, team_id)`;
  await tx`create index if not exists draws_pool_participant_idx on draws(pool_id, participant_id)`;
  await tx`create index if not exists bet_offers_pool_id_idx on bet_offers(pool_id)`;
  await tx`create index if not exists futures_markets_pool_id_idx on futures_markets(pool_id)`;
  await tx`create index if not exists futures_markets_creator_participant_id_idx on futures_markets(creator_participant_id)`;
  await tx`create index if not exists futures_markets_fixture_id_idx on futures_markets(fixture_id)`;
  await tx`create index if not exists futures_options_market_id_idx on futures_options(market_id)`;
  await tx`create index if not exists futures_entries_market_id_idx on futures_entries(market_id)`;
  await tx`create index if not exists futures_entries_participant_id_idx on futures_entries(participant_id)`;

  const [{ id: defaultGroupId }] = await tx`
    select id from sweepstake_groups where slug = ${DEFAULT_GROUP_SLUG} limit 1
  `;

  for (const pot of seed.pots) {
    await tx`
      insert into pots (id, name, label, colour)
      values (${pot.id}, ${pot.name}, ${pot.label}, ${pot.colour})
      on conflict (id) do update set
        name = excluded.name,
        label = excluded.label,
        colour = excluded.colour
    `;
  }

  for (const name of seed.participants) {
    await tx`
      insert into participants (pool_id, name, invite_token)
      values (${defaultGroupId}, ${name}, ${tokenFor()})
      on conflict (pool_id, name) do nothing
    `;
  }

  for (const team of seed.teams) {
    await tx`
      insert into teams (
        country, pot_id, flag, confed, star_player, player_role,
        fifa_rank, win_rate, top10_rate, expected_rank
      )
      values (
        ${team.country}, ${team.potId}, ${team.flag}, ${team.confed},
        ${team.star}, ${team.role}, ${team.fifaRank}, ${team.winRate},
        ${team.top10Rate}, ${team.expectedRank}
      )
      on conflict (country) do update set
        pot_id = excluded.pot_id,
        flag = excluded.flag,
        confed = excluded.confed,
        star_player = excluded.star_player,
        player_role = excluded.player_role,
        fifa_rank = excluded.fifa_rank,
        win_rate = excluded.win_rate,
        top10_rate = excluded.top10_rate,
        expected_rank = excluded.expected_rank,
        updated_at = now()
    `;
  }

  for (const fixture of seed.fixtures) {
    await tx`
      insert into fixtures (kickoff, stage, home_country, away_country, venue)
      values (${fixture.kickoff}, ${fixture.stage}, ${fixture.home}, ${fixture.away}, ${fixture.venue})
      on conflict (kickoff, home_country, away_country) do update set
        stage = excluded.stage,
        venue = excluded.venue
    `;
  }
});

const participants = await sql`
  select p.name, p.invite_token
  from participants p
  join sweepstake_groups g on g.id = p.pool_id
  where g.slug = ${DEFAULT_GROUP_SLUG}
  order by name
`;

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const lines = [
  "FIFA World Cup 2026 Sweepstake Invite Links",
  "Do not commit or share this whole file publicly.",
  ""
];

for (const participant of participants) {
  lines.push(`${participant.name}: ${appUrl}/invite/${participant.invite_token}`);
}

await fs.writeFile(path.join(root, "invite-links.txt"), `${lines.join("\n")}\n`, "utf8");
await sql.end();

console.log(`Seeded ${seed.participants.length} participants, ${seed.teams.length} teams and ${seed.fixtures.length} fixtures.`);
console.log("Wrote invite-links.txt");

function shouldUseSsl(value) {
  try {
    const { hostname } = new URL(value);
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return true;
  }
}
