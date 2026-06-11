# FIFA World Cup 2026 Office Sweepstake

Invite-only live draw app for the 2026 World Cup office pool.

## What It Does

- Creates one private invite token per participant.
- Lets each participant draw once per tier.
- Stores every draw in Neon Postgres.
- Prevents duplicate countries with database constraints.
- Shows pool cards, daily fixtures, team status, ranking, and the sweepstake winner logic.
- Includes an admin page for updating elimination/result status.
- Includes a scheduled GitHub Action hook for syncing match results into Neon.

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

## Daily Results Sync

`.github/workflows/sync-results.yml` runs once per day and calls `npm run sync:results`.

Required GitHub Actions secret:

- `DATABASE_URL`

Optional feed secrets:

- `RESULTS_API_URL`
- `RESULTS_API_KEY`

Until `RESULTS_API_URL` is configured, the workflow exits cleanly without changing Neon. The feed should return JSON like:

```json
{
  "fixtures": [
    { "home": "Spain", "away": "France", "homeScore": 2, "awayScore": 1 }
  ],
  "teams": [
    {
      "country": "France",
      "finalRank": 2,
      "eliminatedStage": "Runner-up",
      "resultNote": "Lost the final"
    }
  ]
}
```
