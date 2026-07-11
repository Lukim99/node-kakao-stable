// Minimal live "!ping" -> "pong!" bot on AndroidTalkClient.
// Run:  node scripts/ping-pong-bot.mjs --allow-live   (from the v5 workspace)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Long } from 'bson';
import {
  AndroidAuthClient,
  AndroidTalkClient,
  legacyAndroidSubXvcProvider,
} from '@lukim9-kakao/client-android';

if (!process.argv.includes('--allow-live')) throw new Error('Refusing live connection without --allow-live');

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(workspace, '..');
const require = createRequire(import.meta.url);
const { DefaultConfiguration } = require(join(repository, 'node-kakao-now/node-kakao/dist/config.js'));

function loadEnv() {
  const values = {};
  for (const line of readFileSync(resolve(repository, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    values[m[1]] = v;
  }
  return values;
}

const stored = JSON.parse(readFileSync(join(workspace, '.live-auth-credential.json'), 'utf8'));

// advertisement id from the sanitized capture (needed only if the bot ever reacts).
let advertisementId;
try {
  for (const line of readFileSync(join(workspace, 'docs/frida/frames.jsonl'), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = JSON.parse(line);
    if ((f.method === 'JOININFO' || f.method === 'JOINLINK') && typeof f.body?.adid === 'string') advertisementId = f.body.adid;
  }
} catch { /* optional */ }

const configuration = {
  kakaoTalkAppVersion: '25.8.1',
  reportedAndroidOsVersion: '7.1.2',
  deviceModel: 'SM-T870',
  networkType: 0,
  mccmnc: '',
  countryIso: 'not-captured',
  language: 'en',
  protocolVersion: '1',
};

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...details })}\n`);
}

async function obtainCredential() {
  // Prefer a fresh password login (device already registered -> status 0, no passcode).
  try {
    const env = loadEnv();
    if (typeof env.KAKAO_ID === 'string' && typeof env.KAKAO_PW === 'string' && env.KAKAO_ID.length > 0) {
      const auth = new AndroidAuthClient(
        configuration,
        { deviceUuid: stored.deviceUuid, deviceName: configuration.deviceModel, advertisementId: advertisementId ?? '' },
        legacyAndroidSubXvcProvider,
      );
      const result = await auth.login({ id: env.KAKAO_ID, password: env.KAKAO_PW });
      if (result.success) {
        log('auth', { source: 'password-login', status: 0 });
        return result.credential;
      }
      log('auth', { source: 'password-login', status: result.status, note: 'falling back to stored credential' });
    }
  } catch (error) {
    log('auth-error', { message: error instanceof Error ? error.message : String(error) });
  }
  log('auth', { source: 'stored-credential' });
  return { userId: Long.fromString(String(stored.userId)), deviceUuid: stored.deviceUuid, accessToken: stored.accessToken };
}

const credential = await obtainCredential();

const client = new AndroidTalkClient(configuration, {
  locoPublicKey: DefaultConfiguration.locoPEMPublicKey,
  ...(advertisementId === undefined ? {} : { advertisementId }),
});

const channels = new Map(); // chatId string -> AndroidChannelSession (keeps msgId sequence)
function channelFor(chatId) {
  const key = chatId.toString();
  let session = channels.get(key);
  if (session === undefined) { session = client.channel(chatId); channels.set(key, session); }
  return session;
}

client.on('error', (error) => log('error', { message: error.message }));
client.on('close', () => log('closed'));
client.on('message', (message) => {
  const text = typeof message.chatLog?.message === 'string' ? message.chatLog.message : undefined;
  if (text !== '!ping') return;
  log('ping', { chatId: message.chatId.toString() });
  channelFor(message.chatId).sendText('pong!')
    .then(() => log('pong-sent', { chatId: message.chatId.toString() }))
    .catch((error) => log('pong-error', { message: error instanceof Error ? error.message : String(error) }));
});

const login = await client.connect(credential);
log('connected', { channels: login.channels.length, userId: login.userId.toString() });
log('ready', { note: 'send "!ping" in any chat this account is in' });
