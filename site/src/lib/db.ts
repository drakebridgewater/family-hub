/**
 * The hub's own tables live in the same Postgres database as EmDash
 * (connection from the PG* env vars), in tables EmDash doesn't touch.
 * Without Postgres (EMDASH_DB=sqlite dev mode) callers fall back to memory.
 */
import pg from "pg";

export const pool = process.env.PGHOST ? new pg.Pool({ max: 3 }) : null;

const ready = new Map<string, Promise<unknown>>();

/** Runs a CREATE TABLE IF NOT EXISTS once per process (retried after a failure). */
export function ensureTable(name: string, ddl: string): Promise<unknown> {
	const existing = ready.get(name);
	if (existing) return existing;
	const created = pool!.query(ddl).catch((err: unknown) => {
		ready.delete(name); // retry on the next request
		throw err;
	});
	ready.set(name, created);
	return created;
}
