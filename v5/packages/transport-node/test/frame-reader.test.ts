import assert from 'node:assert/strict';
import test from 'node:test';
import { LocoFrameCodec, type LocoPacket } from '@lukim9-kakao/protocol-core';
import { LocoFrameReader, LocoIncompleteFrameError } from '../src/index.js';

async function* chunks(values: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield value;
}

const packet: LocoPacket = {
  header: { id: 1, status: 0, method: 'ECHO' },
  dataType: 0,
  payload: Uint8Array.of(1, 2, 3, 4),
};

test('frame reader handles split headers, split payloads, and coalesced frames', async () => {
  const codec = new LocoFrameCodec();
  const first = codec.encode(packet);
  const second = codec.encode({ ...packet, header: { ...packet.header, id: 2 } });
  const wire = new Uint8Array(first.length + second.length);
  wire.set(first);
  wire.set(second, first.length);
  const input = [wire.slice(0, 2), wire.slice(2, 20), wire.slice(20, 24), wire.slice(24)];
  const output: LocoPacket[] = [];
  for await (const decoded of new LocoFrameReader().read(chunks(input))) output.push(decoded);
  assert.deepEqual(output.map(({ header }) => header.id), [1, 2]);
});

test('frame reader reports incomplete bytes with a dedicated error', async () => {
  const iterator = new LocoFrameReader().read(chunks([Uint8Array.of(1, 2, 3)]));
  await assert.rejects(async () => {
    for await (const _packet of iterator) { /* no complete packet */ }
  }, LocoIncompleteFrameError);
});
