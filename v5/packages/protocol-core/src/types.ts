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

export interface PayloadEncoder<TInput> {
  encode(value: TInput): EncodedPayload;
}

export interface PayloadDecoder<TOutput> {
  canDecode(dataType: number): boolean;
  decode(dataType: number, payload: Uint8Array): TOutput;
}

export interface PayloadCodec<TInput, TOutput>
  extends PayloadEncoder<TInput>, PayloadDecoder<TOutput> {}
