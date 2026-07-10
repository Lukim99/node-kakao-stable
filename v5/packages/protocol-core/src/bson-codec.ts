import {
  deserialize,
  serialize,
  type DeserializeOptions,
  type Document,
  type SerializeOptions,
} from 'bson';
import { UnsupportedLocoDataTypeError } from './errors.js';
import type { EncodedPayload, PayloadCodec } from './types.js';

export interface BsonPayloadCodecOptions {
  readonly encodedDataType?: number;
  readonly acceptedDataTypes?: ReadonlySet<number>;
  readonly serializeOptions?: SerializeOptions;
  readonly deserializeOptions?: DeserializeOptions;
}

export class BsonPayloadCodec<
  TInput extends object = Document,
  TOutput = Document,
> implements PayloadCodec<TInput, TOutput> {
  private readonly encodedDataType: number;
  private readonly acceptedDataTypes: ReadonlySet<number>;
  private readonly serializeOptions: SerializeOptions;
  private readonly deserializeOptions: DeserializeOptions;

  public constructor(options: BsonPayloadCodecOptions = {}) {
    this.encodedDataType = options.encodedDataType ?? 0;
    this.acceptedDataTypes = options.acceptedDataTypes ?? new Set([0, 8]);
    this.serializeOptions = {
      ignoreUndefined: true,
      ...options.serializeOptions,
    };
    this.deserializeOptions = {
      promoteLongs: false,
      ...options.deserializeOptions,
    };
  }

  public canDecode(dataType: number): boolean {
    return this.acceptedDataTypes.has(dataType);
  }

  public encode(value: TInput): EncodedPayload {
    return {
      dataType: this.encodedDataType,
      payload: serialize(value as Document, this.serializeOptions),
    };
  }

  public decode(dataType: number, payload: Uint8Array): TOutput {
    if (!this.canDecode(dataType)) throw new UnsupportedLocoDataTypeError(dataType);
    return deserialize(payload, this.deserializeOptions) as TOutput;
  }
}
