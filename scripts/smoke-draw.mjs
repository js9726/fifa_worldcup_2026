// Concurrency smoke test for the live draw.
//
// Mirrors the exact transaction in src/app/api/draw/route.ts (random pick +
// `for update of t skip locked` + unique(pool_id, team_id)) and hammers it with more
// concurrent participants than there are countries, to prove:
//   * each draw returns a distinct country (no double-draw under load),
//   * drawn countries are removed from the pool immediately,
//   * a re-draw is idempotent (returns the same country, no extra row),
//   * many simultaneous "live pull" reads stay consistent and snappy.
//
// It runs against an ISOLATED test pot (id 9001) with throwaway teams and
// participants, and deletes everything it created in a finally block — real
// pools, teams, draws and participants are never touched.

import fs from "node:fs";
import crypto from "node:crypto";
import postgres from "postgres";

const POT_ID = 9001;
const NUM_TEAMS = 8;
const NUM_PARTICIPANTS = 12; // more people than countries -> forced contention
const TEAM_PREFIX = "__SMOKE_TEAM__";
const PART_PREFIX = "__SMOKE_P__";
const GROUP_SLUG = "__smoke_group__";

let url = "";
const env = fs.readFileSync(".env.local", "utf8");
for (const raw of env.split(/\r?\n/)) {
  const line = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const m = line.match(/^DATABASE_URL=["']?(.*?)["']?$/);
  if (m) {
    url = m[1];
    break;
  }
}
if (!url) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", max: 20 });

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
}

async function cleanup() {
  await sql`delete from draws where pool_id in (select id from sweepstake_groups where slug = ${GROUP_SLUG})`;
  await sql`delete from draws where pot_id = ${POT_ID}`;
  await sql`delete from draws where participant_id in (select id from participants where name like ${PART_PREFIX + "%"})`;
  await sql`delete from teams where pot_id = ${POT_ID}`;
  await sql`delete from participants where name like ${PART_PREFIX + "%"}`;
  await sql`delete from sweepstake_groups where slug = ${GROUP_SLUG}`;
  await sql`delete from pots where id = ${POT_ID}`;
}

// Exact copy of the route's draw transaction.
async function drawOnce(token, potId) {
  return sql.begin(async (tx) => {
    const [participant] = await tx`
      select id, name, pool_id from participants where invite_token = ${token} limit 1
    `;
    if (!participant) throw new Error("Invite link not recognised");

    const [existing] = await tx`
      select t.id, t.country
      from draws d
      join teams t on t.id = d.team_id
      where d.participant_id = ${participant.id}
        and d.pool_id = ${participant.pool_id}
        and d.pot_id = ${potId}
      limit 1
    `;
    if (existing) return { ok: true, reused: true, teamId: existing.id, country: existing.country };

    const [team] = await tx`
      select t.id, t.country
      from teams t
      where t.pot_id = ${potId}
        and not exists (
          select 1 from draws d
          where d.team_id = t.id
            and d.pool_id = ${participant.pool_id}
        )
      order by random()
      limit 1
      for update of t skip locked
    `;
    if (!team) return { ok: false, reason: "empty" };

    await tx`
      insert into draws (pool_id, participant_id, team_id, pot_id)
      values (${participant.pool_id}, ${participant.id}, ${team.id}, ${potId})
    `;
    return { ok: true, reused: false, teamId: team.id, country: team.country };
  });
}

// Mirrors the pot-availability query in getAppState (what "pull live" computes).
async function availability(potId, poolId) {
  const [row] = await sql`
    select
      count(t.id)::int as total,
      count(t.id) filter (where d.id is null)::int as available
    from pots p
    left join teams t on t.pot_id = p.id
    left join draws d on d.team_id = t.id and d.pool_id = ${poolId}
    where p.id = ${potId}
    group by p.id
  `;
  return row;
}

try {
  await cleanup(); // clear any residue from a previous run

  // --- setup isolated fixtures ---------------------------------------------
  await sql`
    create table if not exists sweepstake_groups (
      id serial primary key,
      slug text not null unique,
      name text not null,
      allow_draws boolean not null default true,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    insert into sweepstake_groups (slug, name, allow_draws)
    values (${GROUP_SLUG}, 'Smoke Test Group', true)
    on conflict (slug) do update set allow_draws = true
    returning id
  `;
  const [{ id: groupId }] = await sql`select id from sweepstake_groups where slug = ${GROUP_SLUG} limit 1`;
  await sql`insert into pots (id, name, label, colour) values (${POT_ID}, 'Smoke Pot', 'SMOKE', 'gold')`;
  for (let i = 1; i <= NUM_TEAMS; i += 1) {
    await sql`
      insert into teams (country, pot_id, flag, confed, star_player, player_role, fifa_rank, win_rate, top10_rate, expected_rank)
      values (${TEAM_PREFIX + i}, ${POT_ID}, '🏳', 'TEST', 'Player', 'Role', ${i}, 1, 1, ${i})
    `;
  }
  const tokens = [];
  for (let i = 1; i <= NUM_PARTICIPANTS; i += 1) {
    const tok = crypto.randomBytes(12).toString("hex");
    tokens.push(tok);
    await sql`insert into participants (pool_id, name, invite_token) values (${groupId}, ${PART_PREFIX + i}, ${tok})`;
  }
  console.log(`Setup: pot ${POT_ID} with ${NUM_TEAMS} teams, ${NUM_PARTICIPANTS} participants.\n`);

  // --- 1. concurrent draws --------------------------------------------------
  const t0 = performance.now();
  const results = await Promise.allSettled(tokens.map((tok) => drawOnce(tok, POT_ID)));
  const drawMs = performance.now() - t0;

  const successes = results
    .filter((r) => r.status === "fulfilled" && r.value.ok && !r.value.reused)
    .map((r) => r.value);
  const empties = results.filter((r) => r.status === "fulfilled" && r.value.ok === false).length;
  const errors = results.filter((r) => r.status === "rejected");
  const uniqueTeamIds = new Set(successes.map((s) => s.teamId));

  console.log(`1) Concurrent draw — ${NUM_PARTICIPANTS} participants hit the pot at once (${drawMs.toFixed(0)}ms):`);
  check(`exactly ${NUM_TEAMS} draws succeeded`, successes.length === NUM_TEAMS);
  check("no transaction errored", errors.length === 0);
  check("every drawn country is unique (no double-draw)", uniqueTeamIds.size === successes.length);
  check(`the ${NUM_PARTICIPANTS - NUM_TEAMS} extra participants got "no countries left"`, empties === NUM_PARTICIPANTS - NUM_TEAMS);

  const dupes = await sql`
    select participant_id from draws where pot_id = ${POT_ID}
    group by participant_id having count(*) > 1
  `;
  check("no participant holds more than one country in the pot", dupes.length === 0);

  // --- 2. pool emptied (removed on pull) -----------------------------------
  const after = await availability(POT_ID, groupId);
  console.log("\n2) Pool removal:");
  check(`pool availability is 0/${NUM_TEAMS} after the draws`, after.available === 0 && after.total === NUM_TEAMS);

  // --- 3. idempotent re-draw -----------------------------------------------
  const [{ c: before }] = await sql`select count(*)::int as c from draws where pot_id = ${POT_ID}`;
  const winnerIndex = results.findIndex((r) => r.status === "fulfilled" && r.value.ok && !r.value.reused);
  const firstResult = results[winnerIndex].value;
  const reDraw = await drawOnce(tokens[winnerIndex], POT_ID);
  const [{ c: afterCount }] = await sql`select count(*)::int as c from draws where pot_id = ${POT_ID}`;
  console.log("\n3) Re-draw safety (pressing Draw again):");
  check("returns the same country, no new row inserted", reDraw.reused === true && reDraw.country === firstResult.country && afterCount === before);

  // --- 4. live pull under load ---------------------------------------------
  const READS = 25;
  const t1 = performance.now();
  const reads = await Promise.all(
    Array.from({ length: READS }, () => {
      const s = performance.now();
      return availability(POT_ID, groupId).then((r) => ({ available: r.available, ms: performance.now() - s }));
    })
  );
  const wallMs = performance.now() - t1;
  const maxReadMs = Math.max(...reads.map((x) => x.ms));
  console.log(`\n4) Live pull — ${READS} clients reading at once (${wallMs.toFixed(0)}ms wall, slowest ${maxReadMs.toFixed(0)}ms):`);
  check("all concurrent reads agree the pool is empty (no lag/stale)", reads.every((x) => x.available === 0));
  check(`slowest read under 3000ms (${maxReadMs.toFixed(0)}ms)`, maxReadMs < 3000);

  console.log(`\n${failures ? `FAILED — ${failures} check(s) failed.` : "ALL CHECKS PASSED."}`);
} finally {
  await cleanup();
  await sql.end();
}

process.exit(failures ? 1 : 0);
