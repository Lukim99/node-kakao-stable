import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RequestIdAllocator,
  RequestIdExhaustedError,
  type LocoRequestOf,
  type LocoResponseOf,
} from '../src/index.js';

interface TestCommands {
  PING: { request: Record<string, never>; response: Record<string, never> };
  ECHO: { request: { value: string }; response: { echoed: string } };
}

const validRequest: LocoRequestOf<TestCommands, 'ECHO'> = { value: 'typed' };
const validResponse: LocoResponseOf<TestCommands, 'ECHO'> = { echoed: 'typed' };
void validRequest;
void validResponse;

// @ts-expect-error Unknown methods are rejected by the command map.
type UnknownRequest = LocoRequestOf<TestCommands, 'MISSING'>;

test('allocates sequential request IDs, wraps, skips acquired IDs, and reuses releases', () => {
  const allocator = new RequestIdAllocator({ minimum: 1, maximum: 3 });
  assert.equal(allocator.acquire(), 1);
  assert.equal(allocator.acquire(), 2);
  assert.equal(allocator.release(1), true);
  assert.equal(allocator.acquire(), 3);
  assert.equal(allocator.acquire(), 1);
  assert.equal(allocator.size, 3);
});

test('throws a dedicated error when every request ID is acquired', () => {
  const allocator = new RequestIdAllocator({ minimum: 7, maximum: 8 });
  assert.equal(allocator.acquire(), 7);
  assert.equal(allocator.acquire(), 8);
  assert.throws(() => allocator.acquire(), RequestIdExhaustedError);
});

test('release safely rejects duplicates and out-of-range IDs', () => {
  const allocator = new RequestIdAllocator({ minimum: 2, maximum: 4 });
  const id = allocator.acquire();
  assert.equal(allocator.release(id), true);
  assert.equal(allocator.release(id), false);
  assert.equal(allocator.release(1), false);
  assert.equal(allocator.release(5), false);
});

test('rejects invalid request ID ranges and initial values', () => {
  assert.throws(() => new RequestIdAllocator({ minimum: -1 }), RangeError);
  assert.throws(() => new RequestIdAllocator({ minimum: 5, maximum: 4 }), RangeError);
  assert.throws(() => new RequestIdAllocator({ maximum: 0x1_0000_0000 }), RangeError);
  assert.throws(() => new RequestIdAllocator({ minimum: 2, maximum: 3, initial: 1 }), RangeError);
});
