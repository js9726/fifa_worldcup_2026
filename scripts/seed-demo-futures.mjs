import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Add a local/dev database URL to .env.local before seeding demo futures.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: shouldUseSsl(databaseUrl) ? "require" : false, max: 1 });
const groupSlug = "demo-progressive-futures";
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const now = new Date();

await assertBaseSchema(sql);
const inviteLinks = await sql.begin(async (tx) => {
  await ensureFuturesSchema(tx);

  const [group] = await tx`
    insert into sweepstake_groups (
      slug, name, allow_draws, teams_per_participant, prize_pool_amount, champion_prize_amount,
      runner_up_prize_amount, wooden_spoon_prize_amount
    )
    values (${groupSlug}, 'Local Demo - Progressive Futures', false, 4, 600, 360, 180, 60)
    on conflict (slug) do update set
      name = excluded.name,
      allow_draws = excluded.allow_draws,
      teams_per_participant = excluded.teams_per_participant
    returning id, slug
  `;

  const participants = {};
  for (const name of ["SK", "LK", "YK", "HY", "CY", "KL", "CC", "SY", "JL", "BS"]) {
    const [participant] = await tx`
      insert into participants (pool_id, name, invite_token)
      values (${group.id}, ${name}, ${tokenFor()})
      on conflict (pool_id, name) do update set name = excluded.name
      returning id, name, invite_token
    `;
    participants[name] = participant;
  }

  await tx`delete from fixtures where stage = 'Participant Demo Futures' and venue = 'Local demo'`;
  const [participantDemoFixture] = await tx`
    insert into fixtures (kickoff, stage, home_country, away_country, venue)
    values (${hoursFromNow(30).toISOString()}, 'Participant Demo Futures', 'Portugal', 'Netherlands', 'Local demo')
    returning id, home_country, away_country
  `;

  await tx`delete from futures_markets where pool_id = ${group.id}`;

  const finalJackpot = await insertMarket(tx, group.id, {
    title: "World Cup Winner Jackpot",
    marketType: "world_cup_winner",
    settlementBasis: "manual",
    opensAt: hoursFromNow(360),
    closesAt: hoursFromNow(384),
    rolloverAmount: 230,
    autoCreated: false,
    closeDescription: "Final jackpot opens for 1 day and closes 5 hours before the final.",
    lossRule: "Wrong picks lose. Rollover money from failed event pools boosts this group jackpot.",
    options: ["France", "Argentina", "Brazil", "England", "Morocco"]
  });

  await insertMarket(tx, group.id, {
    title: "SK event: Portugal v Netherlands 90-min result",
    marketType: "match_1x2",
    settlementBasis: "ninety_minutes",
    creator: participants.SK,
    fixtureId: participantDemoFixture.id,
    opensAt: hoursFromNow(-1),
    closesAt: hoursFromNow(29),
    rolloverTargetMarketId: finalJackpot.id,
    autoCreated: false,
    closeDescription: "Created by SK. Opens immediately and closes 1 hour before kickoff. Settled on the 90-minute score only.",
    lossRule: "Wrong picks lose. If nobody wins, or if only part is paid, the rest rolls into World Cup Winner Jackpot.",
    options: ["Portugal win", "Draw", "Netherlands win"],
    entries: [
      { participant: participants.SK, optionLabel: "Portugal win", amount: 20 },
      { participant: participants.LK, optionLabel: "Draw", amount: 30 }
    ]
  });

  await insertMarket(tx, group.id, {
    title: "England v DR Congo: who advances?",
    marketType: "match_advance",
    settlementBasis: "advance_winner",
    opensAt: hoursFromNow(-1),
    closesAt: hoursFromNow(20),
    rolloverTargetMarketId: finalJackpot.id,
    autoCreated: true,
    closeDescription: "Betting opens for 1 day and closes 5 hours before kickoff.",
    lossRule: "Wrong picks lose. If nobody picks the advancing team, every stake rolls into World Cup Winner Jackpot.",
    options: ["England advances", "DR Congo advances"],
    entries: [
      { participant: participants.SK, optionLabel: "England advances", amount: 50 },
      { participant: participants.LK, optionLabel: "DR Congo advances", amount: 20 },
      { participant: participants.YK, optionLabel: "England advances", amount: 30 }
    ]
  });

  await insertMarket(tx, group.id, {
    title: "Brazil v Morocco: who advances?",
    marketType: "match_advance",
    settlementBasis: "advance_winner",
    opensAt: hoursFromNow(-1),
    closesAt: hoursFromNow(22),
    rolloverTargetMarketId: finalJackpot.id,
    autoCreated: true,
    closeDescription: "Popular knockout game only. Betting opens for 1 day and closes 5 hours before kickoff.",
    lossRule: "Wrong picks lose. If nobody picks the advancing team, every stake rolls into World Cup Winner Jackpot.",
    options: ["Brazil advances", "Morocco advances"],
    entries: [
      { participant: participants.HY, optionLabel: "Brazil advances", amount: 30 },
      { participant: participants.CY, optionLabel: "Morocco advances", amount: 50 },
      { participant: participants.KL, optionLabel: "Morocco advances", amount: 20 }
    ]
  });

  await insertMarket(tx, group.id, {
    title: "Next country to reach Round of 16",
    marketType: "stage_qualifier",
    settlementBasis: "advance_winner",
    opensAt: hoursFromNow(3),
    closesAt: hoursFromNow(27),
    rolloverTargetMarketId: finalJackpot.id,
    autoCreated: true,
    closeDescription: "Stage market opens for 1 day and closes before the first relevant kickoff.",
    lossRule: "Wrong picks lose. If none of these countries qualify, the pot rolls into World Cup Winner Jackpot.",
    options: ["Switzerland", "Algeria", "Australia", "Egypt"]
  });

  await insertMarket(tx, group.id, {
    title: "CC event: Round of 16 cold option example",
    marketType: "stage_qualifier",
    settlementBasis: "manual",
    creator: participants.CC,
    fixtureId: participantDemoFixture.id,
    opensAt: hoursFromNow(-48),
    closesAt: hoursFromNow(-24),
    rolloverTargetMarketId: finalJackpot.id,
    autoCreated: false,
    closeDescription: "Settled as a half-winner example. The unpaid half feeds the jackpot.",
    lossRule: "Only half the pool paid the correct option; the remaining RM50 rolls into World Cup Winner Jackpot.",
    status: "settled",
    settledOptionLabel: "Haiti reaches Round of 16",
    payoutRate: 0.5,
    options: ["Portugal reaches Round of 16", "Netherlands reaches Round of 16", "Haiti reaches Round of 16"],
    entries: [
      { participant: participants.CC, optionLabel: "Haiti reaches Round of 16", amount: 50 },
      { participant: participants.SY, optionLabel: "Portugal reaches Round of 16", amount: 50 }
    ]
  });

  await insertMarket(tx, group.id, {
    title: "Belgium v Senegal: who advances?",
    marketType: "match_advance",
    settlementBasis: "advance_winner",
    opensAt: hoursFromNow(-72),
    closesAt: hoursFromNow(-48),
    rolloverTargetMarketId: finalJackpot.id,
    autoCreated: true,
    closeDescription: "Closed 5 hours before kickoff, settled from full-match advancement.",
    lossRule: "Wrong picks lose and pay the correct side.",
    status: "settled",
    settledOptionLabel: "Belgium advances",
    options: ["Belgium advances", "Senegal advances"],
    entries: [
      { participant: participants.CC, optionLabel: "Belgium advances", amount: 50 },
      { participant: participants.SY, optionLabel: "Senegal advances", amount: 30 },
      { participant: participants.KL, optionLabel: "Belgium advances", amount: 20 }
    ]
  });

  await insertMarket(tx, group.id, {
    title: "Underdog to reach quarter-final",
    marketType: "stage_qualifier",
    settlementBasis: "advance_winner",
    opensAt: hoursFromNow(-96),
    closesAt: hoursFromNow(-72),
    rolloverTargetMarketId: finalJackpot.id,
    autoCreated: true,
    closeDescription: "Closed before the stage started. No one picked the correct underdog.",
    lossRule: "Nobody picked Scotland, so every entry lost and the whole pot feeds the jackpot.",
    status: "rolled_over",
    settledOptionLabel: "Scotland",
    options: ["Haiti", "Scotland", "Cape Verde"],
    entries: [
      { participant: participants.HY, optionLabel: "Haiti", amount: 30 },
      { participant: participants.CY, optionLabel: "Cape Verde", amount: 50 }
    ]
  });

  return Object.values(participants)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((participant) => ({
      name: participant.name,
      url: `${appUrl}/invite/${participant.invite_token}`
    }));
});

await sql.end();

const lines = [
  "Local Demo Progressive Futures Invite Links",
  "Do not commit or share this whole file publicly.",
  "",
  ...inviteLinks.map((link) => `${link.name}: ${link.url}`)
];
await fs.writeFile(path.join(root, "demo-futures-invite-links.txt"), `${lines.join("\n")}\n`, "utf8");

console.log(`Seeded ${groupSlug} with ${inviteLinks.length} demo participants.`);
console.log("Wrote demo-futures-invite-links.txt");
console.log(inviteLinks.map((link) => `${link.name}: ${link.url}`).join("\n"));

async function insertMarket(tx, groupId, input) {
  const [market] = await tx`
    insert into futures_markets (
      pool_id, creator_participant_id, fixture_id, title, market_type, settlement_basis, status,
      opens_at, closes_at, settled_option_id, rollover_amount, rollover_target_market_id,
      auto_created, open_window_note, loss_rule
    )
    values (
      ${groupId}, ${input.creator?.id || null}, ${input.fixtureId || null}, ${input.title},
      ${input.marketType}, ${input.settlementBasis}, ${input.status || "open"},
      ${input.opensAt.toISOString()}, ${input.closesAt.toISOString()}, null,
      ${input.rolloverAmount || 0}, ${input.rolloverTargetMarketId || null},
      ${Boolean(input.autoCreated)}, ${input.closeDescription}, ${input.lossRule}
    )
    returning id
  `;

  const options = {};
  for (const [index, label] of input.options.entries()) {
    const [option] = await tx`
      insert into futures_options (market_id, label, sort_order)
      values (${market.id}, ${label}, ${index})
      returning id, label
    `;
    options[label] = option;
  }

  if (input.settledOptionLabel) {
    await tx`
      update futures_markets
      set settled_option_id = ${options[input.settledOptionLabel].id}, settled_at = now()
      where id = ${market.id}
    `;
  }

  for (const entry of input.entries || []) {
    const option = options[entry.optionLabel];
    const payout = payoutForEntry(input, entry);
    await tx`
      insert into futures_entries (
        market_id, option_id, participant_id, amount, status, result, payout_amount
      )
      values (
        ${market.id}, ${option.id}, ${entry.participant.id}, ${entry.amount},
        ${input.status === "settled" || input.status === "rolled_over" ? "settled" : "active"},
        ${entryResult(input, entry)}, ${payout}
      )
    `;
  }

  return market;
}

function payoutForEntry(input, entry) {
  if (input.status !== "settled" || !input.settledOptionLabel) return 0;
  if (entry.optionLabel !== input.settledOptionLabel) return 0;
  const payoutRate = input.payoutRate ?? 1;
  const totalPot = (input.entries || []).reduce((total, item) => total + item.amount, 0) + (input.rolloverAmount || 0);
  const winningStake = (input.entries || [])
    .filter((item) => item.optionLabel === input.settledOptionLabel)
    .reduce((total, item) => total + item.amount, 0);
  return Math.round((entry.amount / winningStake) * totalPot * payoutRate * 100) / 100;
}

function entryResult(input, entry) {
  if (input.status === "rolled_over") return "rollover";
  if (input.status === "settled") {
    if (entry.optionLabel !== input.settledOptionLabel) return "loss";
    return input.payoutRate && input.payoutRate < 1 ? "partial_win" : "win";
  }
  return "pending";
}

async function assertBaseSchema(sql) {
  const requiredTables = ["sweepstake_groups", "participants", "teams", "fixtures"];
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `;
  const found = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !found.has(table));
  if (missing.length) {
    console.error(`Missing base tables: ${missing.join(", ")}. Run npm.cmd run setup:db first.`);
    process.exit(1);
  }
}

async function ensureFuturesSchema(tx) {
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
  await tx`create index if not exists futures_markets_pool_id_idx on futures_markets(pool_id)`;
  await tx`create index if not exists futures_markets_creator_participant_id_idx on futures_markets(creator_participant_id)`;
  await tx`create index if not exists futures_markets_fixture_id_idx on futures_markets(fixture_id)`;
  await tx`create index if not exists futures_options_market_id_idx on futures_options(market_id)`;
  await tx`create index if not exists futures_entries_market_id_idx on futures_entries(market_id)`;
  await tx`create index if not exists futures_entries_participant_id_idx on futures_entries(participant_id)`;
}

function hoursFromNow(hours) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function tokenFor() {
  return crypto.randomBytes(18).toString("base64url");
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
    // Environment variables may be provided by the shell.
  }
}

function shouldUseSsl(value) {
  try {
    const { hostname } = new URL(value);
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return true;
  }
}
