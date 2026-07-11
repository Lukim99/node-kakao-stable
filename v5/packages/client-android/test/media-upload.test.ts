import assert from 'node:assert/strict';
import test from 'node:test';
import { Long } from 'bson';
import { BsonPayloadCodec, type LocoRequestUnion } from '@lukim9-kakao/protocol-core';
import type { AndroidReferenceCommands, ChatlogDocument } from '@lukim9-kakao/protocol-android';
import { LocoSession } from '@lukim9-kakao/transport-node';
import { FakeLocoServer, createMemoryTransportPair } from '@lukim9-kakao/testkit';
import {
  AndroidMediaAbortedError,
  AndroidMediaCompleteError,
  AndroidMediaTimeoutError,
  sendMedia,
  sendMultiMedia,
  type AndroidMediaConnection,
  type AndroidMediaConnectionFactory,
} from '../src/index.js';

type Requests = LocoRequestUnion<AndroidReferenceCommands>;

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    throw new Error(`Missing fixture field ${key}`);
  }
  return (value as Record<string, unknown>)[key];
}

function chatLog(type: number, msgId: number): ChatlogDocument {
  return {
    logId: Long.fromNumber(500),
    chatId: Long.fromNumber(100),
    type,
    authorId: Long.ONE,
    message: '',
    sendAt: 123,
    attachment: '{}',
    msgId,
    prevId: Long.fromNumber(499),
  };
}

function sessionFor(pair: ReturnType<typeof createMemoryTransportPair>): LocoSession<AndroidReferenceCommands> {
  return new LocoSession<AndroidReferenceCommands>(
    pair.client,
    new BsonPayloadCodec<Requests, unknown>(),
  );
}

const context = {
  publicKey: 'test-key',
  userId: Long.fromNumber(77),
  appVersion: '25.8.1',
  networkType: 0,
  mccmnc: '450',
} as const;

test('single media owns bytes, uses captured photo POST fields, and returns COMPLETE chatlog', async () => {
  const controlPair = createMemoryTransportPair();
  const data = new Uint8Array([1, 2, 3, 4]);
  const controlServer = new FakeLocoServer(controlPair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      SHIP: (request) => {
        assert.equal(field(request, 'ex'), '{}');
        data[0] = 99;
        return { data: { k: 'key', vh: 'media.test', vh6: '::1', p: 1, rd: false, status: 0 } };
      },
    },
  });
  const controlSession = sessionFor(controlPair);
  const mediaServers: FakeLocoServer[] = [];
  const written: number[] = [];
  const connectionFactory: AndroidMediaConnectionFactory = async (): Promise<AndroidMediaConnection> => {
    const pair = createMemoryTransportPair();
    let server!: FakeLocoServer;
    server = new FakeLocoServer(pair.server, {
      codec: new BsonPayloadCodec<object, unknown>(),
      handlers: {
        POST: (request) => {
          assert.equal(field(request, 'f'), null);
          assert.equal(field(request, 'mid'), 41);
          assert.equal(field(request, 'dt'), 1);
          assert.equal(field(request, 'scp'), 1);
          return { data: { status: 0, o: 0 } };
        },
      },
    });
    mediaServers.push(server);
    const session = sessionFor(pair);
    return {
      session,
      write: async (chunk) => {
        written.push(...chunk);
        await server.push('COMPLETE', { status: 0, chatLog: chatLog(2, 41) }, 999);
      },
      close: async () => await session.close(),
    };
  };

  try {
    const result = await sendMedia({
      controlSession,
      context,
      channelId: Long.fromNumber(100),
      type: 2,
      form: { data, name: 'photo.jpg', ext: 'jpg', width: 10, height: 20 },
      options: { connectionFactory, timeoutMs: 1_000 },
      messageId: 41,
    });
    assert.equal(result.msgId, 41);
    assert.deepEqual(written, [1, 2, 3, 4]);
  } finally {
    await controlSession.close();
    await controlServer.close();
    await Promise.all(mediaServers.map(async (server) => await server.close()));
  }
});

test('grouped media WRITE matches captured request attachment and localized message', async () => {
  const controlPair = createMemoryTransportPair();
  let finalWrite: unknown;
  const finalLog = chatLog(27, 42);
  const controlServer = new FakeLocoServer(controlPair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      MSHIP: () => ({
        data: {
          kl: ['k1', 'k2'], mtl: ['image/jpg', 'image/jpg'],
          vhl: ['one.test', 'two.test'], vh6l: ['::1', '::1'],
          pl: [1, 2], rd: false, status: 0,
        },
      }),
      WRITE: (request) => {
        finalWrite = request;
        return {
          data: {
            msgId: 42, chatId: Long.fromNumber(100), logId: finalLog.logId,
            prevId: finalLog.prevId, sendAt: finalLog.sendAt, chatLog: finalLog,
          },
        };
      },
    },
  });
  const controlSession = sessionFor(controlPair);
  const mediaServers: FakeLocoServer[] = [];
  const connectionFactory: AndroidMediaConnectionFactory = async (): Promise<AndroidMediaConnection> => {
    const pair = createMemoryTransportPair();
    let server!: FakeLocoServer;
    server = new FakeLocoServer(pair.server, {
      codec: new BsonPayloadCodec<object, unknown>(),
      handlers: { MPOST: () => ({ data: { status: 0, o: 0 } }) },
    });
    mediaServers.push(server);
    const session = sessionFor(pair);
    return {
      session,
      write: async () => await server.push('COMPLETE', { status: 0 }, 999),
      close: async () => await session.close(),
    };
  };

  try {
    const result = await sendMultiMedia({
      controlSession,
      context,
      channelId: Long.fromNumber(100),
      type: 27,
      forms: [
        { data: new Uint8Array([1]), name: 'one.jpg', ext: 'jpg', width: 10, height: 20, checksum: 'c1' },
        { data: new Uint8Array([2]), name: 'two.jpg', ext: 'jpg', width: 30, height: 40, checksum: 'c2' },
      ],
      options: { connectionFactory, groupedMessage: '사진 2장', timeoutMs: 1_000 },
      messageId: 42,
    });
    assert.equal(result.msgId, 42);
    assert.equal(field(finalWrite, 'msg'), '사진 2장');
    assert.equal(field(finalWrite, 'scope'), 1);
    assert.deepEqual(JSON.parse(field(finalWrite, 'extra') as string), {
      kl: ['k1', 'k2'], mtl: ['image/jpg', 'image/jpg'], csl: ['c1', 'c2'],
      wl: [10, 30], hl: [20, 40], cmtl: ['', ''], sl: [1, 1],
    });
  } finally {
    await controlSession.close();
    await controlServer.close();
    await Promise.all(mediaServers.map(async (server) => await server.close()));
  }
});

test('nonzero COMPLETE stops grouped media before WRITE', async () => {
  const controlPair = createMemoryTransportPair();
  let writeCount = 0;
  const controlServer = new FakeLocoServer(controlPair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      MSHIP: () => ({ data: { kl: ['k'], mtl: ['image/jpg'], vhl: ['one.test'], vh6l: ['::1'], pl: [1], rd: false, status: 0 } }),
      WRITE: () => { writeCount++; return { data: {} }; },
    },
  });
  const controlSession = sessionFor(controlPair);
  const pair = createMemoryTransportPair();
  let mediaServer!: FakeLocoServer;
  mediaServer = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: { MPOST: () => ({ data: { status: 0, o: 0 } }) },
  });
  const mediaSession = sessionFor(pair);
  const connectionFactory: AndroidMediaConnectionFactory = async () => ({
    session: mediaSession,
    write: async () => await mediaServer.push('COMPLETE', { status: -1 }, 999),
    close: async () => await mediaSession.close(),
  });

  try {
    await assert.rejects(sendMultiMedia({
      controlSession,
      context,
      channelId: Long.fromNumber(100),
      type: 27,
      forms: [{ data: new Uint8Array([1]), name: 'one.jpg', checksum: 'c' }],
      options: { connectionFactory, timeoutMs: 1_000 },
    }), AndroidMediaCompleteError);
    assert.equal(writeCount, 0);
  } finally {
    await controlSession.close();
    await controlServer.close();
    await mediaServer.close();
  }
});

test('media COMPLETE wait supports timeout and an already-aborted signal', async () => {
  const controlPair = createMemoryTransportPair();
  let shipCount = 0;
  const controlServer = new FakeLocoServer(controlPair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      SHIP: () => { shipCount++; return { data: { k: 'k', vh: 'media.test', vh6: '::1', p: 1, rd: false, status: 0 } }; },
    },
  });
  const controlSession = sessionFor(controlPair);
  const pair = createMemoryTransportPair();
  const mediaServer = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: { POST: () => ({ data: { status: 0, o: 0 } }) },
  });
  const mediaSession = sessionFor(pair);
  const connectionFactory: AndroidMediaConnectionFactory = async () => ({
    session: mediaSession,
    write: async () => undefined,
    close: async () => await mediaSession.close(),
  });

  try {
    await assert.rejects(sendMedia({
      controlSession,
      context,
      channelId: Long.fromNumber(100),
      type: 2,
      form: { data: new Uint8Array([1]), name: 'one.jpg' },
      options: { connectionFactory, timeoutMs: 25 },
    }), AndroidMediaTimeoutError);

    const controller = new AbortController();
    controller.abort(new Error('test abort'));
    await assert.rejects(sendMedia({
      controlSession,
      context,
      channelId: Long.fromNumber(100),
      type: 2,
      form: { data: new Uint8Array([1]), name: 'one.jpg' },
      options: { signal: controller.signal },
    }), AndroidMediaAbortedError);
    assert.equal(shipCount, 1);
  } finally {
    await controlSession.close();
    await controlServer.close();
    await mediaServer.close();
  }
});
