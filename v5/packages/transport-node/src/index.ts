import { LocoFrameDecoder, type LocoPacket } from '@node-kakao/protocol-core';

export interface ByteTransport extends AsyncDisposable {
  readonly readable: AsyncIterable<Uint8Array>;
  write(data: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void>;
  close(reason?: Error): Promise<void>;
}

export class LocoFrameReader {
  private readonly decoder: LocoFrameDecoder;

  public constructor(options?: ConstructorParameters<typeof LocoFrameDecoder>[0]) {
    this.decoder = new LocoFrameDecoder(options);
  }

  public async *read(source: AsyncIterable<Uint8Array>): AsyncGenerator<LocoPacket, void, void> {
    for await (const chunk of source) {
      for (const packet of this.decoder.push(chunk)) yield packet;
    }

    if (this.decoder.bufferedBytes !== 0) {
      throw new Error(`Transport ended with ${this.decoder.bufferedBytes} incomplete LOCO bytes`);
    }
  }
}
