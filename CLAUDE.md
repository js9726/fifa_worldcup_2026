# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project

**FIFA World Cup 2026 Office Sweepstake** — an invite-only Next.js app for an office
pool. Each participant draws countries (one per tier/pot), the app tracks fixtures,
results, prize logic, and a peer-to-peer **Bet Pool** ledger. Data lives in Neon
Postgres; the app is deployed to Vercel.

Stack: Next.js 15.5 (App Router, React 19), TypeScript, `postgres` (porsager) against
Neon, `lucide-react` icons. No CSS framework — styling is hand-written in
`src/app/globals.css`.

## Commands

```bash
npm run dev              # dev server at http://localhost:3000
npm run build            # production build — must exit 0 before deploying
npm run lint             # next lint (ESLint)
npm run setup:db         # create tables + seed pots/participants/teams/fixtures from data.seed.json
npm run export:invites   # regenerate invite-links.txt
npm run sync:results     # pull WC scores + final standings from football-data.org
npm run sync:odds        # pull Asian Handicap odds from OddsPapi (clean skip if no key)
```

All scripts read `.env.local` (see `.env.example`). `setup:db` is idempotent
(`create table if not exists` + `on conflict` upserts) and rewrites `invite-links.txt`.

## Architecture & Data Flow

```
data.seed.json ──(npm run setup:db)──> Neon Postgres (pots, participants, teams,
                                       draws, fixtures, bet_offers, bet_acceptances)
getAppState()  ──reads DB──> AppState ──> SweepstakeClient (single client component)
sync-results / sync-odds (GitHub Action + manual) ──updates fixtures/teams──> DB
```

- **`src/lib/state.ts`** — `getAppState(inviteToken?)` is the single read path. It runs
  all queries in one `Promise.all`, maps snake_case rows to camelCase domain types, and
  returns one `AppState`. Schema columns added after launch are guaranteed at read time
  via `ensure*` helpers (e.g. `ensureOddsColumns`, `ensureBettingTables`) — mirror this
  pattern when adding columns/tables so deploys need no manual migration.
- **`src/lib/types.ts`** — all domain types. `AppState` is the contract between server
  and client.
- **`src/lib/db.ts`** — `getSql()` returns a cached `postgres` client (SSL required).
  `requireAdminKey()` gates admin routes against `ADMIN_KEY`.
- **`src/lib/demo-state.ts`** — builds a fully mocked `AppState` from `data.seed.json`
  for `/demo` (no DB). Keep it in sync with `types.ts` so the demo previews real UI.
- **`src/lib/betting.ts`** — pure (no DB) aggregation: `buildBettingState` /
  `buildBettingLeaderboard` turn `BetOffer[]` into the leaderboard + per-user slips.
- **`src/app/sweepstake-client.tsx`** — the entire UI, one large client component with
  tabs (`draw`, `pools`, `bet-pool`, `fixtures`, `results`). Server pages pass an
  `initialState` into it.

### API routes (`src/app/api/*`)
- `POST /api/draw` — draws one team for a tier, transactionally, with row locking
  (`for update ... skip locked`) and DB uniqueness constraints to prevent dupes.
- `GET /api/state` — returns `AppState` for polling/refresh.
- `POST /api/admin/result`, `POST /api/admin/verify` — admin-key-gated result override.

## Bet Pool feature

Peer-to-peer betting ledger surfaced on the `bet-pool` tab. Offers are persisted in
`bet_offers` (one creator side vs. opponent side, `winner` or `asian_handicap` market,
`advance_winner` or `ninety_minutes` settlement basis) with child `bet_acceptances`.
The leaderboard ranks by **settled net profit only**; open exposure is shown but does
not affect ordering. The UI's accept/create actions are intentionally disabled
("Accept coming soon") — the shipped scope is the read-only ledger view + persistence.
Settlement is not yet automated.

## Conventions & Pitfalls

- **Postgres numerics come back as strings.** Always coerce money/odds with `toNumber` /
  `toNullableNumber` before returning them in `AppState` (see `state.ts`).
- **Keep `demo-state.ts` aligned with `types.ts`.** A new field on `AppState` must be
  populated in both `getAppState` and `demoState`, or `/demo` and prod diverge.
- **Schema changes:** add to `scripts/setup-db.mjs` *and* an `ensure*` helper in
  `state.ts` (idempotent `if not exists`) so production self-migrates on next read.
- **Never commit `invite-links.txt` / `invite-links.md`** publicly — they contain
  per-participant secret tokens.
- **Auth model:** access is via per-participant invite token (`/invite/[token]`); admin
  surfaces are gated by `ADMIN_KEY`. There is no user login.
- **Money formatting** is Ringgit (`RM...`, `en-MY` locale).

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres connection (SSL required) |
| `ADMIN_KEY` | Yes | Gates admin result-override routes |
| `NEXT_PUBLIC_APP_NAME` | No | App display name |
| `NEXT_PUBLIC_APP_URL` | No | Base URL used when generating invite links |
| `FOOTBALL_DATA_TOKEN` | For sync | football-data.org token for `sync:results` |
| `ODDSPAPI_KEY` | For sync | OddsPapi token for `sync:odds` (skips cleanly if absent) |

## Deployment

Linked Vercel project `fifa-worldcup-2026-sweepstake` (see `.vercel/project.json`).
Pushing to `main` on `origin` (github.com/js9726/fifa_worldcup_2026) triggers an
automatic Vercel production deploy. `.github/workflows/sync-results.yml` runs the
results sync on a schedule.
