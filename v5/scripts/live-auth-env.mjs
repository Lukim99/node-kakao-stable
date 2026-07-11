import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AndroidAuthClient,
  legacyAndroidSubXvcProvider,
} from '@lukim9-kakao/client-android';

if (!process.argv.includes('--allow-live')) throw new Error('Refusing live auth without --allow-live');

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(workspace, '..');

function loadEnvironment() {
  const values = {};
  for (const line of readFileSync(resolve(repository, '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match === null) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function capturedIdentity() {
  let deviceUuid;
  let advertisementId;
  for (const line of readFileSync(resolve(workspace, 'docs/frida/frames.jsonl'), 'utf8').split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const frame = JSON.parse(line);
    if (frame.method === 'LOGINLIST' && typeof frame.body?.oauthToken === 'string' &&
      typeof frame.body.duuid === 'string') deviceUuid = frame.body.duuid;
    if ((frame.method === 'JOININFO' || frame.method === 'JOINLINK') &&
      typeof frame.body?.adid === 'string') advertisementId = frame.body.adid;
  }
  if (deviceUuid === undefined) throw new Error('Captured registered device UUID is unavailable');
  return { deviceUuid, advertisementId: advertisementId ?? randomUUID() };
}

const environment = loadEnvironment();
if (typeof environment.KAKAO_ID !== 'string' || typeof environment.KAKAO_PW !== 'string') {
  throw new Error('KAKAO_ID/KAKAO_PW are required in .env.local');
}
const captured = capturedIdentity();
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
const diagnosticFetch = async (...arguments_) => {
  const response = await fetch(...arguments_);
  try {
    const body = await response.clone().json();
    const shape = typeof body === 'object' && body !== null
      ? Object.fromEntries(Object.entries(body).map(([key, value]) => [
        key,
        value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
      ]))
      : typeof body;
    process.stdout.write(`${JSON.stringify({
      stage: 'auth-response-shape',
      httpStatus: response.status,
      shape,
    })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({
      stage: 'auth-response-shape',
      httpStatus: response.status,
      shape: 'non-json',
    })}\n`);
  }
  return response;
};
const client = new AndroidAuthClient(
  configuration,
  { ...captured, deviceName: 'SM-T870' },
  legacyAndroidSubXvcProvider,
  { fetchImplementation: diagnosticFetch },
);
const form = { id: environment.KAKAO_ID, password: environment.KAKAO_PW };

function storePasscode(passcode) {
  writeFileSync(resolve(workspace, '.live-auth-passcode'), `${passcode}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function storeCredential(credential) {
  writeFileSync(resolve(workspace, '.live-auth-credential.json'), JSON.stringify({
    userId: credential.userId.toString(),
    deviceUuid: credential.deviceUuid,
    accessToken: credential.accessToken,
    refreshToken: credential.refreshToken,
  }), { encoding: 'utf8', mode: 0o600 });
}

if (process.argv.includes('--complete-passcode-flow')) {
  const challenge = await client.generatePasscode(form, {
    deviceOsApiLevel: environment.KAKAO_ANDROID_API_LEVEL ?? '35',
  });
  if (challenge.status !== 0 || typeof challenge.passcode !== 'string') {
    process.stdout.write(`${JSON.stringify({
      stage: 'generate-passcode', success: false, status: challenge.status,
    })}\n`);
    process.exitCode = 1;
  } else {
    storePasscode(challenge.passcode);
    process.stdout.write(`${JSON.stringify({
      stage: 'generate-passcode',
      success: true,
      passcodeIssued: true,
      remainingSeconds: challenge.remainingSeconds,
    })}\n`);
    let remainingSeconds = challenge.remainingSeconds ?? 60;
    let registered = false;
    while (remainingSeconds > 0 && !registered) {
      const attempt = await client.registerPasscodeDevice(form);
      process.stdout.write(`${JSON.stringify({
        stage: 'register-device-poll',
        success: attempt.status === 0,
        status: attempt.status,
        remainingSeconds: attempt.remainingSeconds,
      })}\n`);
      if (attempt.status === 0) {
        registered = true;
        break;
      }
      if (attempt.status !== -100) break;
      remainingSeconds = attempt.remainingSeconds ?? remainingSeconds - 3;
      const intervalSeconds = attempt.nextRequestIntervalInSeconds ?? 3;
      await new Promise(resolvePromise => setTimeout(resolvePromise, intervalSeconds * 1_000));
      remainingSeconds -= intervalSeconds;
    }
    if (registered) {
      const result = await client.login(form);
      if (result.success) storeCredential(result.credential);
      process.stdout.write(`${JSON.stringify({
        stage: 'v5-password-auth',
        success: result.success,
        status: result.status,
        credentialIssued: result.success,
      })}\n`);
      if (!result.success) process.exitCode = 1;
    } else {
      process.exitCode = 1;
    }
  }
} else if (process.argv.includes('--generate-passcode')) {
  const result = await client.generatePasscode(form, {
    deviceOsApiLevel: environment.KAKAO_ANDROID_API_LEVEL ?? '35',
  });
  const passcodeIssued = typeof result.passcode === 'string' && result.passcode.length > 0;
  if (passcodeIssued) storePasscode(result.passcode);
  process.stdout.write(`${JSON.stringify({
    stage: 'generate-passcode',
    success: result.status === 0,
    status: result.status,
    passcodeIssued,
    remainingSeconds: result.remainingSeconds,
  })}\n`);
} else if (process.argv.includes('--poll-register-once')) {
  const result = await client.registerPasscodeDevice(form);
  process.stdout.write(`${JSON.stringify({
    stage: 'register-device-poll',
    success: result.status === 0,
    status: result.status,
    nextRequestIntervalInSeconds: result.nextRequestIntervalInSeconds,
    remainingSeconds: result.remainingSeconds,
  })}\n`);
} else {
  const result = await client.login(form);
  if (result.success) storeCredential(result.credential);
  process.stdout.write(`${JSON.stringify({
    stage: 'v5-password-auth',
    success: result.success,
    status: result.status,
    credentialIssued: result.success,
  })}\n`);
}
