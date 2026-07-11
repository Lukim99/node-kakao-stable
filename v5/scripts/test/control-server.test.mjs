import assert from 'node:assert/strict';
import test from 'node:test';
import { createBotControlServer } from '../bot/control-server.mjs';

test('control server protects status and On/Off operations with a bearer token', async t => {
  let running = false;
  const controller = {
    status: () => ({ desiredRunning: running, state: running ? 'on' : 'off' }),
    start: async () => { running = true; return controller.status(); },
    stop: async () => { running = false; return controller.status(); },
  };
  const server = await createBotControlServer({
    controller,
    host: '127.0.0.1',
    port: 0,
    token: 'fixture-control-token',
  });
  t.after(async () => await server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  const headers = { Authorization: 'Bearer fixture-control-token' };
  const started = await fetch(`${base}/api/bot/on`, { method: 'POST', headers });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).state, 'on');
  const stopped = await fetch(`${base}/api/bot/off`, { method: 'POST', headers });
  assert.equal((await stopped.json()).state, 'off');
});

test('remote control binding requires a strong token', async () => {
  await assert.rejects(
    createBotControlServer({ controller: { status: () => ({}) }, host: '0.0.0.0', port: 0 }),
    /BOT_ADMIN_TOKEN/,
  );
});
