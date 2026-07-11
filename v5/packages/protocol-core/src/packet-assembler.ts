import { UnsupportedLocoDataTypeError } from './errors.js';
import { RequestIdAllocator } from './request-id-allocator.js';
import type { LocoPacket, PayloadCodec } from './types.js';

export interface PacketAssemblerOptions {
  readonly firstRequestId?: number;
  readonly maximumRequestId?: number;
}

export class PacketAssembler<TInput, TOutput> {
  private readonly requestIds: RequestIdAllocator;

  public constructor(
    private readonly payloadCodec: PayloadCodec<TInput, TOutput>,
    options: PacketAssemblerOptions = {},
  ) {
    const firstRequestId = options.firstRequestId ?? 1;
    const maximumRequestId = options.maximumRequestId ?? 99_999;
    this.requestIds = new RequestIdAllocator({
      minimum: 1,
      maximum: maximumRequestId,
      initial: firstRequestId,
    });
  }

  public construct(method: string, data: TInput): LocoPacket {
    const encoded = this.payloadCodec.encode(data);
    const id = this.requestIds.acquire();
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

  public releaseRequestId(id: number): boolean {
    return this.requestIds.release(id);
  }
}
