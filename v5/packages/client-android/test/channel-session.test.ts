import assert from 'node:assert/strict';
import test from 'node:test';
import { Long } from 'bson';
import {
  AndroidChannelSession,
  AndroidMessageIdSequence,
} from '../src/index.js';
import {
  BsonPayloadCodec,
  type LocoRequestUnion,
} from '@lukim9-kakao/protocol-core';
import type { AndroidReferenceCommands } from '@lukim9-kakao/protocol-android';
import { LocoSession } from '@lukim9-kakao/transport-node';
import { FakeLocoServer, createMemoryTransportPair } from '@lukim9-kakao/testkit';

type Requests = LocoRequestUnion<AndroidReferenceCommands>;

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    throw new Error(`Missing fixture field ${key}`);
  }
  return (value as Record<string, unknown>)[key];
}

test('message ID sequence wraps without emitting zero', () => {
  const sequence = new AndroidMessageIdSequence(1, 2);
  assert.equal(sequence.next(), 2);
  assert.equal(sequence.next(), 1);
});

test('Android channel commands execute through the typed memory session', async () => {
  const pair = createMemoryTransportPair();
  const id = Long.fromNumber(100);
  const seenMethods: string[] = [];
  const server = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      WRITE: (request) => {
        seenMethods.push('WRITE');
        assert.equal(field(request, 'msg'), 'hello');
        return {
          data: {
            msgId: field(request, 'msgId'),
            chatId: id,
            logId: Long.fromNumber(200),
            prevId: Long.fromNumber(199),
            sendAt: 123,
          },
        };
      },
      DELETEMSG: () => { seenMethods.push('DELETEMSG'); return { data: {} }; },
      NOTIREAD: () => { seenMethods.push('NOTIREAD'); return { data: {} }; },
      SYNCMSG: () => ({ data: { isOK: true, lastTokenId: Long.ONE, chatLogs: [] } }),
      MCHATLOGS: () => ({ data: { chatLogs: [] } }),
    },
  });
  const session = new LocoSession<AndroidReferenceCommands>(
    pair.client,
    new BsonPayloadCodec<Requests, unknown>(),
  );
  const channel = new AndroidChannelSession(session, id);
  assert.equal((await channel.sendText('hello')).sendAt, 123);
  await channel.deleteMessage(Long.fromNumber(200));
  await channel.markRead(Long.fromNumber(200));
  assert.equal((await channel.sync({ maximumLogId: Long.fromNumber(200) })).isOK, true);
  assert.deepEqual(await channel.getMessagesSince(), []);
  assert.deepEqual(seenMethods, ['WRITE', 'DELETEMSG', 'NOTIREAD']);
  await session.close();
  await server.close();
});
