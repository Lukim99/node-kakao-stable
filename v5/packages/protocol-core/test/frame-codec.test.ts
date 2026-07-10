import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InvalidLocoPacketError,
  LocoFrameCodec,
  LocoFrameDecoder,
  LocoPacketTooLargeError,
  LOCO_HEADER_SIZE,
  type LocoPacket,
} from '../src/index.js';

const packet: LocoPacket = {
  header: { id: 0x7856_3412, status: 7, method: 'PING' },
  dataType: 0,
  payload: Uint8Array.of(1, 2, 3, 4),
};

test('encodes and decodes the legacy 22-byte LOCO frame header', () => {
  const codec = new LocoFrameCodec();
  const encoded = codec.encode(packet);

  assert.equal(encoded.byteLength, LOCO_HEADER_SIZE + 4);
  assert.deepEqual([...encoded.subarray(0, 4)], [0x12, 0x34, 0x56, 0x78]);
  assert.equal(new TextDecoder().decode(encoded.subarray(6, 10)), 'PING');
  assert.deepEqual(codec.decode(encoded), packet);
});

test('incremental decoder handles fragmented and coalesced TCP chunks', () => {
  const codec = new LocoFrameCodec();
  const decoder = new LocoFrameDecoder();
  const first = codec.encode(packet);
  const second = codec.encode({
    ...packet,
    header: { ...packet.header, id: 2, method: 'WRITE' },
    payload: Uint8Array.of(9, 8),
  });
  const wire = new Uint8Array(first.byteLength + second.byteLength);
  wire.set(first);
  wire.set(second, first.byteLength);

  assert.deepEqual(decoder.push(wire.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(wire.subarray(3, 17)), []);
  const decoded = decoder.push(wire.subarray(17));

  assert.equal(decoded.length, 2);
  assert.equal(decoded[0]?.header.method, 'PING');
  assert.equal(decoded[1]?.header.method, 'WRITE');
  assert.equal(decoder.bufferedBytes, 0);
});

test('rejects invalid method names and oversized payloads', () => {
  const codec = new LocoFrameCodec({ maxPayloadSize: 3 });
  assert.throws(() => codec.encode(packet), LocoPacketTooLargeError);

  const invalid = { ...packet, payload: new Uint8Array(), header: { ...packet.header, method: '한글' } };
  assert.throws(() => new LocoFrameCodec().encode(invalid), InvalidLocoPacketError);
});

test('rejects a malformed frame length', () => {
  const codec = new LocoFrameCodec();
  const encoded = codec.encode(packet);
  assert.throws(() => codec.decode(encoded.subarray(0, encoded.length - 1)), InvalidLocoPacketError);
});
