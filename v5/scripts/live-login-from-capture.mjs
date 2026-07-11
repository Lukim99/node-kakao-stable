import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BSON, Long } from 'bson';
import { BsonPayloadCodec } from '@lukim9-kakao/protocol-core';
import { LocoSession } from '@lukim9-kakao/transport-node';
import {
  NodeTcpTransport,
  NodeTlsTransport,
  LocoSecureTransport,
} from '@lukim9-kakao/transport-node';
import {
  AndroidReferenceBootstrap,
  createAndroidReferenceSession,
  createCheckinRequest,
  createLoginListRequest,
} from '@lukim9-kakao/client-android';

if (!process.argv.includes('--allow-live')) {
  throw new Error('Refusing live connection without --allow-live');
}

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '..');
const repository = resolve(workspace, '..');
const require = createRequire(import.meta.url);
const { DefaultConfiguration } = require(join(
  repository,
  'node-kakao-now/node-kakao/dist/config.js',
));

function framesFrom(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 22 <= buffer.byteLength) {
    const payloadLength = buffer.readUInt32LE(offset + 18);
    const end = offset + 22 + payloadLength;
    if (end > buffer.byteLength) break;
    let method = '';
    for (let index = offset + 6; index < offset + 17; index += 1) {
      const code = buffer[index];
      if (code === 0) break;
      if (code < 0x21 || code > 0x7e) return frames;
      method += String.fromCharCode(code);
    }
    if (method.length === 0) break;
    const body = payloadLength === 0
      ? {}
      : BSON.deserialize(buffer.subarray(offset + 22, end));
    frames.push({ method, body });
    offset = end;
  }
  return frames;
}

function capturedOutgoingRequests() {
  const requests = new Map();
  const recordsPath = join(workspace, 'docs/frida/records.jsonl');
  for (const line of readFileSync(recordsPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const record = JSON.parse(line);
    if (typeof record.input !== 'string') continue;
    let bytes = Buffer.from(record.input, 'base64');
    if (Number.isInteger(record.off) && Number.isInteger(record.len)) {
      bytes = bytes.subarray(record.off, record.off + record.len);
    }
    for (const frame of framesFrom(bytes)) requests.set(frame.method, frame.body);
  }
  return requests;
}

function logStage(stage, details = {}) {
  process.stdout.write(`${JSON.stringify({ stage, ...details })}\n`);
}

function typeShape(value, depth = 0) {
  if (value === null || value === undefined) return 'null';
  if (value?._bsontype === 'Long') return 'Long';
  if (value?._bsontype === 'Binary') return 'binary';
  if (Array.isArray(value)) return value.length === 0
    ? 'array<?> '
    : { array: typeShape(value[0], depth + 1) };
  if (typeof value !== 'object') return typeof value;
  if (depth >= 2) return 'object';
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeShape(item, depth + 1)]));
}

const requests = capturedOutgoingRequests();
const capturedCheckin = requests.get('CHECKIN');
const capturedLogin = requests.get('LOGINLIST');
if (capturedCheckin === undefined || capturedLogin === undefined) {
  throw new Error('Captured CHECKIN and LOGINLIST requests are required');
}

const configuration = {
  kakaoTalkAppVersion: capturedLogin.appVer,
  reportedAndroidOsVersion: 'not-captured',
  deviceModel: 'SM-T870',
  networkType: capturedLogin.ntype,
  mccmnc: capturedLogin.MCCMNC,
  countryIso: 'not-captured',
  language: capturedLogin.lang,
  protocolVersion: capturedLogin.prtVer,
};
let credential;
try {
  const stored = JSON.parse(readFileSync(join(workspace, '.live-auth-credential.json'), 'utf8'));
  if (typeof stored.userId === 'string' && typeof stored.deviceUuid === 'string' &&
    typeof stored.accessToken === 'string') {
    credential = {
      userId: Long.fromString(stored.userId),
      deviceUuid: stored.deviceUuid,
      accessToken: stored.accessToken,
    };
  }
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}
const checkinRequest = credential === undefined
  ? capturedCheckin
  : createCheckinRequest(configuration, credential.userId);
const loginRequest = credential === undefined
  ? capturedLogin
  : createLoginListRequest(configuration, credential, {
    revision: 0,
    background: true,
  });
const bootstrap = new AndroidReferenceBootstrap(configuration);
const timeout = () => AbortSignal.timeout(15_000);

let bookingSession;
let checkinSession;
let loginSession;
try {
  logStage('booking-connect');
  const bookingTransport = await NodeTlsTransport.connect({
    host: 'booking-loco.kakao.com',
    port: 443,
    servername: 'booking-loco.kakao.com',
    signal: timeout(),
  });
  bookingSession = new LocoSession(bookingTransport, new BsonPayloadCodec());
  const configurationResponse = await bootstrap.getConfiguration(bookingSession);
  logStage('booking-ok', {
    revision: configurationResponse.revision,
    checkinHostCount: configurationResponse.ticket.lsl.length,
    portCount: configurationResponse.wifi.ports.length,
  });
  await bookingSession.close();
  bookingSession = undefined;

  const checkinHost = configurationResponse.ticket.lsl[0];
  const checkinPort = configurationResponse.wifi.ports[0];
  if (checkinHost === undefined || checkinPort === undefined) {
    throw new Error('Booking response contains no checkin endpoint');
  }

  logStage('checkin-connect');
  const checkinTcp = await NodeTcpTransport.connect({
    host: checkinHost,
    port: checkinPort,
    signal: timeout(),
  });
  const checkinSecure = new LocoSecureTransport(checkinTcp, {
    publicKey: DefaultConfiguration.locoPEMPublicKey,
  });
  checkinSession = createAndroidReferenceSession(checkinSecure);
  const checkinResponse = await checkinSession.request('CHECKIN', checkinRequest, {
    timeoutMs: 15_000,
  });
  logStage('checkin-ok', { port: checkinResponse.port });
  await checkinSession.close();
  checkinSession = undefined;

  logStage('login-connect');
  const loginTcp = await NodeTcpTransport.connect({
    host: checkinResponse.host,
    port: checkinResponse.port,
    signal: timeout(),
  });
  const loginSecure = new LocoSecureTransport(loginTcp, {
    publicKey: DefaultConfiguration.locoPEMPublicKey,
  });
  loginSession = new LocoSession(loginSecure, new BsonPayloadCodec());
  const loginResponse = await loginSession.request('LOGINLIST', loginRequest, {
    timeoutMs: 20_000,
  });
  if (typeof loginResponse.status === 'number' && loginResponse.status !== 0) {
    logStage('login-payload-error', {
      status: loginResponse.status,
      keys: Object.keys(loginResponse),
    });
    throw new Error(`LOGINLIST payload status ${loginResponse.status}`);
  }
  logStage('login-ok', {
    credentialSource: credential === undefined ? 'capture' : 'password-auth',
    revision: loginResponse.revision,
    channelCount: loginResponse.chatDatas.length,
    removedChannelCount: loginResponse.delChatIds.length,
    eof: loginResponse.eof,
    shape: typeShape(loginResponse),
  });
} catch (error) {
  logStage('failed', {
    errorName: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : 'Unknown error',
    status: typeof error === 'object' && error !== null && 'status' in error
      ? error.status
      : undefined,
  });
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    bookingSession?.close(),
    checkinSession?.close(),
    loginSession?.close(),
  ].filter(Boolean));
}
