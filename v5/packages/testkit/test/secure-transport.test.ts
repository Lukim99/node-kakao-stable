import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
} from 'node:crypto';
import {
  LocoSecureIncompleteRecordError,
  LocoSecureTransport,
} from '@lukim9-kakao/transport-node';
import type { MemoryTransport } from '../src/index.js';
import { createMemoryTransportPair } from '../src/index.js';

class ExactReader {
  private buffered = new Uint8Array(0);
  private readonly iterator: AsyncIterator<Uint8Array>;

  public constructor(source: AsyncIterable<Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  public async read(size: number): Promise<Uint8Array> {
    while (this.buffered.byteLength < size) {
      const next = await this.iterator.next();
      if (next.done) throw new Error('Fixture transport ended early');
      const combined = new Uint8Array(this.buffered.byteLength + next.value.byteLength);
      combined.set(this.buffered);
      combined.set(next.value, this.buffered.byteLength);
      this.buffered = combined;
    }
    const result = this.buffered.slice(0, size);
    this.buffered = this.buffered.slice(size);
    return result;
  }
}

async function runFixtureServer(server: MemoryTransport, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']): Promise<void> {
  const reader = new ExactReader(server.readable);
  const handshakeHeader = await reader.read(12);
  const handshakeView = new DataView(
    handshakeHeader.buffer,
    handshakeHeader.byteOffset,
    handshakeHeader.byteLength,
  );
  const encryptedKeySize = handshakeView.getUint32(0, true);
  assert.equal(handshakeView.getUint32(4, true), 15);
  assert.equal(handshakeView.getUint32(8, true), 2);
  const encryptedKey = await reader.read(encryptedKeySize);
  const key = privateDecrypt(privateKey, encryptedKey);

  const recordHeader = await reader.read(20);
  const recordView = new DataView(recordHeader.buffer, recordHeader.byteOffset, recordHeader.byteLength);
  const encryptedSize = recordView.getUint32(0, true) - 16;
  const encrypted = await reader.read(encryptedSize);
  const decipher = createDecipheriv('aes-128-cfb', key, recordHeader.subarray(4));
  const request = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  assert.equal(request.toString('utf8'), 'secure fixture');

  const response = Buffer.from('secure response');
  const iv = Buffer.alloc(16, 7);
  const cipher = createCipheriv('aes-128-cfb', key, iv);
  const responseEncrypted = Buffer.concat([cipher.update(response), cipher.final()]);
  const record = new Uint8Array(20 + responseEncrypted.byteLength);
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  view.setUint32(0, responseEncrypted.byteLength + 16, true);
  record.set(iv, 4);
  record.set(responseEncrypted, 20);
  await server.write(record);
}

test('secure transport performs one handshake and decrypts fragmented records', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pair = createMemoryTransportPair({ server: { fragmentSizes: [1, 2, 3, 5, 8] } });
  const serverTask = runFixtureServer(pair.server, keys.privateKey);
  const secure = new LocoSecureTransport(pair.client, { publicKey: keys.publicKey });
  const iterator = secure.readable[Symbol.asyncIterator]();
  await secure.write(new TextEncoder().encode('secure fixture'));
  const response = await iterator.next();
  assert.equal(new TextDecoder().decode(response.value), 'secure response');
  await serverTask;
  await secure.close();
});

test('secure transport reports incomplete encrypted records', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pair = createMemoryTransportPair();
  const secure = new LocoSecureTransport(pair.client, { publicKey: keys.publicKey });
  await pair.server.write(Uint8Array.of(1, 2, 3));
  await pair.server.close();
  const iterator = secure.readable[Symbol.asyncIterator]();
  await assert.rejects(iterator.next(), LocoSecureIncompleteRecordError);
});
