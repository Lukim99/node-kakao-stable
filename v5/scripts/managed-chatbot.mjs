// Long-running v5 bot with legacy-style join history and a web On/Off dashboard.
// Run from v5: npm run bot:start
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemberHistoryStore } from './bot/member-history-store.mjs';
import { ManagedLegacyBot } from './bot/managed-legacy-bot.mjs';
import { createLiveBotConnection } from './bot/live-client-factory.mjs';
import { createBotControlServer } from './bot/control-server.mjs';

if (!process.argv.includes('--allow-live')) {
  throw new Error('Refusing live bot connection without --allow-live');
}

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(workspace, '..');
const pathFromWorkspace = value => isAbsolute(value) ? value : resolve(workspace, value);
const dataDirectory = pathFromWorkspace(process.env.BOT_DATA_DIR ?? '.bot-data/members');
const statePath = pathFromWorkspace(process.env.BOT_STATE_PATH ?? '.bot-state.json');

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...details })}\n`);
}

const historyStore = new MemberHistoryStore(dataDirectory, { maximumEvents: 50 });
const controller = new ManagedLegacyBot({
  historyStore,
  statePath,
  log,
  createConnection: async () => await createLiveBotConnection({ workspace, repository, log }),
});

if (process.argv.includes('--connect-check')) {
  const status = await controller.connectCheck();
  log('connect-check-ok', { channels: status.initialChannelCount });
  await controller.close();
} else {
  const server = await createBotControlServer({
    controller,
    host: process.env.BOT_CONTROL_HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3_000),
    token: process.env.BOT_ADMIN_TOKEN ?? '',
    log,
  });
  log('control-ready', { host: server.host, port: server.port });

  const autoStart = process.env.BOT_AUTO_START !== 'false';
  await controller.initialize(autoStart).catch(error => {
    log('initial-connect-error', { message: error instanceof Error ? error.message : String(error) });
  });

  let shuttingDown = false;
  const shutdown = async signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutdown', { signal });
    await server.close().catch(() => undefined);
    await controller.close().catch(() => undefined);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void shutdown(signal).finally(() => process.exit(0)); });
  }
}
