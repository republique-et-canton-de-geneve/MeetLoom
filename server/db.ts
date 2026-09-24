import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

export interface Sql {
  all<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<T[]>;
  run(sql: string, values?: unknown[]): Promise<number>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Ends startup schema creation. With PostgreSQL, several application pods
   * may start at once: a lock taken in openDatabase serializes their
   * CREATE ... IF NOT EXISTS statements until this is called. */
  releaseStartupLock?(): Promise<void>;
}

const schema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, locale TEXT NOT NULL, password TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bootstrap (id INTEGER PRIMARY KEY CHECK (id = 1), user_id TEXT NOT NULL REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, expires_at BIGINT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS members (session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('editor','facilitator','viewer')), PRIMARY KEY(session_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, block_id TEXT, user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, payload TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS presence_heartbeats (session_id TEXT NOT NULL, user_id TEXT NOT NULL, client_id TEXT NOT NULL, block_id TEXT, editing INTEGER NOT NULL, last_seen BIGINT NOT NULL, PRIMARY KEY (session_id, user_id, client_id))`,
  `CREATE INDEX IF NOT EXISTS presence_heartbeats_seen_idx ON presence_heartbeats(last_seen)`,
  `CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions(owner_id)`,
  `CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id)`,
  `CREATE INDEX IF NOT EXISTS shares_session_idx ON shares(session_id)`,
  `CREATE INDEX IF NOT EXISTS versions_session_idx ON versions(session_id,created_at)`,
  `CREATE INDEX IF NOT EXISTS comments_session_idx ON comments(session_id,created_at)`,
];

export async function openDatabase(
  options: { databaseUrl?: string; sqlitePath?: string } = {},
): Promise<Database> {
  let database: Database;
  if (options.databaseUrl) {
    // pg verifies TLS certificates when the connection URL requests TLS; no insecure override.
    const pool = new Pool({
      connectionString: options.databaseUrl,
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
    });
    const executor = (client: Pool | PoolClient): Sql => ({
      all: async <T>(text: string, values: unknown[] = []) =>
        (await client.query(text, values)).rows as T[],
      run: async (text, values = []) =>
        (await client.query(text, values)).rowCount ?? 0,
    });
    // Scoped to the schema, so separate schemas (tests) never wait on each other.
    const startup = await pool.connect();
    try {
      await startup.query(
        "SELECT pg_advisory_lock(hashtext(current_schema()))",
      );
    } catch (error) {
      startup.release();
      await pool.end();
      throw error;
    }
    let locked = true;
    const releaseStartupLock = async () => {
      if (!locked) return;
      locked = false;
      try {
        await startup.query(
          "SELECT pg_advisory_unlock(hashtext(current_schema()))",
        );
      } finally {
        startup.release();
      }
    };
    database = {
      ...executor(pool),
      releaseStartupLock,
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(executor(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      async close() {
        await releaseStartupLock();
        await pool.end();
      },
    };
  } else {
    const file = options.sqlitePath ?? "data/meetloom.sqlite";
    if (file !== ":memory:")
      mkdirSync(dirname(resolve(file)), { recursive: true });
    const sqlite = new DatabaseSync(file);
    sqlite.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
    );
    // All connection use goes through the queue, including reads. Otherwise a read
    // from another request could run inside an unrelated SQLite transaction.
    let tail: Promise<unknown> = Promise.resolve();
    const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
      const task = tail.then(fn, fn);
      tail = task.catch(() => undefined);
      return task;
    };
    const prepare = (text: string, values: unknown[] = []) => {
      const ordered: (string | number | null)[] = [];
      const query = text.replace(/\$(\d+)/g, (_, index: string) => {
        ordered.push(values[Number(index) - 1] as string | number | null);
        return "?";
      });
      return { statement: sqlite.prepare(query), ordered };
    };
    const direct: Sql = {
      async all<T>(text: string, values: unknown[] = []) {
        const { statement, ordered } = prepare(text, values);
        return statement.all(...ordered) as T[];
      },
      async run(text, values = []) {
        const { statement, ordered } = prepare(text, values);
        return Number(statement.run(...ordered).changes);
      },
    };
    database = {
      all: <T>(text: string, values?: unknown[]) =>
        serialized(() => direct.all<T>(text, values)),
      run: (text, values) => serialized(() => direct.run(text, values)),
      transaction: (fn) =>
        serialized(async () => {
          sqlite.exec("BEGIN IMMEDIATE");
          try {
            const result = await fn(direct);
            sqlite.exec("COMMIT");
            return result;
          } catch (error) {
            sqlite.exec("ROLLBACK");
            throw error;
          }
        }),
      close: () =>
        serialized(async () => {
          sqlite.close();
        }),
    };
  }
  try {
    await database.transaction(async (sql) => {
      for (const statement of schema) await sql.run(statement);
    });
  } catch (error) {
    await database.close();
    throw error;
  }
  return database;
}
