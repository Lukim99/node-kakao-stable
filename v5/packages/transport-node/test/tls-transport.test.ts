import assert from 'node:assert/strict';
import test from 'node:test';
import { LocoTlsConnectError, NodeTlsTransport } from '../src/index.js';

test('TLS transport rejects an already-aborted connection without opening a socket', async () => {
  const controller = new AbortController();
  controller.abort(new Error('fixture abort'));
  await assert.rejects(
    NodeTlsTransport.connect({ host: '127.0.0.1', port: 443, signal: controller.signal }),
    LocoTlsConnectError,
  );
});
