import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

const globalForSql = globalThis as unknown as { sweepstakeSql?: SqlClient };

export function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalForSql.sweepstakeSql) {
    globalForSql.sweepstakeSql = postgres(process.env.DATABASE_URL, {
      ssl: shouldUseSsl(process.env.DATABASE_URL) ? "require" : false,
      max: 3,
      idle_timeout: 20
    });
  }

  return globalForSql.sweepstakeSql;
}

function shouldUseSsl(databaseUrl: string) {
  try {
    const { hostname } = new URL(databaseUrl);
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return true;
  }
}

export function requireAdminKey(key: string | null) {
  const expected = process.env.ADMIN_KEY;

  if (!expected || key !== expected) {
    throw new Error("Invalid admin key");
  }
}
