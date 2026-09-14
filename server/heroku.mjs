import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCloudServer, CloudError } from './cloud.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Heroku-only entry point. Never fall back to an ephemeral SQLite file or a local frontend. */
export function herokuOptions(env = process.env) {
  if (!env.DYNO) throw new CloudError(400, 'Use this entry point only inside the Heroku dyno runtime.');
  if (!env.DATABASE_URL) throw new CloudError(400, 'Attach a PostgreSQL database before starting the Heroku edition.');
  if (env.CLOUD_DB_PATH || env.CLOUD_ALLOW_INSECURE_LOOPBACK || env.CLOUD_ADMIN_PASSWORD || env.DRUG_POSTGRES_ALLOW_INSECURE_LOOPBACK)
    throw new CloudError(400, 'Remove local database, insecure-development and bootstrap settings from the Heroku app.');
  const port = Number(env.PORT);
  if (!/^\d+$/.test(env.PORT ?? '') || !Number.isInteger(port) || port < 1 || port > 65535) throw new CloudError(400, 'Heroku must supply a valid PORT.');
  return { port, host: '0.0.0.0', serverOptions: {
    databaseUrl: env.DATABASE_URL, databaseCaPath: env.DATABASE_CA_PATH || '/usr/lib/ssl/certs/ca-certificates.crt',
    databasePoolSize: env.DATABASE_POOL_SIZE === undefined ? 4 : Number(env.DATABASE_POOL_SIZE),
    origin: env.CLOUD_ORIGIN, proxyMode: 'heroku', distDir: join(ROOT, 'dist'),
  } };
}
async function main() {
  if (process.argv.length > 2) throw new CloudError(400, 'The Heroku web entry point accepts no command arguments.');
  const { port, host, serverOptions } = herokuOptions();
  const { server, closeStorage } = await createCloudServer(serverOptions);
  server.listen(port, host, () => process.stdout.write('Drug Tracker cloud web process is ready at /drug/.\n'));
  server.on('error', async () => { await closeStorage().catch(() => {}); process.stderr.write('Drug Tracker cloud could not start.\n'); process.exitCode = 1; });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 25_000);
    deadline.unref();
    server.close(async () => { await closeStorage().catch(() => {}); clearTimeout(deadline); });
    server.closeIdleConnections();
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error instanceof CloudError ? error.message : 'Drug Tracker cloud could not start. Check the database connection and cloud build.'}\n`); process.exitCode = 1; });
}
