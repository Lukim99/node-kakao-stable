import assert from 'node:assert/strict';
import test from 'node:test';
import { BsonPayloadCodec, PacketAssembler } from '../src/index.js';

interface EchoDocument {
  value: string;
}

test('packet assembler allocates ids and round-trips BSON payloads', () => {
  const assembler = new PacketAssembler(
    new BsonPayloadCodec<EchoDocument, EchoDocument>(),
    { firstRequestId: 2, maximumRequestId: 3 },
  );

  const first = assembler.construct('ECHO', { value: 'first' });
  const second = assembler.construct('ECHO', { value: 'second' });
  const wrapped = assembler.construct('ECHO', { value: 'wrapped' });

  assert.equal(first.header.id, 2);
  assert.equal(second.header.id, 3);
  assert.equal(wrapped.header.id, 1);
  assert.equal(assembler.deconstruct(first).value, 'first');
  assert.equal(assembler.releaseRequestId(first.header.id), true);
  assert.equal(assembler.construct('ECHO', { value: 'reused' }).header.id, 2);
});
