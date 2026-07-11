import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AndroidAuthClient,
  androidKakaoTalk11SmT870ReferenceConfiguration,
  legacyAndroidSubXvcProvider,
} from '../src/index.js';

const identity = {
  deviceUuid: 'fixture-device',
  deviceName: 'fixture-name',
  advertisementId: 'fixture-adid',
};

test('auth client returns status without exposing failed response payloads', async () => {
  const client = new AndroidAuthClient(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    identity,
    legacyAndroidSubXvcProvider,
    {
      fetchImplementation: async () => new Response(JSON.stringify({ status: -100, secret: 'hidden' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    },
  );
  assert.deepEqual(await client.login({ id: 'fixture-id', password: 'fixture-password' }), {
    success: false,
    status: -100,
  });
});

test('auth login sends the registered device defaults observed on Android', async () => {
  let formBody = '';
  const client = new AndroidAuthClient(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    identity,
    legacyAndroidSubXvcProvider,
    {
      fetchImplementation: async (_input, init) => {
        formBody = String(init?.body);
        return new Response(JSON.stringify({ status: -100 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  );

  await client.login({ id: 'fixture-id', password: 'fixture-password' });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(formBody)), {
    email: 'fixture-id',
    password: 'fixture-password',
    device_uuid: 'fixture-device',
    device_name: 'fixture-name',
    forced: 'false',
    permanent: 'true',
    one_store: 'false',
  });
});

test('auth client maps successful credentials without logging them', async () => {
  const client = new AndroidAuthClient(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    identity,
    legacyAndroidSubXvcProvider,
    {
      fetchImplementation: async () => new Response(JSON.stringify({
        status: 0,
        userId: 7,
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    },
  );
  const result = await client.login({ id: 'fixture-id', password: 'fixture-password' });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.credential.userId.toNumber(), 7);
});

test('auth client generates a passcode with the Android JSON request shape', async () => {
  let requestUrl = '';
  let requestBody: unknown;
  let contentType = '';
  const client = new AndroidAuthClient(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    identity,
    legacyAndroidSubXvcProvider,
    {
      fetchImplementation: async (input, init) => {
        requestUrl = String(input);
        contentType = new Headers(init?.headers).get('content-type') ?? '';
        requestBody = JSON.parse(String(init?.body)) as unknown;
        return new Response(JSON.stringify({
          status: 0,
          passcode: '12345678',
          remainingSeconds: 120,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  );

  assert.deepEqual(
    await client.generatePasscode(
      { id: 'fixture-id', password: 'fixture-password' },
      { deviceOsApiLevel: '25' },
    ),
    { status: 0, passcode: '12345678', remainingSeconds: 120 },
  );
  assert.equal(requestUrl.endsWith('/android/account/passcodeLogin/generate'), true);
  assert.equal(contentType, 'application/json');
  assert.deepEqual(requestBody, {
    email: 'fixture-id',
    password: 'fixture-password',
    permanent: true,
    device: {
      name: 'fixture-name',
      uuid: 'fixture-device',
      model: 'SM-T870',
      osVersion: '25',
      isOneStore: false,
    },
  });
});

test('authenticate runs the device-registration flow then logs in', async () => {
  let loginCalls = 0;
  let registerCalls = 0;
  let shownPasscode: string | undefined;
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const client = new AndroidAuthClient(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    identity,
    legacyAndroidSubXvcProvider,
    {
      fetchImplementation: async (input) => {
        const url = String(input);
        if (url.endsWith('/login.json')) {
          loginCalls += 1;
          return loginCalls === 1
            ? json({ status: -100 }) // device not registered yet
            : json({ status: 0, userId: 7, access_token: 'a', refresh_token: 'r' });
        }
        if (url.endsWith('/passcodeLogin/generate')) {
          return json({ status: 0, passcode: '12345678', remainingSeconds: 120 });
        }
        if (url.endsWith('/passcodeLogin/registerDevice')) {
          registerCalls += 1;
          return registerCalls < 2
            ? json({ status: -100, nextRequestIntervalInSeconds: 0, remainingSeconds: 117 })
            : json({ status: 0 });
        }
        throw new Error(`unexpected endpoint ${url}`);
      },
    },
  );

  const result = await client.authenticate(
    { id: 'fixture-id', password: 'fixture-password' },
    { onPasscodeRequired: (challenge) => { shownPasscode = challenge.passcode; } },
  );

  assert.equal(result.success, true);
  if (result.success) assert.equal(result.credential.userId.toNumber(), 7);
  assert.equal(shownPasscode, '12345678');
  assert.equal(loginCalls, 2);
  assert.ok(registerCalls >= 2);
});

test('authenticate returns immediately when the device is already registered', async () => {
  let passcodeAsked = false;
  const client = new AndroidAuthClient(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    identity,
    legacyAndroidSubXvcProvider,
    {
      fetchImplementation: async () => new Response(JSON.stringify({
        status: 0, userId: 7, access_token: 'a', refresh_token: 'r',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    },
  );
  const result = await client.authenticate(
    { id: 'x', password: 'y' },
    { onPasscodeRequired: () => { passcodeAsked = true; } },
  );
  assert.equal(result.success, true);
  assert.equal(passcodeAsked, false);
});

test('auth client exposes deterministic registration retry metadata', async () => {
  const client = new AndroidAuthClient(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    identity,
    legacyAndroidSubXvcProvider,
    {
      fetchImplementation: async () => new Response(JSON.stringify({
        status: -100,
        nextRequestIntervalInSeconds: 3,
        remainingSeconds: 117,
      }), { status: 409, headers: { 'content-type': 'application/json' } }),
    },
  );

  assert.deepEqual(
    await client.registerPasscodeDevice({ id: 'fixture-id', password: 'fixture-password' }),
    { status: -100, nextRequestIntervalInSeconds: 3, remainingSeconds: 117 },
  );
});
