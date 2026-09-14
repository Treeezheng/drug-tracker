import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postgresConfiguration } from '../server/cloud-postgres.mjs';
import { herokuOptions } from '../server/heroku.mjs';

const DATABASE_URL = 'postgres://synthetic:synthetic@database.example.test/drug';
test('Heroku entry point requires PostgreSQL and the router PORT, never uses local SQLite or insecure flags', () => {
  const env = { DYNO: 'web.1', PORT: '12345', DATABASE_URL, CLOUD_ORIGIN: 'https://drug-tracker-7e9d0c2e62c1.herokuapp.com' };
  const options = herokuOptions(env);
  assert.equal(options.host, '0.0.0.0'); assert.equal(options.port, 12345);
  assert.equal(options.serverOptions.proxyMode, 'heroku');
  assert.equal(options.serverOptions.databaseCaPath, '/usr/lib/ssl/certs/ca-certificates.crt');
  assert.equal(options.serverOptions.origin, env.CLOUD_ORIGIN);
  assert.equal(options.serverOptions.dbPath, undefined);
  for (const changed of [{ DATABASE_URL: '' }, { DYNO: '' }, { PORT: '0' }, { PORT: '65536' }, { PORT: '3e3' },
    { CLOUD_DB_PATH: '/tmp/ignored.sqlite' }, { CLOUD_ALLOW_INSECURE_LOOPBACK: '1' }, { CLOUD_ADMIN_PASSWORD: 'never-log-this' },
    { DRUG_POSTGRES_ALLOW_INSECURE_LOOPBACK: '1' }, { CLOUD_PROXY_MODE: 'caddy-loopback' }]) assert.throws(() => herokuOptions({ ...env, ...changed }));
});
test('PostgreSQL TLS validates certificates and names; URL overrides cannot disable it or change the endpoint', async t => {
  const config = postgresConfiguration({ databaseUrl: `${DATABASE_URL}?sslmode=disable&sslrootcert=/unsafe&sslcert=/key&sslkey=/key&uselibpqcompat=true` });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.minVersion, 'TLSv1.2');
  assert.equal(new URL(config.connectionString).search, '');
  assert.equal(config.ssl.checkServerIdentity, undefined); // Node's default hostname verification stays enabled.
  assert.equal(config.max, 4);
  for (const query of ['host=127.0.0.1', 'user=other', 'options=-c+search_path%3Dpublic', 'ssl=0']) assert.throws(() => postgresConfiguration({ databaseUrl: `${DATABASE_URL}?${query}` }));
  for (const databasePoolSize of [0, 11, 1.5, NaN]) assert.throws(() => postgresConfiguration({ databaseUrl: DATABASE_URL, databasePoolSize }));
  const path = await mkdtemp(join(tmpdir(), 'drug-ca-config-')); t.after(() => rm(path, { force: true, recursive: true }));
  const ca = join(path, 'synthetic-ca.pem'); await writeFile(ca, 'SYNTHETIC TEST CA');
  assert.equal(postgresConfiguration({ databaseUrl: DATABASE_URL, databaseCaPath: ca }).ssl.ca, 'SYNTHETIC TEST CA');
  assert.throws(() => postgresConfiguration({ databaseUrl: DATABASE_URL, databaseCaPath: 'relative.pem' }));
});
test('unencrypted PostgreSQL is test-only and restricted to a numeric loopback address', () => {
  assert.equal(postgresConfiguration({ databaseUrl: 'postgres://test@127.0.0.1/test', allowInsecurePostgresLoopback: true }).ssl, false);
  for (const databaseUrl of [DATABASE_URL, 'postgres://test@localhost/test', 'https://test@127.0.0.1/test']) assert.throws(() => postgresConfiguration({ databaseUrl, allowInsecurePostgresLoopback: true }));
});
