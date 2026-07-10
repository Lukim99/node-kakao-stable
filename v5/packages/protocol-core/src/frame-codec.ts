import {
  LOCO_DEFAULT_MAX_BUFFERED_BYTES,
  LOCO_DEFAULT_MAX_PAYLOAD_SIZE,
  LOCO_HEADER_SIZE,
  LOCO_METHOD_SIZE,
} from './constants.js';
import {
  InvalidLocoPacketError,
  LocoPacketTooLargeError,
} from './errors.js';
import type { DecodedLocoHeader, LocoPacket } from './types.js';

export interface LocoFrameCodecOptions {
  readonly maxPayloadSize?: number;
}

export interface LocoFrameDecoderOptions extends LocoFrameCodecOptions {
  readonly maxBufferedBytes?: number;
}

function assertUnsignedInteger(value: number, maximum: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new InvalidLocoPacketError(`${field} must be an unsigned integer <= ${maximum}`);
  }
}

function encodeMethod(method: string): Uint8Array {
  if (method.length === 0 || method.length > LOCO_METHOD_SIZE) {
    throw new InvalidLocoPacketError(`method length must be between 1 and ${LOCO_METHOD_SIZE}`);
  }

  const encoded = new Uint8Array(LOCO_METHOD_SIZE);
  for (let index = 0; index < method.length; index += 1) {
    const code = method.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) {
      throw new InvalidLocoPacketError('method must contain printable ASCII characters only');
    }
    encoded[index] = code;
  }
  return encoded;
}

function decodeMethod(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end === -1) end = bytes.length;

  for (let index = 0; index < end; index += 1) {
    const code = bytes[index];
    if (code === undefined || code < 0x21 || code > 0x7e) {
      throw new InvalidLocoPacketError('method contains a non-printable ASCII byte');
    }
  }

  for (let index = end; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) {
      throw new InvalidLocoPacketError('method contains non-zero bytes after null terminator');
    }
  }

  if (end === 0) throw new InvalidLocoPacketError('method must not be empty');
  return String.fromCharCode(...bytes.subarray(0, end));
}

export class LocoFrameCodec {
  public readonly maxPayloadSize: number;

  public constructor(options: LocoFrameCodecOptions = {}) {
    this.maxPayloadSize = options.maxPayloadSize ?? LOCO_DEFAULT_MAX_PAYLOAD_SIZE;
    if (!Number.isSafeInteger(this.maxPayloadSize) || this.maxPayloadSize < 0) {
      throw new RangeError('maxPayloadSize must be a non-negative safe integer');
    }
  }

  public encode(packet: LocoPacket): Uint8Array {
    assertUnsignedInteger(packet.header.id, 0xffff_ffff, 'header.id');
    assertUnsignedInteger(packet.header.status, 0xffff, 'header.status');
    assertUnsignedInteger(packet.dataType, 0xff, 'dataType');

    if (packet.payload.byteLength > this.maxPayloadSize) {
      throw new LocoPacketTooLargeError(packet.payload.byteLength, this.maxPayloadSize);
    }

    const output = new Uint8Array(LOCO_HEADER_SIZE + packet.payload.byteLength);
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
    view.setUint32(0, packet.header.id, true);
    view.setUint16(4, packet.header.status, true);
    output.set(encodeMethod(packet.header.method), 6);
    view.setUint8(17, packet.dataType);
    view.setUint32(18, packet.payload.byteLength, true);
    output.set(packet.payload, LOCO_HEADER_SIZE);
    return output;
  }

  public decodeHeader(bytes: Uint8Array): DecodedLocoHeader {
    if (bytes.byteLength < LOCO_HEADER_SIZE) {
      throw new InvalidLocoPacketError(`LOCO header requires ${LOCO_HEADER_SIZE} bytes`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, LOCO_HEADER_SIZE);
    const payloadLength = view.getUint32(18, true);
    if (payloadLength > this.maxPayloadSize) {
      throw new LocoPacketTooLargeError(payloadLength, this.maxPayloadSize);
    }

    return {
      id: view.getUint32(0, true),
      status: view.getUint16(4, true),
      method: decodeMethod(bytes.subarray(6, 17)),
      dataType: view.getUint8(17),
      payloadLength,
    };
  }

  public decode(frame: Uint8Array): LocoPacket {
    const header = this.decodeHeader(frame);
    const expectedLength = LOCO_HEADER_SIZE + header.payloadLength;
    if (frame.byteLength !== expectedLength) {
      throw new InvalidLocoPacketError(
        `LOCO frame length mismatch: expected ${expectedLength}, received ${frame.byteLength}`,
      );
    }

    return {
      header: {
        id: header.id,
        status: header.status,
        method: header.method,
      },
      dataType: header.dataType,
      payload: frame.slice(LOCO_HEADER_SIZE),
    };
  }
}

export class LocoFrameDecoder {
  private buffer = new Uint8Array(0);
  private readonly codec: LocoFrameCodec;
  private readonly maxBufferedBytes: number;

  public constructor(options: LocoFrameDecoderOptions = {}) {
    this.codec = new LocoFrameCodec(options);
    this.maxBufferedBytes = options.maxBufferedBytes ?? LOCO_DEFAULT_MAX_BUFFERED_BYTES;
    if (!Number.isSafeInteger(this.maxBufferedBytes) || this.maxBufferedBytes < LOCO_HEADER_SIZE) {
      throw new RangeError(`maxBufferedBytes must be at least ${LOCO_HEADER_SIZE}`);
    }
  }

  public get bufferedBytes(): number {
    return this.buffer.byteLength;
  }

  public reset(): void {
    this.buffer = new Uint8Array(0);
  }

  public push(chunk: Uint8Array): LocoPacket[] {
    if (chunk.byteLength === 0) return [];
    const combinedLength = this.buffer.byteLength + chunk.byteLength;
    if (combinedLength > this.maxBufferedBytes) {
      throw new LocoPacketTooLargeError(combinedLength, this.maxBufferedBytes);
    }

    const combined = new Uint8Array(combinedLength);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.byteLength);
    this.buffer = combined;

    const packets: LocoPacket[] = [];
    let offset = 0;
    while (this.buffer.byteLength - offset >= LOCO_HEADER_SIZE) {
      const header = this.codec.decodeHeader(this.buffer.subarray(offset, offset + LOCO_HEADER_SIZE));
      const frameLength = LOCO_HEADER_SIZE + header.payloadLength;
      if (this.buffer.byteLength - offset < frameLength) break;

      packets.push(this.codec.decode(this.buffer.slice(offset, offset + frameLength)));
      offset += frameLength;
    }

    if (offset > 0) this.buffer = this.buffer.slice(offset);
    return packets;
  }
}
