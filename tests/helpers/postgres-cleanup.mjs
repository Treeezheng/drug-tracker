import { setTimeout } from 'node:timers/promises';

/** Call after closing every server/repository/pool owned by this fixture. */
export async function dropDisconnectedTestDatabase(admin, database) {
  if (!/^drug_(?:test|opaque)_[0-9a-f]{16}$/.test(database)) throw new Error('Only a generated integration-test database may be removed.');
  // pg-pool.end() can resolve before the underlying client.end() callbacks.
  // FORCE would terminate those closing connections and emit late client errors.
  // Observe actual PostgreSQL disconnection instead, and fail on a leaked client.
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await admin.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1', [database]);
    if (rows[0].count === 0) break;
    if (Date.now() >= deadline) throw new Error(`Integration-test cleanup still has ${rows[0].count} open database connection(s).`);
    await setTimeout(10);
  }
  await admin.query(`DROP DATABASE ${database}`);
}
