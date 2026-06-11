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

`.github/workflows/sync-results.yml` runs every 6 hours (and on manual dispatch) and calls
`npm run sync:results`. The script pulls live World Cup data straight from
[football-data.org](https://www.football-data.org) — **no manual input required**:

- Updates every fixture's score (linking each match by `external_id`, inserting knockout
  fixtures as the bracket fills in).
- Computes each team's `final_rank` (1–48) and `eliminated_stage` automatically, which drives
  the champion / runner-up / wooden-spoon prize logic.

Required GitHub Actions secrets (Repo → Settings → Secrets and variables → Actions):

- `DATABASE_URL` — the same Neon connection string.
- `FOOTBALL_DATA_TOKEN` — free token from <https://www.football-data.org/client/register>.

Without `FOOTBALL_DATA_TOKEN` the workflow exits cleanly without touching Neon. The
`/admin` results form remains available as a manual override.

### How ranking works

The 48 teams are placed into bands by how far they got, then ordered within each band by
group-stage performance (points → goal difference → goals for):

| Finish | Rank | Source |
|---|---|---|
| Champion | 1 | Winner of the `FINAL` |
| Runner-up | 2 | Loser of the `FINAL` |
| Third / Fourth | 3 / 4 | `THIRD_PLACE` play-off |
| Quarter-finals out | 5–8 | Losers of `QUARTER_FINALS` |
| Round of 16 out | 9–16 | Losers of `LAST_16` |
| Round of 32 out | 17–32 | Losers of `LAST_32` |
| Group stage out | 33–48 | Teams not in the `LAST_32` bracket |

Validate the ranking logic offline (no token or DB needed):

```bash
node scripts/sync-results.mjs --selftest
```

If football-data.org spells a country differently from our DB (e.g. `Ivory Coast`,
`South Korea`, `Czech Republic`, `Turkey`), the script maps it via the `ALIASES` table and
logs any unmatched names so they can be added.
