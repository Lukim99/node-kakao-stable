import { InvalidLocoPacketError, UnsupportedLocoDataTypeError } from './errors.js';
import type { LocoPacket, PayloadCodec } from './types.js';

export interface PacketAssemblerOptions {
  readonly firstRequestId?: number;
  readonly maximumRequestId?: number;
}

export class PacketAssembler<TInput, TOutput> {
  private nextRequestId: number;
  private readonly maximumRequestId: number;

  public constructor(
    private readonly payloadCodec: PayloadCodec<TInput, TOutput>,
    options: PacketAssemblerOptions = {},
  ) {
    this.nextRequestId = options.firstRequestId ?? 1;
    this.maximumRequestId = options.maximumRequestId ?? 99_999;

    if (!Number.isInteger(this.nextRequestId) || this.nextRequestId < 1) {
      throw new RangeError('firstRequestId must be a positive integer');
    }
    if (!Number.isInteger(this.maximumRequestId) || this.maximumRequestId < this.nextRequestId) {
      throw new RangeError('maximumRequestId must be >= firstRequestId');
    }
  }

  public construct(method: string, data: TInput): LocoPacket {
    const encoded = this.payloadCodec.encode(data);
    const id = this.allocateRequestId();
    return {
      header: { id, status: 0, method },
      dataType: encoded.dataType,
      payload: encoded.payload,
    };
  }

  public deconstruct(packet: LocoPacket): TOutput {
    if (!this.payloadCodec.canDecode(packet.dataType)) {
      throw new UnsupportedLocoDataTypeError(packet.dataType);
    }
    return this.payloadCodec.decode(packet.dataType, packet.payload);
  }

  private allocateRequestId(): number {
    if (this.nextRequestId > this.maximumRequestId) {
      throw new InvalidLocoPacketError('request id allocator entered an invalid state');
    }
    const id = this.nextRequestId;
    this.nextRequestId = id === this.maximumRequestId ? 1 : id + 1;
    return id;
  }
}
