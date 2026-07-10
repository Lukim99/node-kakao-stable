export interface LocoPacketHeader {
  readonly id: number;
  readonly status: number;
  readonly method: string;
}

export interface LocoPacket {
  readonly header: LocoPacketHeader;
  readonly dataType: number;
  readonly payload: Uint8Array;
}

export interface DecodedLocoHeader extends LocoPacketHeader {
  readonly dataType: number;
  readonly payloadLength: number;
}

export interface EncodedPayload {
  readonly dataType: number;
  readonly payload: Uint8Array;
}

export interface PayloadCodec<TInput, TOutput> {
  canDecode(dataType: number): boolean;
  encode(value: TInput): EncodedPayload;
  decode(dataType: number, payload: Uint8Array): TOutput;
}
