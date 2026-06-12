import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();

await loadDotEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://fifa-worldcup-2026-sweepstake.vercel.app").replace(
  /\/+$/,
  ""
);

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Put it in .env.local or the shell before running export:invites.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
const participants = await sql`
  select id, name, invite_token
  from participants
  order by id
`;
await sql.end();

const generatedAt = new Date().toISOString();
const mdLines = [
  "# FIFA World Cup 2026 Sweepstake Invite Links",
  "",
  "Do not commit or share this whole file publicly.",
  "",
  `Generated: ${generatedAt}`,
  `App: ${appUrl}`,
  "",
  "| # | Participant | Invite link |",
  "|---:|---|---|",
  ...participants.map((participant) => {
    const name = cleanDisplayName(participant.name);
    return `| ${participant.id} | ${escapeMarkdown(name)} | [Open invite](${appUrl}/invite/${participant.invite_token}) |`;
  }),
  ""
];

const txtLines = [
  "FIFA World Cup 2026 Sweepstake Invite Links",
  "Do not commit or share this whole file publicly.",
  `Generated: ${generatedAt}`,
  "",
  ...participants.map(
    (participant) => `${cleanDisplayName(participant.name)}: ${appUrl}/invite/${participant.invite_token}`
  ),
  ""
];

await fs.writeFile(path.join(root, "invite-links.md"), mdLines.join("\n"), "utf8");
await fs.writeFile(path.join(root, "invite-links.txt"), txtLines.join("\n"), "utf8");

console.log(`Exported ${participants.length} invite link(s) to invite-links.md and invite-links.txt.`);

async function loadDotEnvLocal() {
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
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\|*_`[\]])/g, "\\$1");
}

function cleanDisplayName(value) {
  return String(value)
    .replace(/^[\u200B-\u200D\u2060\uFEFF]+/, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]+$/, "")
    .trim();
}
