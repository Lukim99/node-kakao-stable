import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BsonPayloadCodec,
  RequestIdAllocator,
  type LocoRequestUnion,
} from '@lukim9-kakao/protocol-core';
import {
  LocoIncompleteFrameError,
  LocoPushQueueOverflowError,
  LocoRemoteStatusError,
  LocoRequestAbortedError,
  LocoRequestTimeoutError,
  LocoResponseMethodMismatchError,
  LocoSession,
  LocoSessionClosedError,
  LocoTransportReadError,
  LocoTransportWriteError,
} from '@lukim9-kakao/transport-node';
import {
  FakeLocoServer,
  createMemoryTransportPair,
  type FakeLocoHandler,
  type MemoryTransportPairOptions,
} from '../src/index.js';

interface TestCommands {
  PING: { request: Record<string, never>; response: Record<string, never> };
  ECHO: { request: { value: string }; response: { value: string } };
  FAIL: { request: { code: number }; response: Record<string, never> };
  WAIT: { request: { key: string }; response: { done: boolean } };
}

type TestRequests = LocoRequestUnion<TestCommands>;

function valueOf(input: unknown): string {
  if (typeof input !== 'object' || input === null || !('value' in input) ||
    typeof input.value !== 'string') throw new Error('Invalid test ECHO request');
  return input.value;
}

function setup(
  handlers: Readonly<Record<string, FakeLocoHandler>>,
  pairOptions: MemoryTransportPairOptions = {},
  sessionOptions: ConstructorParameters<typeof LocoSession<TestCommands>>[2] = {},
): {
  readonly session: LocoSession<TestCommands>;
  readonly server: FakeLocoServer;
  readonly pair: ReturnType<typeof createMemoryTransportPair>;
} {
  const pair = createMemoryTransportPair(pairOptions);
  const server = new FakeLocoServer(pair.server, {
    codec: new BsonPayloadCodec<object, unknown>(),
    handlers,
  });
  const session = new LocoSession<TestCommands>(
    pair.client,
    new BsonPayloadCodec<TestRequests, unknown>(),
    sessionOptions,
  );
  return { session, server, pair };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function turn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('single request succeeds with command-linked request and response types', async () => {
  const { session } = setup({
    ECHO: (request) => ({ data: { value: valueOf(request) } }),
  });
  assert.deepEqual(await session.request('ECHO', { value: 'hello' }), { value: 'hello' });
  await session.close();
});

test('concurrent responses may arrive out of request order', async () => {
  const firstGate = deferred<void>();
  const { session } = setup({
    ECHO: async (request) => {
      const value = valueOf(request);
      if (value === 'first') await firstGate.promise;
      return { data: { value } };
    },
  });
  const first = session.request('ECHO', { value: 'first' });
  const second = session.request('ECHO', { value: 'second' });
  assert.deepEqual(await second, { value: 'second' });
  firstGate.resolve();
  assert.deepEqual(await first, { value: 'first' });
  await session.close();
});

test('coalesced push and response frames are split by the single reader', async () => {
  let fake!: FakeLocoServer;
  const environment = setup({
    ECHO: async (request, packet) => {
      const value = valueOf(request);
      await fake.sendPacketsCoalesced([
        fake.makePacket(0, 'PUSH', { sequence: 1 }),
        fake.makePacket(packet.header.id, 'ECHO', { value }),
      ]);
      return { send: false, data: {} };
    },
  });
  fake = environment.server;
  const iterator = environment.session.pushes()[Symbol.asyncIterator]();
  const response = await environment.session.request('ECHO', { value: 'mixed' });
  assert.deepEqual(response, { value: 'mixed' });
  assert.equal((await iterator.next()).value?.header.method, 'PUSH');
  await environment.session.close();
});

test('remote status failures use a dedicated error without decoding payload details', async () => {
  const { session } = setup({ FAIL: () => ({ status: 401, data: {} }) });
  await assert.rejects(session.request('FAIL', { code: 401 }), (error: unknown) => {
    assert.ok(error instanceof LocoRemoteStatusError);
    assert.equal(error.status, 401);
    assert.equal(error.method, 'FAIL');
    return true;
  });
  await session.close();
});

test('response method mismatch rejects only the matching request with a protocol error', async () => {
  const { session } = setup({
    ECHO: (request) => ({ method: 'WRONG', data: { value: valueOf(request) } }),
  });
  await assert.rejects(
    session.request('ECHO', { value: 'method-check' }),
    LocoResponseMethodMismatchError,
  );
  await session.close();
});

test('write failure rejects the request, clears pending state, and closes once', async () => {
  const { session, pair } = setup({});
  pair.client.failNextWrite(new Error('injected secret write details'));
  await assert.rejects(session.request('PING', {}), LocoTransportWriteError);
  assert.equal(session.pendingRequestCount, 0);
  assert.equal(pair.client.closeCallCount, 1);
  await session.close();
  assert.equal(pair.client.closeCallCount, 1);
});

test('read failure rejects every pending request with the same typed failure', async () => {
  const never = deferred<{ data: object }>();
  const { session, pair } = setup({ WAIT: () => never.promise });
  const first = session.request('WAIT', { key: 'read-failure-1' });
  const second = session.request('WAIT', { key: 'read-failure-2' });
  await turn();
  pair.client.injectReadError(new Error('injected read failure'));
  const results = await Promise.allSettled([first, second]);
  const firstError = results[0]?.status === 'rejected' ? results[0].reason as unknown : undefined;
  const secondError = results[1]?.status === 'rejected' ? results[1].reason as unknown : undefined;
  assert.ok(firstError instanceof LocoTransportReadError);
  assert.equal(secondError, firstError);
  assert.equal(session.pendingRequestCount, 0);
});

test('early transport end rejects pending work and later requests immediately', async () => {
  const { session, pair } = setup({});
  const request = session.request('WAIT', { key: 'end' });
  await turn();
  await pair.server.close();
  await assert.rejects(request, LocoSessionClosedError);
  await assert.rejects(session.request('PING', {}), LocoSessionClosedError);
});

test('timeout cleans pending state and returns the request ID', async () => {
  const never = deferred<{ data: object }>();
  const requestIds = new RequestIdAllocator({ minimum: 1, maximum: 1 });
  const { session } = setup(
    { WAIT: () => never.promise },
    {},
    { requestIds },
  );
  await assert.rejects(
    session.request('WAIT', { key: 'timeout' }, { timeoutMs: 30 }),
    LocoRequestTimeoutError,
  );
  assert.equal(session.pendingRequestCount, 0);
  assert.equal(requestIds.size, 0);
  await assert.rejects(
    session.request('WAIT', { key: 'reused' }, { timeoutMs: 30 }),
    LocoRequestTimeoutError,
  );
  await session.close();
});

test('an already-aborted signal rejects before allocating an ID', async () => {
  const requestIds = new RequestIdAllocator({ minimum: 1, maximum: 1 });
  const { session } = setup({}, {}, { requestIds });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    session.request('WAIT', { key: 'pre-abort' }, { signal: controller.signal }),
    LocoRequestAbortedError,
  );
  assert.equal(requestIds.size, 0);
  await session.close();
});

test('abort while waiting settles and cleans a pending request exactly once', async () => {
  const never = deferred<{ data: object }>();
  const requestIds = new RequestIdAllocator({ minimum: 1, maximum: 1 });
  const { session } = setup({ WAIT: () => never.promise }, {}, { requestIds });
  const controller = new AbortController();
  const request = session.request('WAIT', { key: 'abort' }, { signal: controller.signal });
  await turn();
  controller.abort();
  await assert.rejects(request, LocoRequestAbortedError);
  controller.abort();
  assert.equal(session.pendingRequestCount, 0);
  assert.equal(requestIds.size, 0);
  await session.close();
});

test('response and abort race cannot double-release the request ID', async () => {
  const requestIds = new RequestIdAllocator({ minimum: 1, maximum: 1 });
  const controller = new AbortController();
  const { session } = setup({
    ECHO: (request) => {
      queueMicrotask(() => controller.abort());
      return { data: { value: valueOf(request) } };
    },
  }, {}, { requestIds });
  try {
    await session.request('ECHO', { value: 'race' }, { signal: controller.signal });
  } catch (error) {
    assert.ok(error instanceof LocoRequestAbortedError);
  }
  await turn();
  assert.equal(requestIds.size, 0);
  assert.equal(session.pendingRequestCount, 0);
  await session.close();
});

test('memory transport fragmentation covers header and payload boundaries', async () => {
  const { session } = setup(
    { ECHO: (request) => ({ data: { value: valueOf(request) } }) },
    { client: { fragmentSizes: [1, 2, 3, 5, 8] }, server: { fragmentSizes: [2, 1, 4, 7] } },
  );
  assert.deepEqual(await session.request('ECHO', { value: 'fragmented payload' }), {
    value: 'fragmented payload',
  });
  await session.close();
});

test('push iterator preserves order and ends on explicit session close', async () => {
  const { session, server } = setup({});
  const iterator = session.pushes()[Symbol.asyncIterator]();
  await server.push('PUSH', { order: 1 });
  await server.push('PUSH', { order: 2 });
  assert.equal((await iterator.next()).value?.header.method, 'PUSH');
  assert.equal((await iterator.next()).value?.header.method, 'PUSH');
  await session.close();
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
});

test('a slow push consumer causes bounded queue overflow and session termination', async () => {
  const { session, server } = setup({}, {}, { pushQueueSize: 1 });
  await server.push('PUSH', { order: 1 });
  await server.push('PUSH', { order: 2 });
  await turn();
  const iterator = session.pushes()[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), LocoPushQueueOverflowError);
  await assert.rejects(session.request('PING', {}), LocoSessionClosedError);
});

test('incomplete frame at transport end is exposed through the push iterator', async () => {
  const { session, pair } = setup({});
  await pair.server.write(Uint8Array.of(1, 2, 3, 4));
  await pair.server.close();
  const iterator = session.pushes()[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), LocoIncompleteFrameError);
});

test('close is idempotent and closes the transport only once', async () => {
  const { session, pair } = setup({});
  await session.close();
  await session.close();
  assert.equal(pair.client.closeCallCount, 1);
});
