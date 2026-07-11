// Live bot: greets join/leave, and hides a replied-to message on "!가리기".
// Run:  node scripts/greeter-hide-bot.mjs --allow-live   (from the v5 workspace)
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

const stored = JSON.parse(readFileSync(join(workspace, '.live-auth-credential.json'), 'utf8'));

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

function loadEnv() {
  const values = {};
  try {
    for (const line of readFileSync(resolve(repository, '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) values[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* optional */ }
  return values;
}

const toLong = (value) => (Long.isLong(value) ? value : Long.fromValue(value));

async function obtainCredential() {
  const env = loadEnv();
  if (env.KAKAO_ID && env.KAKAO_PW) {
    try {
      const auth = new AndroidAuthClient(
        configuration,
        { deviceUuid: stored.deviceUuid, deviceName: configuration.deviceModel, advertisementId: advertisementId ?? '' },
        legacyAndroidSubXvcProvider,
      );
      const result = await auth.login({ id: env.KAKAO_ID, password: env.KAKAO_PW });
      if (result.success) { log('auth', { source: 'password-login' }); return result.credential; }
      log('auth', { source: 'password-login', status: result.status, note: 'using stored credential' });
    } catch (error) { log('auth-error', { message: String(error?.message ?? error) }); }
  }
  log('auth', { source: 'stored-credential' });
  return { userId: Long.fromString(String(stored.userId)), deviceUuid: stored.deviceUuid, accessToken: stored.accessToken };
}

const credential = await obtainCredential();

const client = new AndroidTalkClient(configuration, {
  locoPublicKey: DefaultConfiguration.locoPEMPublicKey,
  ...(advertisementId === undefined ? {} : { advertisementId }),
});

const channels = new Map();
function channelFor(chatId) {
  const key = chatId.toString();
  let session = channels.get(key);
  if (session === undefined) { session = client.channel(chatId); channels.set(key, session); }
  return session;
}

client.on('error', (error) => log('error', { message: error.message }));
client.on('close', () => log('closed'));

// 1) 입장/퇴장 인사
client.on('memberJoin', (feed, channelId) => {
  for (const nick of feed.nicknames) {
    channelFor(channelId).sendText(`${nick}님 안녕하세요!`).catch((e) => log('greet-error', { message: e.message }));
    log('greet-join', { channelId: channelId.toString(), nick });
  }
});
client.on('memberLeave', (feed, channelId) => {
  for (const nick of feed.nicknames) {
    channelFor(channelId).sendText(`${nick}님 안녕히가세요.`).catch((e) => log('greet-error', { message: e.message }));
    log('greet-leave', { channelId: channelId.toString(), nick, kicked: feed.kicked });
  }
});

// 2) 커뮤니티 오픈채팅에서 특정 메시지에 "!가리기" 댓글 -> 그 부모 메시지 가리기 (host 권한 필요)
// 댓글 = threadId(부모 logId) + scope 3 이 붙은 메시지.
client.on('message', async (message) => {
  const cl = message.chatLog;
  if (cl?.message !== '!가리기') return;
  if (message.li === undefined) { log('hide-skip', { reason: 'no linkId (not open chat)' }); return; }
  const parent = cl.threadId;
  if (parent === undefined) {
    // 수신 댓글에 threadId가 없으면 여기서 실제 구조를 찍어 확인한다.
    log('hide-skip', { reason: 'no threadId (not a comment)', scope: cl.scope, chatLogKeys: Object.keys(cl), attachment: cl.attachment });
    return;
  }
  const linkId = typeof message.li === 'number' ? message.li : message.li.toNumber();
  try {
    await client.hideMessages(linkId, toLong(message.chatId), [{ logId: toLong(parent), type: 1 }]);
    log('hidden', { chatId: message.chatId.toString(), parentLogId: toLong(parent).toString() });
  } catch (error) {
    log('hide-error', { message: String(error?.message ?? error) });
  }
});

const login = await client.connect(credential);
log('connected', { channels: login.channels.length, userId: login.userId.toString() });
log('ready', { note: '입장/퇴장 인사 + 특정 메시지에 답장으로 "!가리기" -> 가리기' });
