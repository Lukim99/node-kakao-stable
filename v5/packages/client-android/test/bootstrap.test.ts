import assert from 'node:assert/strict';
import test from 'node:test';
import { Long } from 'bson';
import { BsonPayloadCodec } from '@lukim9-kakao/protocol-core';
import { FakeLocoServer, createMemoryTransportPair } from '@lukim9-kakao/testkit';
import {
  AndroidChatListPaginationError,
  AndroidReferenceBootstrap,
  androidKakaoTalk11SmT870ReferenceConfiguration,
  createAndroidReferenceSession,
} from '../src/index.js';

function page(eof: boolean, token: number, extra: object = {}): object {
  return {
    chatDatas: [],
    lastChatId: Long.fromNumber(token),
    lastTokenId: Long.fromNumber(token),
    mcmRevision: token,
    delChatIds: [],
    kc: [],
    ltk: Long.ZERO,
    lbk: token,
    eof,
    ...extra,
  };
}

test('bootstrap paginates LOGINLIST and LCHATLIST without a real account', async () => {
  const pair = createMemoryTransportPair();
  let listCalls = 0;
  const server = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      LOGINLIST: () => ({
        data: page(false, 1, {
          userId: Long.fromNumber(7),
          revision: 27,
          revisionInfo: 'fixture',
          minLogId: Long.ZERO,
          sb: 0,
        }),
      }),
      LCHATLIST: () => {
        listCalls += 1;
        return { data: page(true, 2) };
      },
    },
  });
  const session = createAndroidReferenceSession(pair.client);
  const bootstrap = new AndroidReferenceBootstrap(androidKakaoTalk11SmT870ReferenceConfiguration);
  const result = await bootstrap.login(session, {
    userId: Long.fromNumber(7),
    accessToken: 'fixture-token',
    deviceUuid: 'fixture-device',
  });
  assert.equal(listCalls, 1);
  assert.equal(result.userId.toNumber(), 7);
  assert.equal(result.lastTokenId.toNumber(), 2);
  await session.close();
  await server.close();
});

test('bootstrap rejects non-terminating pagination at a deterministic safety limit', async () => {
  const pair = createMemoryTransportPair();
  const server = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      LOGINLIST: () => ({
        data: page(false, 1, {
          userId: Long.ONE,
          revision: 27,
          revisionInfo: 'fixture',
          minLogId: Long.ZERO,
          sb: 0,
        }),
      }),
    },
  });
  const session = createAndroidReferenceSession(pair.client);
  const bootstrap = new AndroidReferenceBootstrap(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    { maximumChatListPages: 1 },
  );
  await assert.rejects(bootstrap.login(session, {
    userId: Long.ONE,
    accessToken: 'fixture-token',
    deviceUuid: 'fixture-device',
  }), AndroidChatListPaginationError);
  await session.close();
  await server.close();
});
