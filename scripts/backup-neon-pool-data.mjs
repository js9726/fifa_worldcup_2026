import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Put it in .env.local or the shell before running backup.");
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(root, "backups", `neon-pool-${timestamp}`);
await fs.mkdir(backupDir, { recursive: true });

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
const tables = ["sweepstake_groups", "participants", "draws", "bet_offers", "bet_acceptances"];
const manifest = {
  generatedAt: new Date().toISOString(),
  tables: {}
};

for (const table of tables) {
  const [{ exists }] = await sql`
    select to_regclass(${`public.${table}`}) is not null as exists
  `;
  if (!exists) {
    manifest.tables[table] = { exists: false, rows: 0 };
    continue;
  }

  const rows = await sql.unsafe(`select * from ${table} order by 1`);
  await fs.writeFile(path.join(backupDir, `${table}.json`), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  manifest.tables[table] = { exists: true, rows: rows.length };
}

await fs.writeFile(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await sql.end();

console.log(`Backed up Neon pool data to ${backupDir}`);
console.log(JSON.stringify(manifest, null, 2));

async function loadDotEnvLocal() {
  try {
    const envFile = await fs.readFile(path.join(root, ".env.local"), "utf8");
    for (const rawLine of envFile.split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, "");
      const match = line.match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Vercel and CI provide env vars directly.
  }
}
