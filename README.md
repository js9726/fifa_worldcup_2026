# FIFA World Cup 2026 Office Sweepstake

Invite-only live draw app for the 2026 World Cup office pool.

## What It Does

- Creates one private invite token per participant.
- Lets each participant draw once per tier.
- Stores every draw in Neon Postgres.
- Prevents duplicate countries with database constraints.
- Shows pool cards, daily fixtures, team status, ranking, and the sweepstake winner logic.
- Includes a password-gated admin overview (everyone's pools) with a manual results override.
- Pulls live scores and final standings automatically from football-data.org via a scheduled GitHub Action.

## Current Draw Logic

The supplied list has 48 countries and 12 participants, so the fair draw is:

- 1 favourite
- 1 strong challenger
- 1 dangerous outsider
- 1 underdog

That uses all 48 countries exactly once. A 5-team draw for 12 people would require 60 unique countries.

## Prize Logic

Prize pool: RM600.

- Champion owner: RM360 (60%)
- Runner-up owner: RM180 (30%)
- Wooden Spoon, worst team overall: RM60 (10%)

If the Wooden Spoon result is tied, the app shows the tied teams and splits that prize equally.

## Trusted AH Source And Model Fallback

The app supports trusted Asian Handicap odds from API-Football's free tier.
API-Football has official World Cup 2026 coverage for `league=1` / `season=2026`,
including odds, and its free plan includes pre-match odds with 100 requests per
day. The sync is quota-safe by default: it throttles provider calls to once every
180 minutes unless run with `--force`.

`npm run sync:odds` is run by the same GitHub schedule as result syncing. If
`API_FOOTBALL_KEY` is not configured, the odds sync exits successfully and the
app keeps using its local model fallback. This keeps the cron job runnable while
the free API key is being set up.

When API-Football returns a fixture AH line, the app stores it on the fixture and
displays it as `API-Football / bookmaker`. After kickoff, the app does not
overwrite finished/scored fixture odds; it only evaluates whether the stored AH
line was `covered`, `push`, or `missed`.

If trusted odds are not available for a fixture, the fallback `AH` line is a
simple pre-match model estimate derived from each team's seeded `winRate` in
`data.seed.json` / the `teams.win_rate` database column.

For example, Mexico has `winRate: 3` and South Africa has `winRate: 1`, so the
fixture model displays Mexico `3 / (3 + 1) = 75%` and South Africa `25%`.

The AH line is then bucketed from that percentage gap:

- gap below 8 points: level ball `0`
- 8-17 points: `-0.25`
- 18-29 points: `-0.5`
- 30-41 points: `-0.75`
- 42-54 points: `-1`
- 55+ points: `-1.5`

After a score is available, the app compares the favourite's winning margin to
that model AH line and labels it `covered`, `push`, or `missed`.

The GitHub cron updates fixtures, full-time scores, final rankings, and now
optionally trusted AH odds. The current result sync script reads
football-data.org's `score.fullTime`, so a match may stay in "awaiting score"
until the provider publishes a full-time score.

## Setup

```bash
npm install
cp .env.example .env.local
npm run setup:db
npm run dev
```

`npm run setup:db` creates the schema, seeds teams/fixtures/participants, and writes `invite-links.txt` locally. That file is intentionally ignored by git.

## Production

Set these Vercel environment variables:

- `DATABASE_URL`
- `ADMIN_KEY`

Then deploy with:

```bash
npx vercel --prod
```

## Automatic Results Sync

`.github/workflows/sync-results.yml` runs every 15 minutes (and on manual dispatch) and calls
`npm run sync:results`. The script pulls live World Cup data straight from
[football-data.org](https://www.football-data.org) - **no manual input required**:

- Updates every fixture's score (linking each match by `external_id`, inserting knockout
  fixtures as the bracket fills in).
- Computes each team's `final_rank` (1-48) and `eliminated_stage` automatically, which drives
  the champion / runner-up / wooden-spoon prize logic.

Required GitHub Actions secrets (Repo -> Settings -> Secrets and variables -> Actions):

- `DATABASE_URL` - the same Neon connection string.
- `FOOTBALL_DATA_TOKEN` - free token from <https://www.football-data.org/client/register>.
- Optional `API_FOOTBALL_KEY` - free API-Football key for trusted AH lines.

Optional GitHub Actions variables:

- `API_FOOTBALL_LEAGUE` - defaults to `1` for FIFA World Cup.
- `API_FOOTBALL_SEASON` - defaults to `2026`.
- `API_FOOTBALL_AH_BET_IDS` - comma-separated override if API-Football changes Asian Handicap bet discovery.
- `API_FOOTBALL_BOOKMAKER` - preferred bookmaker name when more than one is available.
- `API_FOOTBALL_ODDS_MIN_INTERVAL_MINUTES` - defaults to `180` to protect the free quota.

Without `FOOTBALL_DATA_TOKEN` the workflow exits cleanly without touching Neon. The
`/admin` results form remains available as a manual override.

Without `API_FOOTBALL_KEY`, the odds step exits cleanly and the app shows the
local AH model fallback.

GitHub scheduled workflows are polling, not a webhook. The workflow is scheduled at
`:07`, `:22`, `:37`, and `:52` to avoid the busiest `:00` minute, but GitHub can
still delay scheduled jobs. football-data.org's free tier also delays scores; use a
live-score tier or another live provider if you need the scoreboard to change within
minutes of full-time.

### How ranking works

The 48 teams are placed into bands by how far they got, then ordered within each band by
group-stage performance (points -> goal difference -> goals for):

| Finish | Rank | Source |
|---|---|---|
| Champion | 1 | Winner of the `FINAL` |
| Runner-up | 2 | Loser of the `FINAL` |
| Third / Fourth | 3 / 4 | `THIRD_PLACE` play-off |
| Quarter-finals out | 5-8 | Losers of `QUARTER_FINALS` |
| Round of 16 out | 9-16 | Losers of `LAST_16` |
| Round of 32 out | 17-32 | Losers of `LAST_32` |
| Group stage out | 33-48 | Teams not in the `LAST_32` bracket |

Validate the ranking logic offline (no token or DB needed):

```bash
node scripts/sync-results.mjs --selftest
node scripts/sync-odds.mjs --selftest
```

If football-data.org spells a country differently from our DB (e.g. `Ivory Coast`,
`South Korea`, `Czech Republic`, `Turkey`), the script maps it via the `ALIASES` table and
logs any unmatched names so they can be added.
