import { LocoFrameDecoder, type LocoPacket } from '@lukim9-kakao/protocol-core';
import { LocoIncompleteFrameError } from './errors.js';

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
      throw new LocoIncompleteFrameError(this.decoder.bufferedBytes);
    }
  }
}
