import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDoseServer } from '../server/index.mjs';

test('/drug API alias preserves local-only access, authentication and private cache headers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'drug-base-path-'));
  const { server } = await createDoseServer({ dbPath: join(dir, 'fixture.sqlite'), port: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/health', '/drug/api/health']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).storage, 'local-sqlite');
  }
  const privateResponse = await fetch(base + '/drug/api/data');
  assert.equal(privateResponse.status, 401);
  assert.equal(privateResponse.headers.get('cache-control'), 'no-store');
  const forbidden = await fetch(base + '/drug/api/health', { headers: { Origin: 'https://treeezh.com' } });
  assert.equal(forbidden.status, 403);
  const setup = await fetch(base + '/drug/api/auth/local-setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ password: 'synthetic-base-path-password' }) });
  assert.equal(setup.status, 201);
  const user = (await setup.json()).user;
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const session = await fetch(base + '/drug/api/session', { headers: { Cookie: cookie } });
  assert.equal((await session.json()).user.id, user.id);
});
