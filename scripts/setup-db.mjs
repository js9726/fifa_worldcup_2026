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

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });

const tokenFor = () => crypto.randomBytes(18).toString("base64url");

await sql.begin(async (tx) => {
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
      name text not null unique,
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
      participant_id integer not null references participants(id) on delete cascade,
      team_id integer not null references teams(id) on delete restrict,
      pot_id integer not null references pots(id),
      drawn_at timestamptz not null default now(),
      unique(participant_id, pot_id),
      unique(team_id)
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
      insert into participants (name, invite_token)
      values (${name}, ${tokenFor()})
      on conflict (name) do nothing
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
  select name, invite_token
  from participants
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
