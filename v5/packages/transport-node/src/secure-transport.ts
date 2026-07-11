import {
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  randomBytes,
  type KeyLike,
} from 'node:crypto';
import type { ByteTransport } from './transport.js';

const SECURE_HEADER_SIZE = 20;
const AES_KEY_SIZE = 16;
const AES_IV_SIZE = 16;

export class LocoSecureTransportError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class LocoSecureRecordTooLargeError extends LocoSecureTransportError {
  public constructor(public readonly size: number, public readonly maximumSize: number) {
    super(`Encrypted LOCO record size ${size} exceeds limit ${maximumSize}`);
  }
}

export class LocoSecureIncompleteRecordError extends LocoSecureTransportError {
  public constructor(public readonly bufferedBytes: number) {
    super(`Secure transport ended with ${bufferedBytes} incomplete bytes`);
  }
}

export class LocoSecureBufferOverflowError extends LocoSecureTransportError {
  public constructor(public readonly size: number, public readonly maximumSize: number) {
    super(`Buffered secure transport bytes ${size} exceed limit ${maximumSize}`);
  }
}

export interface LocoSecureTransportOptions {
  readonly publicKey: KeyLike;
  readonly maximumRecordSize?: number;
  readonly keyVersion?: number;
  readonly encryptionType?: number;
}

class SecureRecordDecoder {
  private buffer = new Uint8Array(0);
  private start = 0;
  private end = 0;
  private readonly maximumBufferedSize: number;

  public constructor(
    private readonly key: Uint8Array,
    private readonly maximumRecordSize: number,
  ) {
    this.maximumBufferedSize = (maximumRecordSize + SECURE_HEADER_SIZE) * 2;
  }

  public get bufferedBytes(): number {
    return this.end - this.start;
  }

  public push(chunk: Uint8Array): Uint8Array[] {
    const required = this.bufferedBytes + chunk.byteLength;
    if (required > this.maximumBufferedSize) {
      throw new LocoSecureBufferOverflowError(required, this.maximumBufferedSize);
    }
    this.ensureCapacity(required);
    this.buffer.set(chunk, this.end);
    this.end += chunk.byteLength;
    const records: Uint8Array[] = [];
    let offset = this.start;
    while (this.end - offset >= SECURE_HEADER_SIZE) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, SECURE_HEADER_SIZE);
      const encodedSize = view.getUint32(0, true);
      if (encodedSize < AES_IV_SIZE) {
        throw new LocoSecureTransportError('Encrypted LOCO record length is smaller than its IV');
      }
      const encryptedSize = encodedSize - AES_IV_SIZE;
      if (encryptedSize > this.maximumRecordSize) {
        throw new LocoSecureRecordTooLargeError(encryptedSize, this.maximumRecordSize);
      }
      const recordSize = SECURE_HEADER_SIZE + encryptedSize;
      if (this.end - offset < recordSize) break;
      const iv = this.buffer.subarray(offset + 4, offset + SECURE_HEADER_SIZE);
      const encrypted = this.buffer.subarray(offset + SECURE_HEADER_SIZE, offset + recordSize);
      const decipher = createDecipheriv('aes-128-cfb', this.key, iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      records.push(new Uint8Array(decrypted).slice());
      offset += recordSize;
    }
    this.start = offset;
    if (this.start === this.end) {
      this.start = 0;
      this.end = 0;
    }
    return records;
  }

  private ensureCapacity(required: number): void {
    const retained = this.bufferedBytes;
    if (this.buffer.byteLength - this.end >= required - retained) return;
    if (this.start > 0 && this.buffer.byteLength >= required) {
      this.buffer.copyWithin(0, this.start, this.end);
      this.start = 0;
      this.end = retained;
      return;
    }
    let capacity = Math.max(SECURE_HEADER_SIZE, this.buffer.byteLength);
    const maximum = this.maximumBufferedSize;
    while (capacity < required) capacity = Math.min(maximum, capacity * 2);
    const grown = new Uint8Array(capacity);
    grown.set(this.buffer.subarray(this.start, this.end));
    this.buffer = grown;
    this.start = 0;
    this.end = retained;
  }
}

export class LocoSecureTransport implements ByteTransport {
  public readonly readable: AsyncIterable<Uint8Array>;
  private readonly key = randomBytes(AES_KEY_SIZE);
  private readonly encryptedKey: Uint8Array;
  private readonly maximumRecordSize: number;
  private readonly keyVersion: number;
  private readonly encryptionType: number;
  private handshaked = false;
  private writeTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly transport: ByteTransport,
    options: LocoSecureTransportOptions,
  ) {
    this.maximumRecordSize = options.maximumRecordSize ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maximumRecordSize) || this.maximumRecordSize < 0 ||
      this.maximumRecordSize > (Number.MAX_SAFE_INTEGER - SECURE_HEADER_SIZE * 2) / 2) {
      throw new RangeError('maximumRecordSize must be a non-negative safe integer');
    }
    this.keyVersion = options.keyVersion ?? 15;
    this.encryptionType = options.encryptionType ?? 2;
    this.encryptedKey = new Uint8Array(publicEncrypt(options.publicKey, this.key)).slice();
    this.readable = this.readSecureRecords();
  }

  public async write(data: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void> {
    if (data.byteLength > this.maximumRecordSize) {
      throw new LocoSecureRecordTooLargeError(data.byteLength, this.maximumRecordSize);
    }
    const copy = data.slice();
    const operation = this.writeTail.then(async () => {
      if (options?.signal?.aborted === true) throw options.signal.reason;
      if (!this.handshaked) {
        await this.transport.write(this.createHandshake(), options);
        this.handshaked = true;
      }
      const iv = randomBytes(AES_IV_SIZE);
      const cipher = createCipheriv('aes-128-cfb', this.key, iv);
      const encrypted = Buffer.concat([cipher.update(copy), cipher.final()]);
      const record = new Uint8Array(SECURE_HEADER_SIZE + encrypted.byteLength);
      const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
      view.setUint32(0, encrypted.byteLength + AES_IV_SIZE, true);
      record.set(iv, 4);
      record.set(encrypted, SECURE_HEADER_SIZE);
      await this.transport.write(record, options);
    });
    this.writeTail = operation.catch(() => undefined);
    await operation;
  }

  public async close(reason?: Error): Promise<void> {
    await this.transport.close(reason);
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private createHandshake(): Uint8Array {
    const handshake = new Uint8Array(12 + this.encryptedKey.byteLength);
    const view = new DataView(handshake.buffer, handshake.byteOffset, handshake.byteLength);
    view.setUint32(0, this.encryptedKey.byteLength, true);
    view.setUint32(4, this.keyVersion, true);
    view.setUint32(8, this.encryptionType, true);
    handshake.set(this.encryptedKey, 12);
    return handshake;
  }

  private async *readSecureRecords(): AsyncGenerator<Uint8Array> {
    const decoder = new SecureRecordDecoder(this.key, this.maximumRecordSize);
    for await (const chunk of this.transport.readable) {
      for (const record of decoder.push(chunk)) yield record;
    }
    if (decoder.bufferedBytes !== 0) {
      throw new LocoSecureIncompleteRecordError(decoder.bufferedBytes);
    }
  }
}
