import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Long } from 'bson';
import {
  AndroidAuthClient,
  AndroidTalkClient,
  legacyAndroidSubXvcProvider,
} from '@lukim9-kakao/client-android';
import { androidReferenceLocoPublicKeyPem } from '@lukim9-kakao/protocol-profiles';

export function parseEnvironment(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match === null) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function optionalText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function optionalJson(path) {
  const source = await optionalText(path);
  return source === undefined ? undefined : JSON.parse(source);
}

async function loadAdvertisementId(workspace, environment) {
  if (environment.KAKAO_ADVERTISEMENT_ID) return environment.KAKAO_ADVERTISEMENT_ID;
  const source = await optionalText(join(workspace, 'docs/frida/frames.jsonl'));
  if (source === undefined) return undefined;
  let advertisementId;
  for (const line of source.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const frame = JSON.parse(line);
    if ((frame.method === 'JOININFO' || frame.method === 'JOINLINK') &&
      typeof frame.body?.adid === 'string') advertisementId = frame.body.adid;
  }
  return advertisementId;
}

export async function loadLocoPublicKey(repository, environment) {
  if (environment.KAKAO_LOCO_PUBLIC_KEY) {
    return environment.KAKAO_LOCO_PUBLIC_KEY.replaceAll('\\n', '\n');
  }
  if (environment.KAKAO_LOCO_PUBLIC_KEY_PATH) {
    return await readFile(resolve(repository, environment.KAKAO_LOCO_PUBLIC_KEY_PATH), 'utf8');
  }
  return androidReferenceLocoPublicKeyPem;
}

export async function loadBotEnvironment(repository) {
  const fileEnvironment = parseEnvironment(
    await optionalText(resolve(repository, '.env.local')) ?? '',
  );
  return { ...fileEnvironment, ...process.env };
}

function storedCredential(value, environment) {
  const userId = environment.KAKAO_USER_ID ?? value?.userId;
  const deviceUuid = environment.KAKAO_DEVICE_UUID ?? value?.deviceUuid;
  const accessToken = environment.KAKAO_ACCESS_TOKEN ?? value?.accessToken;
  if (typeof userId !== 'string' || typeof deviceUuid !== 'string' || typeof accessToken !== 'string') {
    return undefined;
  }
  return { userId: Long.fromString(userId), deviceUuid, accessToken };
}

export async function createLiveBotConnection({ workspace, repository, environment: suppliedEnvironment, log = () => undefined }) {
  const environment = suppliedEnvironment ?? await loadBotEnvironment(repository);
  const stored = await optionalJson(join(workspace, '.live-auth-credential.json'));
  const fallbackCredential = storedCredential(stored, environment);
  const deviceUuid = environment.KAKAO_DEVICE_UUID ?? fallbackCredential?.deviceUuid;
  if (typeof deviceUuid !== 'string' || deviceUuid.length === 0) {
    throw new Error('A registered KAKAO_DEVICE_UUID or local credential file is required');
  }

  const configuration = {
    kakaoTalkAppVersion: environment.KAKAO_APP_VERSION ?? '25.8.1',
    reportedAndroidOsVersion: environment.KAKAO_ANDROID_VERSION ?? '7.1.2',
    deviceModel: environment.KAKAO_DEVICE_MODEL ?? 'SM-T870',
    networkType: Number(environment.KAKAO_NETWORK_TYPE ?? 0),
    mccmnc: environment.KAKAO_MCCMNC ?? '',
    countryIso: environment.KAKAO_COUNTRY_ISO ?? 'KR',
    language: environment.KAKAO_LANGUAGE ?? 'ko',
    protocolVersion: environment.KAKAO_PROTOCOL_VERSION ?? '1',
  };
  const advertisementId = await loadAdvertisementId(workspace, environment);

  let credential = fallbackCredential;
  if (environment.KAKAO_ID && environment.KAKAO_PW) {
    const auth = new AndroidAuthClient(
      configuration,
      {
        deviceUuid,
        deviceName: environment.KAKAO_DEVICE_NAME ?? configuration.deviceModel,
        advertisementId: advertisementId ?? '',
      },
      legacyAndroidSubXvcProvider,
    );
    const result = await auth.login({ id: environment.KAKAO_ID, password: environment.KAKAO_PW });
    if (result.success) {
      credential = result.credential;
      log('auth', { source: 'password-login', status: 0 });
    } else {
      log('auth', { source: 'password-login', status: result.status });
      if (credential === undefined) {
        throw new Error(`Android password authentication failed with status ${result.status}`);
      }
    }
  }
  if (credential === undefined) throw new Error('No usable Kakao credential is configured');

  const client = new AndroidTalkClient(configuration, {
    locoPublicKey: await loadLocoPublicKey(repository, environment),
    ...(advertisementId === undefined ? {} : { advertisementId }),
    pingIntervalMs: Number(environment.BOT_PING_INTERVAL_MS ?? 30_000),
  });
  return { client, credential, configuration };
}
