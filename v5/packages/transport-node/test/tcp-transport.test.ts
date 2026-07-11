import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type AddressInfo } from 'node:net';
import { BsonPayloadCodec } from '@lukim9-kakao/protocol-core';
import { LocoSession, NodeTcpTransport } from '../src/index.js';

interface EchoCommands {
  ECHO: { request: { readonly value: string }; response: { readonly value: string } };
}

test('Node TCP transport runs a LOCO session against localhost only', async () => {
  const server = createServer((socket) => { socket.pipe(socket); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const transport = await NodeTcpTransport.connect({ host: '127.0.0.1', port: address.port });
  const session = new LocoSession<EchoCommands>(
    transport,
    new BsonPayloadCodec<{ value: string }, unknown>(),
  );
  assert.deepEqual(await session.request('ECHO', { value: 'localhost' }), { value: 'localhost' });
  await session.close();
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve();
    else reject(error);
  }));
});
