import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();

try {
  const envFile = await fs.readFile(path.join(root, ".env.local"), "utf8");
  for (const rawLine of envFile.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "");
    const match = line.match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // GitHub Actions and Vercel provide env vars directly.
}

const databaseUrl = process.env.DATABASE_URL;
const resultsApiUrl = process.env.RESULTS_API_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!resultsApiUrl) {
  console.log("RESULTS_API_URL is not configured. Skipping result sync without changing Neon.");
  process.exit(0);
}

const response = await fetch(resultsApiUrl, {
  headers: process.env.RESULTS_API_KEY
    ? { Authorization: `Bearer ${process.env.RESULTS_API_KEY}` }
    : undefined
});

if (!response.ok) {
  throw new Error(`Result feed failed: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
const fixtures = Array.isArray(payload.fixtures) ? payload.fixtures : [];
const teams = Array.isArray(payload.teams) ? payload.teams : [];
const sql = postgres(databaseUrl, { ssl: "require", max: 1 });

await sql.begin(async (tx) => {
  for (const fixture of fixtures) {
    const homeScore = Number.isFinite(Number(fixture.homeScore)) ? Number(fixture.homeScore) : null;
    const awayScore = Number.isFinite(Number(fixture.awayScore)) ? Number(fixture.awayScore) : null;

    if (fixture.id) {
      await tx`
        update fixtures
        set home_score = ${homeScore},
            away_score = ${awayScore}
        where id = ${Number(fixture.id)}
      `;
      continue;
    }

    if (fixture.home && fixture.away) {
      await tx`
        update fixtures
        set home_score = ${homeScore},
            away_score = ${awayScore}
        where home_country = ${fixture.home}
          and away_country = ${fixture.away}
      `;
    }
  }

  for (const team of teams) {
    if (!team.country) continue;

    const finalRank = Number.isFinite(Number(team.finalRank)) ? Number(team.finalRank) : null;
    await tx`
      update teams
      set final_rank = ${finalRank},
          eliminated_stage = ${team.eliminatedStage || null},
          result_note = ${team.resultNote || null},
          updated_at = now()
      where country = ${team.country}
    `;
  }
});

await sql.end();

console.log(`Synced ${fixtures.length} fixture result(s) and ${teams.length} team status update(s).`);
