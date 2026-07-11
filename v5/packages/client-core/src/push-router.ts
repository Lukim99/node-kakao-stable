import type {
  LocoPacket,
  LocoPushOf,
  LocoPushSchemas,
  PayloadDecoder,
} from '@lukim9-kakao/protocol-core';

export class LocoPushValidationError extends Error {
  public constructor(public readonly method: string) {
    super(`LOCO push ${method} failed runtime validation`);
    this.name = new.target.name;
  }
}

export type LocoPushHandler<TPush> = (
  push: TPush,
  packet: LocoPacket,
) => void | Promise<void>;

export interface LocoPushRouterOptions<TPushes> {
  readonly schemas?: LocoPushSchemas<TPushes>;
  readonly requireSchema?: boolean;
  readonly onUnhandled?: (packet: LocoPacket) => void | Promise<void>;
}

export class LocoPushRouter<TPushes> {
  private readonly handlers = new Map<string, LocoPushHandler<unknown>>();
  private readonly schemas: LocoPushSchemas<TPushes> | undefined;
  private readonly requireSchema: boolean;
  private readonly onUnhandled: ((packet: LocoPacket) => void | Promise<void>) | undefined;

  public constructor(
    private readonly decoder: PayloadDecoder<unknown>,
    options: LocoPushRouterOptions<TPushes> = {},
  ) {
    this.schemas = options.schemas;
    this.requireSchema = options.requireSchema ?? true;
    this.onUnhandled = options.onUnhandled;
  }

  public on<TMethod extends Extract<keyof TPushes, string>>(
    method: TMethod,
    handler: LocoPushHandler<LocoPushOf<TPushes, TMethod>>,
  ): () => void {
    const erased: LocoPushHandler<unknown> = (value, packet) =>
      handler(value as LocoPushOf<TPushes, TMethod>, packet);
    this.handlers.set(method, erased);
    return () => {
      if (this.handlers.get(method) === erased) this.handlers.delete(method);
    };
  }

  public async route(packet: LocoPacket): Promise<boolean> {
    const handler = this.handlers.get(packet.header.method);
    if (handler === undefined) {
      await this.onUnhandled?.(packet);
      return false;
    }

    const decoded = this.decoder.decode(packet.dataType, packet.payload);
    const schema = this.schemas?.[packet.header.method as keyof TPushes];
    if (schema === undefined) {
      if (this.requireSchema) throw new LocoPushValidationError(packet.header.method);
    } else if (!schema.validate(decoded)) {
      throw new LocoPushValidationError(packet.header.method);
    }

    await handler(decoded, packet);
    return true;
  }

  public async consume(source: AsyncIterable<LocoPacket>, signal?: AbortSignal): Promise<void> {
    for await (const packet of source) {
      if (signal?.aborted === true) return;
      await this.route(packet);
    }
  }
}
