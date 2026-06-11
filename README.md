# FIFA World Cup 2026 Office Sweepstake

Invite-only live draw app for the 2026 World Cup office pool.

## What It Does

- Creates one private invite token per participant.
- Lets each participant draw once per tier.
- Stores every draw in Neon Postgres.
- Prevents duplicate countries with database constraints.
- Shows pool cards, daily fixtures, team status, ranking, and the sweepstake winner logic.
- Includes an admin page for updating elimination/result status.

## Current Draw Logic

The supplied list has 48 countries and 12 participants, so the fair draw is:

- 1 favourite
- 1 strong challenger
- 1 dangerous outsider
- 1 underdog

That uses all 48 countries exactly once. A 5-team draw for 12 people would require 60 unique countries.

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
