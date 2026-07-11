import assert from 'node:assert/strict';
import test from 'node:test';
import { Long } from 'bson';
import { BsonPayloadCodec } from '@lukim9-kakao/protocol-core';
import { FakeLocoServer, createMemoryTransportPair } from '@lukim9-kakao/testkit';
import {
  ExperimentalAndroidReactionSession,
  createAndroidCandidateSession,
} from '../src/index.js';

test('experimental ACTION request uses the observed shape in memory only', async () => {
  const pair = createMemoryTransportPair();
  const captured: unknown[] = [];
  const server = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers: {
      ACTION: (request) => {
        captured.push(request);
        return { data: {} };
      },
    },
  });
  const session = createAndroidCandidateSession(pair.client);
  const reactions = new ExperimentalAndroidReactionSession(session);
  await reactions.addReaction(Long.fromNumber(10), Long.fromNumber(20), 1);
  assert.equal(captured.length, 1);
  await assert.rejects(reactions.addReaction(Long.ONE, Long.ONE, 1.5), RangeError);
  await session.close();
  await server.close();
});
