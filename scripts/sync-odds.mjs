import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
const STRICT = process.argv.includes("--strict") || process.env.SPORTSDATAIO_ODDS_STRICT === "true";
const PROVIDER = "SportsDataIO";
const DEFAULT_COMPETITION_ID = "21"; // FIFA World Cup in SportsDataIO's soccer guide.

await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.SPORTSDATAIO_API_KEY;
const competitionId = process.env.SPORTSDATAIO_COMPETITION_ID || DEFAULT_COMPETITION_ID;
const preferredBookmaker = process.env.SPORTSDATAIO_BOOKMAKER || "";
const endpoint =
  process.env.SPORTSDATAIO_ODDS_URL ||
  `https://api.sportsdata.io/v4/soccer/odds/json/BettingEventsByCompetition/${competitionId}?include=available`;

if (!apiKey) {
  console.log("SPORTSDATAIO_API_KEY is not set. Skipping trusted AH odds sync; model fallback remains active.");
  process.exit(0);
}

if (!databaseUrl) {
  console.log("DATABASE_URL is not set. Skipping trusted AH odds sync without changing Neon.");
  process.exit(0);
}

try {
  const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
  await ensureOddsColumns(sql);

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

  const events = collectEvents(await fetchSportsDataIo(endpoint, apiKey));
  let matched = 0;
  let updated = 0;

  for (const fixture of fixtures) {
    const event = events.find((candidate) => eventMatchesFixture(candidate, fixture));
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
    `Trusted AH odds sync complete: ${updated}/${fixtures.length} fixture(s) updated from ${PROVIDER}; ${matched} fixture(s) matched provider events.`
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

async function fetchSportsDataIo(rawEndpoint, key) {
  const url = new URL(rawEndpoint.replace("{competitionId}", competitionId));
  const headers = { "Ocp-Apim-Subscription-Key": key };

  if (process.env.SPORTSDATAIO_AUTH_MODE === "query" && !url.searchParams.has("key")) {
    url.searchParams.set("key", key);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url.origin}${url.pathname}`);
  }
  return response.json();
}

function collectEvents(payload) {
  const eventArrays = [];
  addArray(eventArrays, payload);
  for (const key of ["BettingEvents", "bettingEvents", "Events", "events", "Data", "data"]) {
    addArray(eventArrays, payload?.[key]);
  }

  const events = [];
  const seen = new WeakSet();
  for (const item of eventArrays.flat()) collectEventObjects(item, events, seen);
  return events;
}

function collectEventObjects(value, events, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (hasMarketArray(value) || hasOutcomeArray(value)) {
    events.push(value);
    return;
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) collectEventObjects(item, events, seen);
    } else if (child && typeof child === "object") {
      collectEventObjects(child, events, seen);
    }
  }
}

function addArray(arrays, value) {
  if (Array.isArray(value)) arrays.push(value);
}

function hasMarketArray(value) {
  return ["BettingMarkets", "bettingMarkets", "Markets", "markets"].some((key) => Array.isArray(value?.[key]));
}

function hasOutcomeArray(value) {
  return ["BettingOutcomes", "bettingOutcomes", "Outcomes", "outcomes"].some((key) => Array.isArray(value?.[key]));
}

function eventMatchesFixture(event, fixture) {
  const eventDate = parseEventDate(event);
  if (eventDate) {
    const diffMs = Math.abs(eventDate.getTime() - new Date(fixture.kickoff).getTime());
    if (diffMs > 36 * 60 * 60 * 1000) return false;
  }

  const home = fieldText(event, ["HomeTeamName", "HomeTeam", "HomeName", "Home"]);
  const away = fieldText(event, ["AwayTeamName", "AwayTeam", "AwayName", "Away"]);
  if (home && away) {
    return sameTeam(home, fixture.home_country) && sameTeam(away, fixture.away_country);
  }

  const text = compactText(JSON.stringify(event));
  return text.includes(compactTeam(fixture.home_country)) && text.includes(compactTeam(fixture.away_country));
}

function parseEventDate(event) {
  const value = fieldText(event, [
    "DateTimeUTC",
    "DateTime",
    "StartDateTime",
    "StartTime",
    "Scheduled",
    "Day",
    "Date"
  ]);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickAsianHandicap(event, fixture, bookmakerPreference) {
  const candidates = [];
  for (const market of collectMarkets(event)) {
    if (!isAsianHandicapMarket(market)) continue;

    const outcomes = collectOutcomes(market).filter((outcome) => isOutcomeAvailable(outcome));
    const homeOutcome = outcomes.find((outcome) => outcomeMatchesTeam(outcome, fixture.home_country));
    const awayOutcome = outcomes.find((outcome) => outcomeMatchesTeam(outcome, fixture.away_country));
    if (!homeOutcome || !awayOutcome) continue;

    const homeLine = numericField(homeOutcome, ["Value", "Point", "Line", "Handicap", "Spread"]) ?? numericField(market, ["Value", "Point", "Line", "Handicap", "Spread"]);
    const awayLine = numericField(awayOutcome, ["Value", "Point", "Line", "Handicap", "Spread"]) ?? numericField(market, ["Value", "Point", "Line", "Handicap", "Spread"]);
    if (homeLine === null || awayLine === null) continue;

    let favourite = null;
    let line = null;
    if (homeLine < 0) {
      favourite = fixture.home_country;
      line = Math.abs(homeLine);
    } else if (awayLine < 0) {
      favourite = fixture.away_country;
      line = Math.abs(awayLine);
    } else if (homeLine !== awayLine) {
      favourite = homeLine < awayLine ? fixture.home_country : fixture.away_country;
      line = Math.abs(Math.min(homeLine, awayLine));
    }

    if (!favourite || line === null) continue;

    const bookmaker = bookmakerName(homeOutcome) || bookmakerName(awayOutcome) || bookmakerName(market) || "Unknown sportsbook";
    const lastUpdated =
      dateField(homeOutcome, ["Updated", "UpdatedAt", "LastUpdated", "LastUpdatedUtc", "Created"]) ||
      dateField(awayOutcome, ["Updated", "UpdatedAt", "LastUpdated", "LastUpdatedUtc", "Created"]) ||
      dateField(market, ["Updated", "UpdatedAt", "LastUpdated", "LastUpdatedUtc", "Created"]) ||
      new Date();

    candidates.push({
      bookmaker,
      eventId: fieldText(event, ["BettingEventID", "EventID", "GameID", "ScoreID", "Id", "ID"]),
      favourite,
      homePrice: numericField(homeOutcome, ["PayoutDecimal", "DecimalOdds", "Price", "Odds"]),
      awayPrice: numericField(awayOutcome, ["PayoutDecimal", "DecimalOdds", "Price", "Odds"]),
      line,
      market: fieldText(market, ["Name", "MarketName", "BettingBetType", "BettingMarketType"]) || "Asian Handicap / Point Spread",
      lastUpdated,
      preferenceScore: bookmakerPreference && bookmaker.toLowerCase().includes(bookmakerPreference.toLowerCase()) ? 0 : 1
    });
  }

  candidates.sort((a, b) => a.preferenceScore - b.preferenceScore || a.bookmaker.localeCompare(b.bookmaker));
  return candidates[0] ?? null;
}

function collectMarkets(event) {
  const markets = [];
  walkObjects(event, (obj) => {
    for (const key of ["BettingMarkets", "bettingMarkets", "Markets", "markets"]) {
      if (Array.isArray(obj?.[key])) markets.push(...obj[key]);
    }
  });
  return markets;
}

function collectOutcomes(market) {
  const outcomes = [];
  walkObjects(market, (obj) => {
    for (const key of ["BettingOutcomes", "bettingOutcomes", "Outcomes", "outcomes"]) {
      if (Array.isArray(obj?.[key])) outcomes.push(...obj[key]);
    }
  });
  return outcomes;
}

function walkObjects(value, visit, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  visit(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) walkObjects(item, visit, seen);
    } else {
      walkObjects(child, visit, seen);
    }
  }
}

function isAsianHandicapMarket(market) {
  const text = [
    fieldText(market, ["Name", "MarketName"]),
    fieldText(market, ["BettingMarketType", "MarketType", "Type"]),
    fieldText(market, ["BettingBetType", "BetType"]),
    fieldText(market, ["BettingPeriodType", "PeriodType", "Period"])
  ]
    .filter(Boolean)
    .join(" ");

  if (/total|goal line|corner|card|player|prop/i.test(text)) return false;
  if (/1st|first|2nd|second|half|quarter|period/i.test(text) && !/full|game|match|regular/i.test(text)) {
    return false;
  }
  return /asian\s*handicap|handicap|point\s*spread|\bspread\b/i.test(text);
}

function isOutcomeAvailable(outcome) {
  const available = deepField(outcome, ["IsAvailable", "Available", "IsOpen", "Open"]);
  return available === null || available === undefined || available === true || available === "true" || available === 1;
}

function outcomeMatchesTeam(outcome, country) {
  const text = compactText(JSON.stringify(outcome));
  return text.includes(compactTeam(country));
}

function bookmakerName(value) {
  const direct = fieldText(value, ["SportsBook", "Sportsbook", "SportsBookName", "SportsbookName", "Bookmaker", "BookmakerName"]);
  if (direct && direct !== "[object Object]") return direct;
  const book = deepField(value, ["Sportsbook", "SportsBook", "Bookmaker"]);
  if (book && typeof book === "object") {
    return fieldText(book, ["Name", "Title", "Key", "ID"]);
  }
  return null;
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
  if (typeof raw === "object") return fieldText(raw, ["Name", "Title", "ShortName", "Key", "ID"]);
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
    "turkey": "turkiye",
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
      const match = line.trim().match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // GitHub Actions and Vercel provide env vars directly.
  }
}
