import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
const STRICT = process.argv.includes("--strict") || process.env.API_FOOTBALL_ODDS_STRICT === "true";
const FORCE = process.argv.includes("--force") || process.env.API_FOOTBALL_ODDS_FORCE === "true";
const PROVIDER = "API-Football";
const DEFAULT_LEAGUE = "1"; // FIFA World Cup in API-Football.
const DEFAULT_SEASON = "2026";
const DEFAULT_MIN_INTERVAL_MINUTES = 180; // API-Football pre-match odds update around every 3 hours.
const DEFAULT_LOOKAHEAD_DAYS = 3;
const SYNC_META_KEY = "api_football_odds_last_attempt";

if (process.argv.includes("--selftest")) {
  runSelfTest();
  process.exit(0);
}

await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || process.env.API_SPORTS_KEY;
const apiBase = process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
const league = process.env.API_FOOTBALL_LEAGUE || DEFAULT_LEAGUE;
const season = process.env.API_FOOTBALL_SEASON || DEFAULT_SEASON;
const preferredBookmaker = process.env.API_FOOTBALL_BOOKMAKER || "";
const minIntervalMinutes = positiveNumber(process.env.API_FOOTBALL_ODDS_MIN_INTERVAL_MINUTES, DEFAULT_MIN_INTERVAL_MINUTES);
const lookaheadDays = positiveNumber(process.env.API_FOOTBALL_ODDS_LOOKAHEAD_DAYS, DEFAULT_LOOKAHEAD_DAYS);
const maxDates = positiveNumber(process.env.API_FOOTBALL_ODDS_MAX_DATES, DEFAULT_LOOKAHEAD_DAYS);
const maxPagesPerDate = positiveNumber(process.env.API_FOOTBALL_ODDS_MAX_PAGES_PER_DATE, 2);
const matchToleranceMinutes = positiveNumber(process.env.API_FOOTBALL_MATCH_TIME_TOLERANCE_MINUTES, 90);

if (!apiKey) {
  console.log("API_FOOTBALL_KEY is not set. Skipping trusted AH odds sync; model fallback remains active.");
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
    console.log(`Trusted AH odds sync skipped to protect the free API-Football quota; last attempt was less than ${minIntervalMinutes} minutes ago.`);
    process.exit(0);
  }

  const fixtures = await sql`
    select id, kickoff::text as kickoff, home_country, away_country
    from fixtures
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

  await markSyncAttempt(sql);

  const betIds = await resolveAsianHandicapBetIds();
  if (!betIds.length) {
    await sql.end();
    console.log("No API-Football Asian Handicap bet IDs found. Set API_FOOTBALL_AH_BET_IDS if the provider uses custom IDs.");
    process.exit(0);
  }

  const dates = upcomingFixtureDates(fixtures, lookaheadDays, maxDates);
  if (!dates.length) {
    await sql.end();
    console.log("No upcoming fixture dates are inside the API-Football odds lookahead window.");
    process.exit(0);
  }

  const events = await fetchOddsEvents(betIds, dates);
  let matched = 0;
  let updated = 0;

  for (const fixture of fixtures) {
    const event = findMatchingEvent(events, fixture, fixtures);
    if (!event) continue;
    matched += 1;

    const odds = pickAsianHandicap(event, fixture, preferredBookmaker);
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
    `Trusted AH odds sync complete: ${updated}/${fixtures.length} fixture(s) updated from ${PROVIDER}; ${matched} fixture(s) matched provider events across ${dates.length} date(s).`
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

async function resolveAsianHandicapBetIds() {
  const configured = splitList(process.env.API_FOOTBALL_AH_BET_IDS);
  if (configured.length) return configured;

  const payload = await fetchApiFootball("/odds/bets", { search: "Asian Handicap" });
  return (payload.response ?? [])
    .filter((bet) => /asian\s*handicap/i.test(String(bet.name ?? "")))
    .map((bet) => String(bet.id))
    .filter(Boolean);
}

async function fetchOddsEvents(betIds, dates) {
  const events = [];
  const seen = new Set();

  for (const bet of betIds) {
    for (const date of dates) {
      let page = 1;
      let totalPages = 1;
      do {
        const payload = await fetchApiFootball("/odds", {
          league,
          season,
          date,
          bet,
          page: String(page)
        });

        for (const event of payload.response ?? []) {
          const key = `${fieldText(event?.fixture, ["id", "ID"]) ?? ""}:${fieldText(event, ["update"]) ?? ""}:${JSON.stringify(event.bookmakers ?? [])}`;
          if (seen.has(key)) continue;
          seen.add(key);
          events.push(event);
        }

        totalPages = Math.min(Number(payload.paging?.total ?? 1), maxPagesPerDate);
        page += 1;
      } while (page <= totalPages);
    }
  }

  return events;
}

async function fetchApiFootball(endpoint, params) {
  const url = new URL(endpoint, apiBase);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  const response = await fetch(url, { headers: { "x-apisports-key": apiKey } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url.origin}${url.pathname}`);
  }

  const payload = await response.json();
  const errors = payload.errors && typeof payload.errors === "object" ? Object.values(payload.errors).filter(Boolean) : [];
  if (errors.length) {
    throw new Error(`${errors.join("; ")} from ${url.origin}${url.pathname}`);
  }

  return payload;
}

function upcomingFixtureDates(fixtures, days, limit) {
  const now = Date.now();
  const maxTime = now + days * 24 * 60 * 60 * 1000;
  const dates = [];
  const seen = new Set();

  for (const fixture of fixtures) {
    const kickoff = new Date(fixture.kickoff).getTime();
    if (Number.isNaN(kickoff) || kickoff > maxTime) continue;
    const date = new Date(kickoff).toISOString().slice(0, 10);
    if (seen.has(date)) continue;
    seen.add(date);
    dates.push(date);
    if (dates.length >= limit) break;
  }

  if (!dates.length && fixtures[0]) dates.push(new Date(fixtures[0].kickoff).toISOString().slice(0, 10));
  return dates;
}

function findMatchingEvent(events, fixture, fixtures) {
  return events.find((event) => eventMatchesFixture(event, fixture, fixtures)) ?? null;
}

function eventMatchesFixture(event, fixture, fixtures) {
  const eventDate = parseEventDate(event);
  if (!eventDate) return false;

  const diffMs = Math.abs(eventDate.getTime() - new Date(fixture.kickoff).getTime());
  if (diffMs > matchToleranceMinutes * 60 * 1000) return false;

  const home = fieldText(event, ["HomeTeamName", "HomeTeam", "HomeName", "Home"]);
  const away = fieldText(event, ["AwayTeamName", "AwayTeam", "AwayName", "Away"]);
  if (home && away) {
    return sameTeam(home, fixture.home_country) && sameTeam(away, fixture.away_country);
  }

  const text = compactText(JSON.stringify(event));
  if (text.includes(compactTeam(fixture.home_country)) && text.includes(compactTeam(fixture.away_country))) {
    return true;
  }

  const nearbyFixtures = fixtures.filter((candidate) => {
    const candidateDiffMs = Math.abs(eventDate.getTime() - new Date(candidate.kickoff).getTime());
    return candidateDiffMs <= matchToleranceMinutes * 60 * 1000;
  });

  return nearbyFixtures.length === 1;
}

function parseEventDate(event) {
  const value =
    fieldText(event?.fixture, ["date", "Date"]) ||
    fieldText(event, ["DateTimeUTC", "DateTime", "StartDateTime", "StartTime", "Scheduled", "Day", "Date"]);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickAsianHandicap(event, fixture, bookmakerPreference) {
  const candidates = [];

  for (const bookmaker of collectBookmakers(event)) {
    for (const bet of collectBets(bookmaker)) {
      if (!isAsianHandicapMarket(bet)) continue;

      const parsed = collectValues(bet)
        .map((value) => parseAsianHandicapValue(value, fixture))
        .filter(Boolean);
      const homeOutcomes = parsed.filter((outcome) => outcome.side === "home");
      const awayOutcomes = parsed.filter((outcome) => outcome.side === "away");

      for (const homeOutcome of homeOutcomes) {
        for (const awayOutcome of awayOutcomes) {
          if (!isMatchingHandicapPair(homeOutcome, awayOutcome)) continue;

          const favourite = favouriteFromPair(homeOutcome, awayOutcome, fixture);
          if (!favourite) continue;

          const line = Math.max(Math.abs(homeOutcome.line), Math.abs(awayOutcome.line));
          candidates.push({
            bookmaker: fieldText(bookmaker, ["name", "Name"]) || "Unknown bookmaker",
            eventId: fieldText(event?.fixture, ["id", "ID"]) || fieldText(event, ["id", "ID"]),
            favourite,
            homePrice: homeOutcome.price,
            awayPrice: awayOutcome.price,
            line,
            market: fieldText(bet, ["name", "Name"]) || "Asian Handicap",
            lastUpdated: dateField(event, ["update", "Update", "last_update", "LastUpdate"]) || new Date(),
            preferenceScore:
              bookmakerPreference &&
              (fieldText(bookmaker, ["name", "Name"]) || "").toLowerCase().includes(bookmakerPreference.toLowerCase())
                ? 0
                : 1,
            balanceScore: oddsBalanceScore(homeOutcome.price, awayOutcome.price)
          });
        }
      }
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

function collectBookmakers(event) {
  return Array.isArray(event?.bookmakers) ? event.bookmakers : [];
}

function collectBets(bookmaker) {
  return Array.isArray(bookmaker?.bets) ? bookmaker.bets : [];
}

function collectValues(bet) {
  return Array.isArray(bet?.values) ? bet.values : [];
}

function parseAsianHandicapValue(value, fixture) {
  const rawLabel = String(value.value ?? value.name ?? value.label ?? "").trim();
  if (!rawLabel) return null;

  const side = outcomeSide(rawLabel, fixture);
  if (!side) return null;

  const line = handicapLine(rawLabel);
  if (line === null) return null;

  const price = numericField(value, ["odd", "odds", "price", "Odd", "Odds", "Price"]);
  return { side, line, price, label: rawLabel };
}

function outcomeSide(label, fixture) {
  const normalized = normalizeTeam(label);
  const compact = compactText(label);

  if (/\bhome\b/i.test(label) || /^\s*1(?:\s|$|[(:.-])/i.test(label) || compact.includes(compactTeam(fixture.home_country))) return "home";
  if (/\baway\b/i.test(label) || /^\s*2(?:\s|$|[(:.-])/i.test(label) || compact.includes(compactTeam(fixture.away_country))) return "away";

  const home = normalizeTeam(fixture.home_country);
  const away = normalizeTeam(fixture.away_country);
  if (normalized.startsWith(home)) return "home";
  if (normalized.startsWith(away)) return "away";
  return null;
}

function handicapLine(label) {
  const withoutSideWords = label
    .replace(/\b(home|away)\b/gi, " ")
    .replace(/^\s*[12](?=\s|$|[(:.-])/i, " ")
    .replace(/,/g, ".");
  const signed = [...withoutSideWords.matchAll(/[+-]\s*\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0].replace(/\s+/g, ""))
  );
  if (signed.length) return signed[signed.length - 1];

  const unsigned = [...withoutSideWords.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  if (unsigned.length) return unsigned[unsigned.length - 1];
  return null;
}

function isMatchingHandicapPair(homeOutcome, awayOutcome) {
  return Math.abs(homeOutcome.line + awayOutcome.line) < 0.001;
}

function favouriteFromPair(homeOutcome, awayOutcome, fixture) {
  if (homeOutcome.line < awayOutcome.line) return fixture.home_country;
  if (awayOutcome.line < homeOutcome.line) return fixture.away_country;

  if (homeOutcome.price !== null && awayOutcome.price !== null) {
    return homeOutcome.price <= awayOutcome.price ? fixture.home_country : fixture.away_country;
  }

  return fixture.home_country;
}

function isAsianHandicapMarket(bet) {
  return /asian\s*handicap/i.test(fieldText(bet, ["name", "Name"]) || "");
}

function oddsBalanceScore(homePrice, awayPrice) {
  if (homePrice === null || awayPrice === null) return Number.MAX_SAFE_INTEGER;
  return Math.abs(homePrice - awayPrice);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numericField(value, names) {
  const raw = deepField(value, names);
  if (raw === null || raw === undefined || raw === "") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function dateField(value, names) {
  const raw = fieldText(value, names);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fieldText(value, names) {
  const raw = deepField(value, names);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return fieldText(raw, ["name", "Name", "title", "Title", "key", "Key", "id", "ID"]);
  return String(raw);
}

function deepField(value, names, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, child] of Object.entries(value)) {
    if (wanted.has(key.toLowerCase())) return child;
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = deepField(child, names, seen);
      if (found !== null && found !== undefined) return found;
    }
  }

  return null;
}

function sameTeam(a, b) {
  return compactTeam(a) === compactTeam(b);
}

function compactTeam(value) {
  const normalized = normalizeTeam(value);
  return normalized.replace(/[^a-z0-9]/g, "");
}

function compactText(value) {
  return normalizeTeam(value).replace(/[^a-z0-9]/g, "");
}

function normalizeTeam(value) {
  const normalized = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const cleaned = normalized.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const aliases = {
    "cabo verde": "cape verde",
    "cote d ivoire": "cote divoire",
    "czech republic": "czechia",
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
    kickoff: "2026-06-13T22:00:00Z",
    home_country: "Brazil",
    away_country: "Morocco"
  };
  const event = {
    fixture: { id: 12345, date: "2026-06-13T22:00:00+00:00" },
    update: "2026-06-13T09:00:00+00:00",
    bookmakers: [
      {
        id: 1,
        name: "Pinnacle",
        bets: [
          {
            id: 4,
            name: "Asian Handicap",
            values: [
              { value: "Brazil -1", odd: "1.91" },
              { value: "Morocco +1", odd: "1.97" },
              { value: "Brazil -1.5", odd: "2.55" },
              { value: "Morocco +1.5", odd: "1.50" }
            ]
          }
        ]
      }
    ]
  };

  const bet = event.bookmakers[0].bets[0];
  assert.equal(isAsianHandicapMarket(bet), true);
  assert.deepEqual(
    collectValues(bet).map((value) => parseAsianHandicapValue(value, fixture)),
    [
      { side: "home", line: -1, price: 1.91, label: "Brazil -1" },
      { side: "away", line: 1, price: 1.97, label: "Morocco +1" },
      { side: "home", line: -1.5, price: 2.55, label: "Brazil -1.5" },
      { side: "away", line: 1.5, price: 1.5, label: "Morocco +1.5" }
    ]
  );

  const odds = pickAsianHandicap(event, fixture, "Pinnacle");
  assert.equal(odds.bookmaker, "Pinnacle");
  assert.equal(odds.favourite, "Brazil");
  assert.equal(odds.line, 1);
  assert.equal(odds.homePrice, 1.91);
  assert.equal(odds.awayPrice, 1.97);

  const genericValue = parseAsianHandicapValue({ value: "Away +0.5", odd: "1.88" }, fixture);
  assert.deepEqual(genericValue, { side: "away", line: 0.5, price: 1.88, label: "Away +0.5" });

  console.log("sync-odds selftest passed.");
}
