import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";
import { ahOutcome, settleForAccepter } from "./settlement.mjs";

const root = process.cwd();
const SELFTEST = process.argv.includes("--selftest");
const DRY_RUN = process.argv.includes("--dry-run");

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
  "cape verde islands": "Cape Verde",
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

function resolveMatchWinner(match) {
  if (match.score?.winner === "HOME_TEAM") return "HOME";
  if (match.score?.winner === "AWAY_TEAM") return "AWAY";

  const homeScore = match.score?.fullTime?.home;
  const awayScore = match.score?.fullTime?.away;
  if (typeof homeScore === "number" && typeof awayScore === "number" && homeScore !== awayScore) {
    return homeScore > awayScore ? "HOME" : "AWAY";
  }

  if (match.score?.winner === "DRAW") return "DRAW";
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
  expect(
    "unequal full-time score supplies knockout winner when provider winner is draw/missing",
    resolveMatchWinner({ score: { winner: "DRAW", fullTime: { home: 4, away: 5 } } }) === "AWAY"
  );

  // --- Bet settlement maths -------------------------------------------------
  expect("AH adjusted +0.5 -> win", ahOutcome(0.5) === "win");
  expect("AH adjusted +0.25 -> half win", ahOutcome(0.25) === "half_win");
  expect("AH adjusted 0 -> push", ahOutcome(0) === "push");
  expect("AH adjusted -0.25 -> half loss", ahOutcome(-0.25) === "half_loss");
  expect("AH adjusted -1 -> loss", ahOutcome(-1) === "loss");

  const winnerFixture = {
    homeCountry: "Argentina",
    awayCountry: "France",
    fullHome: 3,
    fullAway: 3,
    ninetyHome: 2,
    ninetyAway: 2,
    overallWinner: "HOME"
  };
  const advanceLoss = settleForAccepter(
    { market: "winner", creatorSide: "Argentina", settlementBasis: "advance_winner" },
    winnerFixture
  );
  expect("advance winner: accepter loses when backed side advances", advanceLoss?.result === "loss" && advanceLoss?.deltaFactor === -1);
  const ninetyVoid = settleForAccepter(
    { market: "winner", creatorSide: "Argentina", settlementBasis: "ninety_minutes" },
    winnerFixture
  );
  expect("90-min winner: a 90-min draw voids the winner bet", ninetyVoid?.result === "void");

  const ahFixture = { homeCountry: "Spain", awayCountry: "Cape Verde", fullHome: 4, fullAway: 0, ninetyHome: 4, ninetyAway: 0 };
  const ahLoss = settleForAccepter(
    { market: "asian_handicap", handicapTeam: "Spain", handicapLine: -1.5, settlementBasis: "ninety_minutes" },
    ahFixture
  );
  expect("AH -1.5 covered: accepter loses", ahLoss?.result === "loss" && ahLoss?.deltaFactor === -1);

  const ahPush = settleForAccepter(
    { market: "asian_handicap", handicapTeam: "United States", handicapLine: 0, settlementBasis: "ninety_minutes" },
    { homeCountry: "United States", awayCountry: "Paraguay", ninetyHome: 2, ninetyAway: 2, fullHome: 2, fullAway: 2 }
  );
  expect("AH level ball drawn: void/refund", ahPush?.result === "void" && ahPush?.deltaFactor === 0);

  const ahHalf = settleForAccepter(
    { market: "asian_handicap", handicapTeam: "Sweden", handicapLine: -0.75, settlementBasis: "ninety_minutes" },
    { homeCountry: "Sweden", awayCountry: "Tunisia", ninetyHome: 1, ninetyAway: 0, fullHome: 1, fullAway: 0 }
  );
  expect("AH -0.75 won by one: accepter half loss", ahHalf?.result === "half_loss" && ahHalf?.deltaFactor === -0.5);

  const held = settleForAccepter(
    { market: "asian_handicap", handicapTeam: "Brazil", handicapLine: -0.5, settlementBasis: "ninety_minutes" },
    { homeCountry: "Brazil", awayCountry: "Haiti", ninetyHome: null, ninetyAway: null, fullHome: 2, fullAway: 0 }
  );
  expect("missing 90-min score holds the slip (null)", held === null);
  const ahIgnoresAdvance = settleForAccepter(
    { market: "asian_handicap", handicapTeam: "Paraguay", handicapLine: 1.5, settlementBasis: "advance_winner" },
    { homeCountry: "Germany", awayCountry: "Paraguay", ninetyHome: 4, ninetyAway: 2, fullHome: 4, fullAway: 5 }
  );
  expect("AH settlement ignores advance-winner basis and uses 90-min score", ahIgnoresAdvance?.result === "win");

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

if (!token) {
  console.log("FOOTBALL_DATA_TOKEN is not set. Skipping result sync without changing Neon.");
  process.exit(0);
}

if (!DRY_RUN && !databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
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
  // Regular-time (90') score for `ninety_minutes` settlement. Falls back to the
  // full-time score when the match never went past regulation.
  ninetyHome: m.score?.regularTime?.home ?? (m.score?.duration === "REGULAR" ? m.score?.fullTime?.home ?? null : null),
  ninetyAway: m.score?.regularTime?.away ?? (m.score?.duration === "REGULAR" ? m.score?.fullTime?.away ?? null : null),
  winner: resolveMatchWinner(m)
}));

const statusCounts = matches.reduce((acc, match) => {
  acc[match.status] = (acc[match.status] ?? 0) + 1;
  return acc;
}, {});
const resolvedMatchCount = matches.filter((match) => match.home && match.away).length;
const fullTimeScoreCount = matches.filter((match) => match.homeScore !== null && match.awayScore !== null).length;
const finishedMatchCount = matches.filter((match) => match.status === "FINISHED").length;
const finishedWithScoreCount = matches.filter(
  (match) => match.status === "FINISHED" && match.homeScore !== null && match.awayScore !== null
).length;

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

if (DRY_RUN) {
  console.log(`[dry-run] competition ${competition}: ${matches.length} matches`, statusCounts);
  console.log(`[dry-run] ${resolvedMatchCount}/${matches.length} matches have both teams resolved to our DB`);
  console.log(
    `[dry-run] ${fullTimeScoreCount}/${matches.length} matches currently have full-time scores; ${finishedWithScoreCount}/${finishedMatchCount} finished matches have scores`
  );
  console.log(`[dry-run] ${stats.size}/48 teams found in standings`);
  console.log(`[dry-run] ${placements.size}/48 teams would be placed (final_rank):`);
  for (const [country, place] of [...placements].sort((a, b) => a[1].finalRank - b[1].finalRank)) {
    console.log(`   #${place.finalRank}  ${country}  (${place.stage})`);
  }
  console.log(unmatchedNames.size ? `[dry-run] UNMATCHED: ${[...unmatchedNames].join(", ")}` : "[dry-run] all team names matched ✓");
  console.log("[dry-run] no database changes were made.");
  process.exit(0);
}

console.log(`football-data.org ${competition}: ${matches.length} match(es)`, statusCounts);
console.log(
  `${resolvedMatchCount}/${matches.length} match(es) resolved to local teams; ${fullTimeScoreCount}/${matches.length} have full-time scores; ${finishedWithScoreCount}/${finishedMatchCount} finished match(es) have scores.`
);

const sql = postgres(databaseUrl, { ssl: "require", max: 1, onnotice: () => undefined });
let fixturesTouched = 0;

await sql.begin(async (tx) => {
  // Idempotent migration so existing databases gain the external-id link.
  await tx`alter table fixtures add column if not exists external_id bigint`;
  await tx`
    alter table fixtures
      add column if not exists regular_home_score integer,
      add column if not exists regular_away_score integer,
      add column if not exists regular_score_manual boolean not null default false
  `;
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
          regular_home_score = case
            when fixtures.regular_score_manual then fixtures.regular_home_score
            else coalesce(${match.ninetyHome}, fixtures.regular_home_score)
          end,
          regular_away_score = case
            when fixtures.regular_score_manual then fixtures.regular_away_score
            else coalesce(${match.ninetyAway}, fixtures.regular_away_score)
          end,
          kickoff = ${match.utcDate},
          stage = ${stageLabel},
          home_country = ${match.home},
          away_country = ${match.away},
          venue = case when ${venue} = 'TBD' then fixtures.venue else ${venue} end
      where external_id = ${match.externalId}
    `;

    if (result.count === 0) {
      result = await tx`
        update fixtures
        set external_id = ${match.externalId},
            home_score = ${match.homeScore},
            away_score = ${match.awayScore},
            regular_home_score = case
              when fixtures.regular_score_manual then fixtures.regular_home_score
              else coalesce(${match.ninetyHome}, fixtures.regular_home_score)
            end,
            regular_away_score = case
              when fixtures.regular_score_manual then fixtures.regular_away_score
              else coalesce(${match.ninetyAway}, fixtures.regular_away_score)
            end,
            kickoff = ${match.utcDate},
            stage = ${stageLabel},
            venue = case when ${venue} = 'TBD' then fixtures.venue else ${venue} end
        where external_id is null
          and home_country = ${match.home}
          and away_country = ${match.away}
      `;
    }

    if (result.count === 0) {
      result = await tx`
        insert into fixtures (
          external_id, kickoff, stage, home_country, away_country, venue,
          home_score, away_score, regular_home_score, regular_away_score
        )
        values (
          ${match.externalId}, ${match.utcDate}, ${stageLabel}, ${match.home}, ${match.away}, ${venue},
          ${match.homeScore}, ${match.awayScore}, ${match.ninetyHome}, ${match.ninetyAway}
        )
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

// ---------------------------------------------------------------------------
// Settle peer-to-peer bets on finished fixtures. Pending slips are settled once,
// and settled AH slips are corrected if 90-minute score details arrive later.
// ---------------------------------------------------------------------------

let acceptancesSettled = 0;
let acceptancesCorrected = 0;
let offersResolved = 0;
let offersHeld = 0;
let offersAutoClosed = 0;

await sql.begin(async (tx) => {
  await ensureBettingTablesExist(tx);
  await ensureGroupSchemaExist(tx);

  // Close offers nobody accepted once their match has kicked off — betting on a
  // live/finished match is no longer valid. Offers with matched stakes are left
  // for normal settlement.
  const autoClosed = await tx`
    update bet_offers o
    set status = 'closed'
    from fixtures f
    where f.id = o.fixture_id
      and o.status = 'open'
      and f.kickoff <= now()
      and not exists (
        select 1 from bet_acceptances a
        where a.offer_id = o.id and a.status = 'pending'
      )
  `;
  offersAutoClosed = autoClosed.count;

  for (const match of matches) {
    if (match.status !== "FINISHED" || !match.home || !match.away) continue;
    if (match.homeScore === null || match.awayScore === null) continue;

    const fixtureRows = await tx`
      select id, regular_home_score, regular_away_score, regular_score_manual
      from fixtures
      where external_id = ${match.externalId}
      limit 1
    `;
    if (!fixtureRows.length) continue;
    const fixtureId = fixtureRows[0].id;

    const offers = await tx`
      select id, market, creator_side, opponent_side, settlement_basis, handicap_team, handicap_line, status
      from bet_offers
      where fixture_id = ${fixtureId}
        and (
          status in ('open', 'filled')
          or (status = 'settled' and market = 'asian_handicap')
        )
    `;
    if (!offers.length) continue;

    const fixtureForSettle = {
      homeCountry: match.home,
      awayCountry: match.away,
      fullHome: match.homeScore,
      fullAway: match.awayScore,
      ninetyHome: fixtureRows[0].regular_score_manual
        ? fixtureRows[0].regular_home_score
        : match.ninetyHome ?? fixtureRows[0].regular_home_score,
      ninetyAway: fixtureRows[0].regular_score_manual
        ? fixtureRows[0].regular_away_score
        : match.ninetyAway ?? fixtureRows[0].regular_away_score,
      overallWinner: match.winner
    };

    for (const offer of offers) {
      const outcome = settleForAccepter(
        {
          market: offer.market,
          creatorSide: offer.creator_side,
          settlementBasis: offer.settlement_basis,
          handicapTeam: offer.handicap_team,
          handicapLine: offer.handicap_line === null ? null : Number(offer.handicap_line)
        },
        fixtureForSettle
      );

      if (!outcome) {
        offersHeld += 1; // not enough provider detail yet — leave for the next run / manual
        continue;
      }

      const settlementCandidates = await tx`
        select id, amount, status, result, ledger_delta
        from bet_acceptances
        where offer_id = ${offer.id}
          and status in ('pending', 'settled')
      `;

      for (const acceptance of settlementCandidates) {
        const delta = Math.round(outcome.deltaFactor * Number(acceptance.amount) * 100) / 100;
        const existingDelta = Math.round(Number(acceptance.ledger_delta) * 100) / 100;
        const isCorrection =
          acceptance.status === "settled" && (acceptance.result !== outcome.result || existingDelta !== delta);
        const isNewSettlement = acceptance.status === "pending";
        if (!isNewSettlement && !isCorrection) continue;

        await tx`
          update bet_acceptances
          set status = 'settled', result = ${outcome.result}, ledger_delta = ${delta}
          where id = ${acceptance.id}
        `;
        if (isNewSettlement) acceptancesSettled += 1;
        if (isCorrection) acceptancesCorrected += 1;
      }

      await tx`
        update bet_offers set status = ${settlementCandidates.length ? "settled" : "closed"} where id = ${offer.id}
      `;
      offersResolved += 1;
    }
  }
});

await sql.end();

console.log(
  `Synced ${fixturesTouched} fixture row(s) and placed ${placements.size}/48 team(s) from football-data.org (${competition}).`
);
console.log(
  `Settled ${acceptancesSettled} bet slip(s), corrected ${acceptancesCorrected} settled slip(s), across ${offersResolved} offer(s); ${offersHeld} offer(s) held for more data; auto-closed ${offersAutoClosed} unaccepted offer(s) past kickoff.`
);
if (finishedMatchCount > finishedWithScoreCount) {
  console.log(
    `Provider note: ${finishedMatchCount - finishedWithScoreCount} finished match(es) did not include full-time scores yet. The next scheduled run will retry.`
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function ensureBettingTablesExist(tx) {
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
}

async function ensureGroupSchemaExist(tx) {
  const defaultGroupSlug = "world-cup-2026";
  const defaultGroupName = "World Cup Sweepstake 2026";

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
    values (${defaultGroupSlug}, ${defaultGroupName}, true)
    on conflict (slug) do nothing
  `;

  await tx`alter table participants add column if not exists pool_id integer references sweepstake_groups(id)`;
  await tx`
    update participants
    set pool_id = (select id from sweepstake_groups where slug = ${defaultGroupSlug})
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
}

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
      const match = line.trim().match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // GitHub Actions and Vercel provide env vars directly.
  }
}
