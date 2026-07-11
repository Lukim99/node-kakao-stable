import assert from 'node:assert/strict';
import test from 'node:test';
import { Long } from 'bson';
import { createHash } from 'node:crypto';
import {
  AndroidChannelSession,
  AndroidMessageIdSequence,
  buildMediaPostRequest,
  computeMediaChecksum,
  mediaChunks,
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

test('emoticon, mini-emoji, shout, and mention build their WRITE attachment shapes', async () => {
  const pair = createMemoryTransportPair();
  const id = Long.fromNumber(100);
  let lastWrite: unknown;
  const server = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      WRITE: (request) => {
        lastWrite = request;
        return { data: { msgId: field(request, 'msgId'), chatId: id, logId: Long.ONE, prevId: Long.ZERO, sendAt: 1 } };
      },
    },
  });
  const session = new LocoSession<AndroidReferenceCommands>(pair.client, new BsonPayloadCodec<Requests, unknown>());
  const channel = new AndroidChannelSession(session, id);

  await channel.sendEmoticon({ path: 'p.webp', name: '(emo)', type: 'xcon' });
  assert.equal(field(lastWrite, 'type'), 20);
  assert.deepEqual(JSON.parse(field(lastWrite, 'extra') as string), { path: 'p.webp', name: '(emo)', type: 'xcon' });

  await channel.sendTextWithEmojis('mini', {
    total_item: 1,
    total_len: 1,
    items: [{ id: 'mini-1', len: 1, at: [1] }],
  });
  assert.deepEqual(JSON.parse(field(lastWrite, 'extra') as string), {
    emojis: { total_item: 1, total_len: 1, items: [{ id: 'mini-1', len: 1, at: [1] }] },
  });

  await channel.sendShout('hello');
  assert.equal(field(lastWrite, 'type'), 1);
  assert.equal(field(lastWrite, 'msg'), 'hello');
  assert.deepEqual(JSON.parse(field(lastWrite, 'extra') as string), { shout: true });

  await channel.sendMention(['hi ', { userId: Long.fromString('9174400976476373063'), nickname: 'bob' }, '!']);
  assert.equal(field(lastWrite, 'msg'), 'hi @bob!');
  // user_id preserved as an exact integer literal, len = nickname length, at = [1].
  assert.equal(field(lastWrite, 'extra'), '{"mentions":[{"user_id":9174400976476373063,"len":3,"at":[1]}]}');

  await session.close();
  await server.close();
});

test('media upload helpers build the checksum, POST body, and offset chunks', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
  assert.equal(computeMediaChecksum(data), createHash('sha1').update(data).digest('hex'));

  const post = buildMediaPostRequest({
    key: 'mkey',
    channelId: Long.fromNumber(2001),
    type: 2,
    form: { data, name: 'pic.jpg', width: 640, height: 480 },
    context: { publicKey: 'x', userId: Long.fromString('9174400976476373063'), appVersion: '11.0.0', networkType: 0, mccmnc: '45005' },
  });
  assert.equal(post.k, 'mkey');
  assert.equal(post.f, null);
  assert.equal(post.s, 7);
  assert.equal(post.t, 2);
  assert.equal(post.os, 'android');
  assert.equal(post.w, 640);
  assert.equal(post.h, 480);
  assert.equal((post.u as Long).toString(), '9174400976476373063'); // exact, not rounded
  assert.equal(post.mid, 1);
  assert.equal(post.ex, '{"cmt":""}');
  assert.equal(post.sp, null);
  assert.equal(post.ns, false);
  assert.equal(post.dt, 1);
  assert.equal(post.scp, 1);

  // Chunks resume from the server-reported offset and cover the rest exactly.
  const chunks = [...mediaChunks(data, 3, 2)].map((c) => [...c]);
  assert.deepEqual(chunks, [[4, 5], [6, 7]]);
  assert.deepEqual([...mediaChunks(data, data.byteLength, 2)], []); // fully-uploaded → nothing
  assert.throws(() => [...mediaChunks(data, 0, 0)], RangeError);
  assert.throws(() => [...mediaChunks(data, data.byteLength + 1, 2)], RangeError);
});
