import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
const STRICT = process.argv.includes("--strict") || process.env.ODDSPAPI_ODDS_STRICT === "true";
const FORCE = process.argv.includes("--force") || process.env.ODDSPAPI_ODDS_FORCE === "true";
const PROVIDER = "OddsPapi";
const DEFAULT_BASE_URL = "https://api.oddspapi.io";
const DEFAULT_SPORT_ID = "10"; // Soccer.
const DEFAULT_TOURNAMENT_SLUG = "world-cup";
const DEFAULT_CATEGORY_SLUG = "international";
const DEFAULT_BOOKMAKERS = "pinnacle,bet365,draftkings,fanduel";
const DEFAULT_MIN_INTERVAL_MINUTES = 360; // Keep free-tier usage modest while refreshing before later kickoffs.
const DEFAULT_LOOKAHEAD_DAYS = 4;
const DEFAULT_MAX_ODDS_FIXTURES = 12;
const DEFAULT_REFRESH_HOURS = 12;
const DEFAULT_REQUEST_DELAY_MS = 1500;
const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const SYNC_META_KEY = "oddspapi_odds_last_attempt";

await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.ODDSPAPI_KEY || process.env.ODDS_PAPI_KEY;
const apiBase = process.env.ODDSPAPI_BASE_URL || DEFAULT_BASE_URL;
const sportId = process.env.ODDSPAPI_SPORT_ID || DEFAULT_SPORT_ID;
const tournamentSlug = process.env.ODDSPAPI_TOURNAMENT_SLUG || DEFAULT_TOURNAMENT_SLUG;
const categorySlug = process.env.ODDSPAPI_CATEGORY_SLUG || DEFAULT_CATEGORY_SLUG;
const bookmakerParam = process.env.ODDSPAPI_BOOKMAKERS || DEFAULT_BOOKMAKERS;
const preferredBookmaker = process.env.ODDSPAPI_BOOKMAKER || "pinnacle";
const minIntervalMinutes = positiveNumber(process.env.ODDSPAPI_ODDS_MIN_INTERVAL_MINUTES, DEFAULT_MIN_INTERVAL_MINUTES);
const lookaheadDays = positiveNumber(process.env.ODDSPAPI_ODDS_LOOKAHEAD_DAYS, DEFAULT_LOOKAHEAD_DAYS);
const maxOddsFixtures = positiveNumber(process.env.ODDSPAPI_ODDS_MAX_FIXTURES, DEFAULT_MAX_ODDS_FIXTURES);
const refreshHours = positiveNumber(process.env.ODDSPAPI_ODDS_REFRESH_HOURS, DEFAULT_REFRESH_HOURS);
const matchToleranceMinutes = positiveNumber(process.env.ODDSPAPI_MATCH_TIME_TOLERANCE_MINUTES, 90);
const requestDelayMs = positiveNumber(process.env.ODDSPAPI_REQUEST_DELAY_MS, DEFAULT_REQUEST_DELAY_MS);
const retryDelayMs = positiveNumber(process.env.ODDSPAPI_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);
const maxRetries = positiveNumber(process.env.ODDSPAPI_MAX_RETRIES, DEFAULT_MAX_RETRIES);
let lastOddsPapiRequestAt = 0;

if (process.argv.includes("--selftest")) {
  runSelfTest();
  process.exit(0);
}

if (!apiKey) {
  console.log("ODDSPAPI_KEY is not set. Skipping trusted AH odds sync; model fallback remains active.");
  process.exit(0);
}

if (!databaseUrl) {
  console.log("DATABASE_URL is not set. Skipping trusted AH odds sync without changing Neon.");
  process.exit(0);
}

try {
  const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
  await ensureOddsColumns(sql);
  await ensureSyncMetadata(sql);

  if (!FORCE && (await wasRecentlyAttempted(sql, minIntervalMinutes))) {
    await sql.end();
    console.log(`Trusted AH odds sync skipped to protect the free OddsPapi quota; last attempt was less than ${minIntervalMinutes} minutes ago.`);
    process.exit(0);
  }

  const fixtures = await sql`
    select
      fixtures.id,
      kickoff::text as kickoff,
      home_country,
      away_country,
      odds_provider,
      odds_last_updated::text as odds_last_updated
    from fixtures
    join teams ht on ht.country = fixtures.home_country
    join teams at on at.country = fixtures.away_country
    where kickoff > now()
      and home_score is null
      and away_score is null
    order by kickoff
  `;

  if (!fixtures.length) {
    await sql.end();
    console.log("No upcoming unscored fixtures found for trusted AH odds sync.");
    process.exit(0);
  }

  const refreshCandidates = fixtures.filter(shouldRefreshFixtureOdds);
  if (!refreshCandidates.length) {
    await sql.end();
    console.log(`Trusted AH odds sync skipped: ${fixtures.length} upcoming fixture(s) already have fresh trusted odds.`);
    process.exit(0);
  }

  await markSyncAttempt(sql);

  const marketCatalog = await fetchAsianHandicapMarketCatalog();
  if (!marketCatalog.size) {
    await sql.end();
    console.log("No OddsPapi Asian Handicap market metadata found; model fallback remains active.");
    process.exit(0);
  }

  const providerFixtures = await fetchWorldCupFixtures(refreshCandidates);
  const matchedProviderFixtures = refreshCandidates
    .map((fixture) => ({
      fixture,
      providerFixture: findMatchingProviderFixture(providerFixtures, fixture, refreshCandidates)
    }))
    .filter((item) => item.providerFixture?.hasOdds)
    .slice(0, maxOddsFixtures);

  let matched = matchedProviderFixtures.length;
  let updated = 0;

  for (const { fixture, providerFixture } of matchedProviderFixtures) {
    const oddsPayload = await fetchOdds(providerFixture.fixtureId);
    const odds = pickAsianHandicap(oddsPayload, fixture, marketCatalog, preferredBookmaker);
    if (!odds) continue;

    await sql`
      update fixtures
      set odds_provider = ${PROVIDER},
          odds_bookmaker = ${odds.bookmaker},
          odds_market = ${odds.market},
          odds_favourite = ${odds.favourite},
          odds_handicap_line = ${odds.line},
          odds_home_price = ${odds.homePrice},
          odds_away_price = ${odds.awayPrice},
          odds_last_updated = ${odds.lastUpdated},
          odds_external_event_id = ${odds.eventId}
      where id = ${fixture.id}
    `;
    updated += 1;
  }

  await sql.end();
  console.log(
    `Trusted AH odds sync complete: ${updated}/${fixtures.length} upcoming fixture(s) updated from ${PROVIDER}; ${refreshCandidates.length} fixture(s) needed refresh; ${matched} provider fixture(s) had odds.`
  );
} catch (error) {
  console.warn(`Trusted AH odds sync skipped after provider/config error: ${error.message}`);
  if (STRICT) process.exit(1);
  process.exit(0);
}

async function ensureOddsColumns(sql) {
  await sql`
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
}

async function ensureSyncMetadata(sql) {
  await sql`
    create table if not exists sync_metadata (
      key text primary key,
      value text,
      updated_at timestamptz not null default now()
    )
  `;
}

async function wasRecentlyAttempted(sql, intervalMinutes) {
  const rows = await sql`
    select updated_at
    from sync_metadata
    where key = ${SYNC_META_KEY}
      and updated_at > now() - (${intervalMinutes} || ' minutes')::interval
    limit 1
  `;
  return rows.length > 0;
}

async function markSyncAttempt(sql) {
  await sql`
    insert into sync_metadata (key, value, updated_at)
    values (${SYNC_META_KEY}, ${new Date().toISOString()}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

async function fetchWorldCupFixtures(fixtures) {
  const dates = fixtureDateRange(fixtures, lookaheadDays);
  const payload = await fetchOddsPapi("/v4/fixtures", {
    sportId,
    from: dates.from,
    to: dates.to
  });

  if (!Array.isArray(payload)) throw new Error("Unexpected OddsPapi fixtures response.");

  return payload.filter(
    (fixture) =>
      fixture.tournamentSlug === tournamentSlug &&
      fixture.categorySlug === categorySlug &&
      !/simulated|srl/i.test(`${fixture.categoryName ?? ""} ${fixture.participant1Name ?? ""} ${fixture.participant2Name ?? ""}`)
  );
}

function shouldRefreshFixtureOdds(fixture) {
  if (fixture.odds_provider !== PROVIDER || !fixture.odds_last_updated) return true;

  const kickoff = new Date(fixture.kickoff);
  const updatedAt = new Date(fixture.odds_last_updated);
  if (Number.isNaN(kickoff.getTime()) || Number.isNaN(updatedAt.getTime())) return true;

  const hoursUntilKickoff = (kickoff.getTime() - Date.now()) / (60 * 60 * 1000);
  const hoursSinceUpdate = (Date.now() - updatedAt.getTime()) / (60 * 60 * 1000);

  return hoursUntilKickoff <= 24 && hoursSinceUpdate >= refreshHours;
}

async function fetchAsianHandicapMarketCatalog() {
  const payload = await fetchOddsPapi("/v4/markets", { sportId });
  if (!Array.isArray(payload)) throw new Error("Unexpected OddsPapi markets response.");

  const catalog = new Map();
  for (const market of payload) {
    if (
      market.marketName !== "Asian Handicap" ||
      market.period !== "fulltime" ||
      market.marketType !== "spreads" ||
      typeof market.handicap !== "number"
    ) {
      continue;
    }
    catalog.set(String(market.marketId), market);
  }
  return catalog;
}

async function fetchOdds(fixtureId) {
  return fetchOddsPapi("/v4/odds", {
    fixtureId,
    bookmakers: bookmakerParam,
    oddsFormat: "decimal"
  });
}

async function fetchOddsPapi(pathname, params) {
  const url = new URL(pathname, apiBase);
  url.searchParams.set("apiKey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await paceOddsPapiRequest();

    const response = await fetch(url);
    const payload = await response.json().catch(() => null);

    if (response.ok) return payload;

    const message = payload?.error?.message || payload?.message || `${response.status} ${response.statusText}`;
    if (isRetryableOddsPapiError(response.status, message) && attempt < maxRetries) {
      await sleep(retryDelayMs * (attempt + 1));
      continue;
    }

    throw new Error(`${message} from ${url.origin}${url.pathname}`);
  }

  throw new Error(`OddsPapi request failed after ${maxRetries + 1} attempt(s) from ${url.origin}${url.pathname}`);
}

async function paceOddsPapiRequest() {
  const elapsed = Date.now() - lastOddsPapiRequestAt;
  if (lastOddsPapiRequestAt && elapsed < requestDelayMs) {
    await sleep(requestDelayMs - elapsed);
  }
  lastOddsPapiRequestAt = Date.now();
}

function isRetryableOddsPapiError(status, message) {
  return status === 429 || /rate limit|too many requests|temporarily unavailable/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixtureDateRange(fixtures, days) {
  const start = new Date(fixtures[0].kickoff);
  const from = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  };
}

function findMatchingProviderFixture(providerFixtures, fixture, fixtures) {
  return providerFixtures.find((candidate) => providerFixtureMatches(candidate, fixture, fixtures)) ?? null;
}

function providerFixtureMatches(candidate, fixture, fixtures) {
  const eventDate = parseProviderDate(candidate);
  if (!eventDate) return false;

  const diffMs = Math.abs(eventDate.getTime() - new Date(fixture.kickoff).getTime());
  if (diffMs > matchToleranceMinutes * 60 * 1000) return false;

  const home = candidate.participant1Name || candidate.homeTeamName || candidate.homeName;
  const away = candidate.participant2Name || candidate.awayTeamName || candidate.awayName;
  if (home && away) {
    return sameTeam(home, fixture.home_country) && sameTeam(away, fixture.away_country);
  }

  const nearbyFixtures = fixtures.filter((candidateFixture) => {
    const candidateDiffMs = Math.abs(eventDate.getTime() - new Date(candidateFixture.kickoff).getTime());
    return candidateDiffMs <= matchToleranceMinutes * 60 * 1000;
  });
  return nearbyFixtures.length === 1;
}

function parseProviderDate(event) {
  const value = event.startTime || event.trueStartTime || event.date || event.kickoff;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickAsianHandicap(event, fixture, marketCatalog, bookmakerPreference) {
  const candidates = [];
  const books = event?.bookmakerOdds ?? {};

  for (const [bookmakerSlug, bookmaker] of Object.entries(books)) {
    if (bookmaker.bookmakerIsActive === false) continue;

    for (const [marketId, market] of Object.entries(bookmaker.markets ?? {})) {
      const meta = marketCatalog.get(String(marketId));
      if (!meta) continue;

      const homeOutcome = activePlayer(market.outcomes?.[String(meta.marketId)]);
      const awayOutcome = activePlayer(market.outcomes?.[String(meta.marketId + 1)]);
      if (!homeOutcome || !awayOutcome) continue;

      const homeLine = Number(meta.handicap);
      const awayLine = -homeLine;
      const favourite = favouriteFromLines(homeLine, awayLine, fixture, homeOutcome.price, awayOutcome.price);
      const lastUpdated = latestDate(homeOutcome.changedAt, awayOutcome.changedAt, event.updatedAt) ?? new Date();

      candidates.push({
        bookmaker: bookmakerSlug,
        eventId: event.fixtureId,
        favourite,
        homePrice: Number(homeOutcome.price),
        awayPrice: Number(awayOutcome.price),
        line: Math.max(Math.abs(homeLine), Math.abs(awayLine)),
        market: `${meta.marketName} ${formatHandicapLine(homeLine)}`,
        lastUpdated,
        preferenceScore: bookmakerPreference && bookmakerSlug.toLowerCase().includes(bookmakerPreference.toLowerCase()) ? 0 : 1,
        balanceScore: oddsBalanceScore(homeOutcome.price, awayOutcome.price)
      });
    }
  }

  candidates.sort(
    (a, b) =>
      a.preferenceScore - b.preferenceScore ||
      a.balanceScore - b.balanceScore ||
      a.line - b.line ||
      a.bookmaker.localeCompare(b.bookmaker)
  );
  return candidates[0] ?? null;
}

function activePlayer(outcome) {
  const player = outcome?.players?.["0"];
  if (!player || player.active !== true) return null;
  const price = Number(player.price);
  if (!Number.isFinite(price)) return null;
  return { ...player, price };
}

function favouriteFromLines(homeLine, awayLine, fixture, homePrice, awayPrice) {
  if (homeLine < awayLine) return fixture.home_country;
  if (awayLine < homeLine) return fixture.away_country;
  return Number(homePrice) <= Number(awayPrice) ? fixture.home_country : fixture.away_country;
}

function latestDate(...values) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function oddsBalanceScore(homePrice, awayPrice) {
  return Math.abs(Number(homePrice) - Number(awayPrice));
}

function formatHandicapLine(line) {
  return Number(line).toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sameTeam(a, b) {
  return compactTeam(a) === compactTeam(b);
}

function compactTeam(value) {
  const normalized = normalizeTeam(value);
  return normalized.replace(/[^a-z0-9]/g, "");
}

function normalizeTeam(value) {
  const normalized = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const cleaned = normalized.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const aliases = {
    "cabo verde": "cape verde",
    "congo dr": "dr congo",
    "cote d ivoire": "cote divoire",
    "czech republic": "czechia",
    "democratic republic of congo": "dr congo",
    "ivory coast": "cote divoire",
    "south korea": "korea republic",
    turkey: "turkiye",
    "united states of america": "united states",
    usa: "united states"
  };
  return aliases[cleaned] ?? cleaned;
}

async function loadDotEnvLocal() {
  try {
    const envFile = await fs.readFile(path.join(root, ".env.local"), "utf8");
    for (const rawLine of envFile.split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, "");
      const match = line.trim().match(/^([A-Z0-9_]+)\s*=\s*["']?(.*?)["']?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // GitHub Actions and Vercel provide env vars directly.
  }
}

function runSelfTest() {
  const fixture = {
    id: 1,
    kickoff: "2026-06-13T19:00:00Z",
    home_country: "Qatar",
    away_country: "Switzerland"
  };
  const marketCatalog = new Map([
    [
      "1084",
      {
        marketId: 1084,
        marketName: "Asian Handicap",
        handicap: 1.5,
        period: "fulltime",
        marketType: "spreads"
      }
    ],
    [
      "1086",
      {
        marketId: 1086,
        marketName: "Asian Handicap",
        handicap: 1.75,
        period: "fulltime",
        marketType: "spreads"
      }
    ]
  ]);
  const event = {
    fixtureId: "id1000001666456918",
    updatedAt: "2026-06-13T05:38:24.787Z",
    bookmakerOdds: {
      pinnacle: {
        bookmakerIsActive: true,
        markets: {
          "1084": {
            outcomes: {
              "1084": { players: { "0": { active: true, price: 2.29, changedAt: "2026-06-13T05:38:24.787Z" } } },
              "1085": { players: { "0": { active: true, price: 1.68, changedAt: "2026-06-13T05:38:24.787Z" } } }
            }
          },
          "1086": {
            outcomes: {
              "1086": { players: { "0": { active: true, price: 2.04, changedAt: "2026-06-13T05:38:24.787Z" } } },
              "1087": { players: { "0": { active: true, price: 1.869, changedAt: "2026-06-13T05:38:24.787Z" } } }
            }
          }
        }
      }
    }
  };

  assert.equal(
    providerFixtureMatches(
      {
        startTime: "2026-06-13T19:00:00.000Z",
        participant1Name: "Qatar",
        participant2Name: "Switzerland"
      },
      fixture,
      [fixture]
    ),
    true
  );
  assert.equal(
    providerFixtureMatches(
      {
        startTime: "2026-06-17T17:00:00.000Z",
        participant1Name: "Portugal",
        participant2Name: "Congo DR"
      },
      {
        id: 2,
        kickoff: "2026-06-17T17:00:00Z",
        home_country: "Portugal",
        away_country: "DR Congo"
      },
      [fixture]
    ),
    true
  );

  const odds = pickAsianHandicap(event, fixture, marketCatalog, "pinnacle");
  assert.equal(odds.bookmaker, "pinnacle");
  assert.equal(odds.favourite, "Switzerland");
  assert.equal(odds.line, 1.75);
  assert.equal(odds.homePrice, 2.04);
  assert.equal(odds.awayPrice, 1.869);
  assert.equal(odds.market, "Asian Handicap 1.75");

  console.log("sync-odds selftest passed.");
}
