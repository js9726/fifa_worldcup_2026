import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
const SELFTEST = process.argv.includes("--selftest");

// ---------------------------------------------------------------------------
// Country name mapping: football-data.org -> our DB country names.
// ---------------------------------------------------------------------------

// The 48 countries exactly as stored in the teams table.
const DB_COUNTRIES = [
  "Algeria", "Argentina", "Australia", "Austria", "Belgium",
  "Bosnia and Herzegovina", "Brazil", "Canada", "Cape Verde", "Colombia",
  "Cote d'Ivoire", "Croatia", "Curacao", "Czechia", "DR Congo",
  "Ecuador", "Egypt", "England", "France", "Germany", "Ghana", "Haiti",
  "Iran", "Iraq", "Japan", "Jordan", "Korea Republic", "Mexico", "Morocco",
  "Netherlands", "New Zealand", "Norway", "Panama", "Paraguay", "Portugal",
  "Qatar", "Saudi Arabia", "Scotland", "Senegal", "South Africa", "Spain",
  "Sweden", "Switzerland", "Tunisia", "Türkiye", "United States", "Uruguay",
  "Uzbekistan"
];

function normalise(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // strip diacritics (combining marks)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Normalised alias -> DB country, for names that don't normalise to the same string.
const ALIASES = {
  "ivory coast": "Cote d'Ivoire",
  "czech republic": "Czechia",
  "south korea": "Korea Republic",
  "republic of korea": "Korea Republic",
  "korea south": "Korea Republic",
  turkey: "Türkiye",
  turkiye: "Türkiye",
  "cabo verde": "Cape Verde",
  usa: "United States",
  "united states of america": "United States",
  "congo dr": "DR Congo",
  "dr congo": "DR Congo",
  "democratic republic of congo": "DR Congo",
  "democratic republic of the congo": "DR Congo",
  "bosnia herzegovina": "Bosnia and Herzegovina",
  "iran islamic republic of": "Iran",
  "ir iran": "Iran"
};

const NORMALISED_DB = new Map(DB_COUNTRIES.map((c) => [normalise(c), c]));
const unmatchedNames = new Set();

function resolveCountry(rawName) {
  if (!rawName) return null;
  const key = normalise(rawName);
  if (NORMALISED_DB.has(key)) return NORMALISED_DB.get(key);
  if (ALIASES[key]) return ALIASES[key];
  unmatchedNames.add(rawName);
  return null;
}

// ---------------------------------------------------------------------------
// Stage labels and ranking bands.
// ---------------------------------------------------------------------------

const STAGE_LABELS = {
  GROUP_STAGE: "Group stage",
  LAST_32: "Round of 32",
  LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals",
  SEMI_FINALS: "Semi-finals",
  THIRD_PLACE: "Third place",
  FINAL: "Final"
};

// Pure ranking logic — exported shape so --selftest can exercise it without I/O.
// matches: [{ stage, status, home, away, winner }]  (home/away already resolved to DB names or null)
// stats:   Map<country, { points, gd, gf }>
// Returns Map<country, { finalRank, stage, note }> for every team we can place.
function computePlacements(matches, stats) {
  const finished = matches.filter((m) => m.status === "FINISHED");
  const determined = (m) => Boolean(m.home && m.away);
  const winnerOf = (m) => (m.winner === "HOME" ? m.home : m.winner === "AWAY" ? m.away : null);
  const loserOf = (m) => (m.winner === "HOME" ? m.away : m.winner === "AWAY" ? m.home : null);
  const losersAt = (stage) =>
    finished
      .filter((m) => m.stage === stage && determined(m) && loserOf(m))
      .map(loserOf);

  const placement = new Map();

  const orderByPerformance = (countries) =>
    [...countries].sort((a, b) => {
      const sa = stats.get(a) ?? { points: 0, gd: 0, gf: 0 };
      const sb = stats.get(b) ?? { points: 0, gd: 0, gf: 0 };
      return sb.points - sa.points || sb.gd - sa.gd || sb.gf - sa.gf || a.localeCompare(b);
    });

  const assignBand = (countries, start, stageLabel, note) => {
    orderByPerformance(countries).forEach((country, index) => {
      placement.set(country, { finalRank: start + index, stage: stageLabel, note });
    });
  };

  // Final (ranks 1 & 2).
  const finalMatch = finished.find((m) => m.stage === "FINAL" && determined(m) && winnerOf(m));
  if (finalMatch) {
    placement.set(winnerOf(finalMatch), { finalRank: 1, stage: "Champion", note: "World Cup champions" });
    placement.set(loserOf(finalMatch), { finalRank: 2, stage: "Runner-up", note: "Runners-up" });
  }

  // Third-place play-off (ranks 3 & 4); fall back to provisional semi-final ordering.
  const thirdMatch = finished.find((m) => m.stage === "THIRD_PLACE" && determined(m) && winnerOf(m));
  if (thirdMatch) {
    placement.set(winnerOf(thirdMatch), { finalRank: 3, stage: "Third place", note: "Third place" });
    placement.set(loserOf(thirdMatch), { finalRank: 4, stage: "Fourth place", note: "Fourth place" });
  } else {
    assignBand(losersAt("SEMI_FINALS"), 3, "Semi-finals", "Reached the semi-finals");
  }

  // Knockout bands.
  assignBand(losersAt("QUARTER_FINALS"), 5, "Quarter-finals", "Out at the quarter-finals");
  assignBand(losersAt("LAST_16"), 9, "Round of 16", "Out at the round of 16");
  assignBand(losersAt("LAST_32"), 17, "Round of 32", "Out at the round of 32");

  // Group-stage exits: known once the round-of-32 bracket is fully populated.
  const advancers = new Set();
  for (const m of matches.filter((m) => m.stage === "LAST_32" && determined(m))) {
    advancers.add(m.home);
    advancers.add(m.away);
  }
  if (advancers.size >= 32) {
    const groupExits = DB_COUNTRIES.filter((c) => !advancers.has(c));
    assignBand(groupExits, 33, "Group stage", "Eliminated in the group stage");
  }

  return placement;
}

// ---------------------------------------------------------------------------
// Self-test: run the ranking logic against a synthetic tournament, no DB/API.
// ---------------------------------------------------------------------------

if (SELFTEST) {
  runSelfTest();
  process.exit(0);
}

function runSelfTest() {
  const groups = []; // 12 groups of 4 = 48 teams
  for (let g = 0; g < 12; g += 1) groups.push(DB_COUNTRIES.slice(g * 4, g * 4 + 4));

  const stats = new Map();
  DB_COUNTRIES.forEach((c, i) => stats.set(c, { points: 48 - i, gd: 48 - i, gf: 48 - i }));

  const matches = [];
  const ko = (stage, home, away, winnerHome) =>
    matches.push({ stage, status: "FINISHED", home, away, winner: winnerHome ? "HOME" : "AWAY" });

  // Top 2 of each group advance -> 24, plus 8 best third-placed = 32.
  const advancers = [];
  for (const grp of groups) advancers.push(grp[0], grp[1]);
  for (let i = 0; i < 8; i += 1) advancers.push(groups[i][2]); // 8 best thirds

  // Round of 32 -> down to the final.
  let alive = advancers.slice(0, 32);
  const playRound = (stage) => {
    const winners = [];
    for (let i = 0; i < alive.length; i += 2) {
      ko(stage, alive[i], alive[i + 1], true);
      winners.push(alive[i]);
    }
    alive = winners;
  };
  playRound("LAST_32");
  playRound("LAST_16");
  playRound("QUARTER_FINALS");
  // Semi-finals: keep both losers for the third-place game.
  const sfLosers = [];
  const sfWinners = [];
  for (let i = 0; i < alive.length; i += 2) {
    ko("SEMI_FINALS", alive[i], alive[i + 1], true);
    sfWinners.push(alive[i]);
    sfLosers.push(alive[i + 1]);
  }
  ko("THIRD_PLACE", sfLosers[0], sfLosers[1], true);
  ko("FINAL", sfWinners[0], sfWinners[1], true);

  const placement = computePlacements(matches, stats);

  const checks = [];
  const expect = (label, cond) => checks.push({ label, ok: Boolean(cond) });

  expect("champion is rank 1", placement.get(sfWinners[0])?.finalRank === 1);
  expect("runner-up is rank 2", placement.get(sfWinners[1])?.finalRank === 2);
  expect("third place is rank 3", placement.get(sfLosers[0])?.finalRank === 3);
  expect("fourth place is rank 4", placement.get(sfLosers[1])?.finalRank === 4);
  expect("all 48 teams placed", placement.size === 48);

  const ranks = [...placement.values()].map((p) => p.finalRank).sort((a, b) => a - b);
  const contiguous = ranks.every((r, i) => r === i + 1);
  expect("ranks are a contiguous 1..48", contiguous);

  const groupExitRanks = DB_COUNTRIES.filter((c) => !advancers.slice(0, 32).includes(c)).map(
    (c) => placement.get(c)?.finalRank
  );
  expect("16 group exits occupy ranks 33..48", groupExitRanks.every((r) => r >= 33 && r <= 48));

  // Name resolution: every DB country must resolve to itself...
  expect("all 48 DB names resolve to themselves", DB_COUNTRIES.every((c) => resolveCountry(c) === c));
  // ...and football-data.org's differing names must map through the alias table.
  const aliasChecks = {
    "Ivory Coast": "Cote d'Ivoire",
    "South Korea": "Korea Republic",
    "Czech Republic": "Czechia",
    Turkey: "Türkiye",
    "Cabo Verde": "Cape Verde",
    "Curaçao": "Curacao",
    "DR Congo": "DR Congo",
    "United States": "United States",
    "Côte d'Ivoire": "Cote d'Ivoire"
  };
  for (const [apiName, dbName] of Object.entries(aliasChecks)) {
    expect(`"${apiName}" -> "${dbName}"`, resolveCountry(apiName) === dbName);
  }

  let failed = 0;
  for (const { label, ok } of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failed += 1;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------------------
// Live sync.
// ---------------------------------------------------------------------------

await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
const token = process.env.FOOTBALL_DATA_TOKEN;
const competition = process.env.FOOTBALL_DATA_COMP || "WC";
const apiBase = "https://api.football-data.org/v4";

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!token) {
  console.log("FOOTBALL_DATA_TOKEN is not set. Skipping result sync without changing Neon.");
  process.exit(0);
}

const matchesRaw = await fetchJson(`${apiBase}/competitions/${competition}/matches`);
const standingsRaw = await fetchJson(`${apiBase}/competitions/${competition}/standings`).catch((error) => {
  console.warn(`Standings unavailable (${error.message}); ranking ties will fall back to alphabetical.`);
  return { standings: [] };
});

// Build the resolved match list and the group-stats map.
const matches = (matchesRaw.matches ?? []).map((m) => ({
  externalId: m.id,
  utcDate: m.utcDate,
  venue: m.venue ?? null,
  stage: m.stage,
  status: m.status,
  home: resolveCountry(m.homeTeam?.name),
  away: resolveCountry(m.awayTeam?.name),
  homeScore: m.score?.fullTime?.home ?? null,
  awayScore: m.score?.fullTime?.away ?? null,
  winner:
    m.score?.winner === "HOME_TEAM"
      ? "HOME"
      : m.score?.winner === "AWAY_TEAM"
        ? "AWAY"
        : m.score?.winner === "DRAW"
          ? "DRAW"
          : null
}));

const stats = new Map();
for (const standing of standingsRaw.standings ?? []) {
  if (standing.type && standing.type !== "TOTAL") continue;
  for (const row of standing.table ?? []) {
    const country = resolveCountry(row.team?.name);
    if (!country) continue;
    stats.set(country, {
      points: Number(row.points) || 0,
      gd: Number(row.goalDifference) || 0,
      gf: Number(row.goalsFor) || 0
    });
  }
}

if (unmatchedNames.size) {
  console.warn(`Unmatched team names (add to ALIASES): ${[...unmatchedNames].join(", ")}`);
}

const placements = computePlacements(matches, stats);

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
let fixturesTouched = 0;

await sql.begin(async (tx) => {
  // Idempotent migration so existing databases gain the external-id link.
  await tx`alter table fixtures add column if not exists external_id bigint`;
  await tx`create unique index if not exists fixtures_external_id_key on fixtures (external_id)`;

  // Upsert fixtures for any match whose two teams are both resolved.
  for (const match of matches) {
    if (!match.home || !match.away) continue;
    const stageLabel = STAGE_LABELS[match.stage] ?? match.stage ?? "Match";
    const venue = match.venue || "TBD";

    let result = await tx`
      update fixtures
      set home_score = ${match.homeScore},
          away_score = ${match.awayScore},
          kickoff = ${match.utcDate},
          stage = ${stageLabel},
          home_country = ${match.home},
          away_country = ${match.away},
          venue = coalesce(nullif(venue, ''), ${venue})
      where external_id = ${match.externalId}
    `;

    if (result.count === 0) {
      result = await tx`
        update fixtures
        set external_id = ${match.externalId},
            home_score = ${match.homeScore},
            away_score = ${match.awayScore},
            kickoff = ${match.utcDate},
            stage = ${stageLabel},
            venue = coalesce(nullif(venue, ''), ${venue})
        where external_id is null
          and home_country = ${match.home}
          and away_country = ${match.away}
      `;
    }

    if (result.count === 0) {
      result = await tx`
        insert into fixtures (external_id, kickoff, stage, home_country, away_country, venue, home_score, away_score)
        values (${match.externalId}, ${match.utcDate}, ${stageLabel}, ${match.home}, ${match.away}, ${venue}, ${match.homeScore}, ${match.awayScore})
        on conflict (external_id) do nothing
      `;
    }

    fixturesTouched += result.count;
  }

  // Write computed final ranks / elimination stages.
  for (const [country, place] of placements) {
    await tx`
      update teams
      set final_rank = ${place.finalRank},
          eliminated_stage = ${place.stage},
          result_note = ${place.note},
          updated_at = now()
      where country = ${country}
    `;
  }
});

await sql.end();

console.log(
  `Synced ${fixturesTouched} fixture row(s) and placed ${placements.size}/48 team(s) from football-data.org (${competition}).`
);

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "X-Auth-Token": token } });
  if (!response.ok) {
    const detail = response.status === 403 || response.status === 429 ? " (check token / rate limit)" : "";
    throw new Error(`${response.status} ${response.statusText}${detail} for ${url}`);
  }
  return response.json();
}

async function loadDotEnvLocal() {
  try {
    const envFile = await fs.readFile(path.join(root, ".env.local"), "utf8");
    for (const rawLine of envFile.split(/\r?\n/)) {
      const line = rawLine.replace(/^﻿/, "");
      const match = line.match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // GitHub Actions and Vercel provide env vars directly.
  }
}
