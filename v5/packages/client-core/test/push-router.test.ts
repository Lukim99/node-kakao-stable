import assert from 'node:assert/strict';
import test from 'node:test';
import { BsonPayloadCodec, type LocoPacket } from '@lukim9-kakao/protocol-core';
import { LocoPushRouter, LocoPushValidationError } from '../src/index.js';

interface Pushes {
  EVENT: { readonly value: string };
}

function packet(value: object, method = 'EVENT'): LocoPacket {
  const encoded = new BsonPayloadCodec<object, unknown>().encode(value);
  return {
    header: { id: 0, status: 0, method },
    dataType: encoded.dataType,
    payload: encoded.payload,
  };
}

test('typed push router validates, decodes, and dispatches known pushes', async () => {
  const received: string[] = [];
  const router = new LocoPushRouter<Pushes>(new BsonPayloadCodec<object, unknown>(), {
    schemas: {
      EVENT: {
        validate: (value: unknown): value is Pushes['EVENT'] =>
          typeof value === 'object' && value !== null && 'value' in value &&
          typeof value.value === 'string',
      },
    },
  });
  router.on('EVENT', (push) => { received.push(push.value); });
  assert.equal(await router.route(packet({ value: 'ok' })), true);
  assert.deepEqual(received, ['ok']);
  await assert.rejects(router.route(packet({ value: 1 })), LocoPushValidationError);
});

test('unhandled pushes are preserved for forward-compatible inspection', async () => {
  const methods: string[] = [];
  const router = new LocoPushRouter<Pushes>(new BsonPayloadCodec<object, unknown>(), {
    onUnhandled: (unhandled) => { methods.push(unhandled.header.method); },
  });
  assert.equal(await router.route(packet({ future: true }, 'FUTURE')), false);
  assert.deepEqual(methods, ['FUTURE']);
});
