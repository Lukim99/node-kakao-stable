import {
  LocoFrameCodec,
  type LocoPacket,
  type PayloadCodec,
} from '@lukim9-kakao/protocol-core';
import { LocoFrameReader, type ByteTransport } from '@lukim9-kakao/transport-node';

export interface FakeLocoResponse {
  readonly send?: boolean;
  readonly status?: number;
  readonly data: object;
  readonly method?: string;
}

export type FakeLocoHandler = (
  request: unknown,
  packet: LocoPacket,
) => FakeLocoResponse | Promise<FakeLocoResponse>;

export interface FakeLocoServerOptions {
  readonly codec: PayloadCodec<object, unknown>;
  readonly handlers: Readonly<Record<string, FakeLocoHandler>>;
}

export class FakeLocoServer {
  private readonly frameCodec = new LocoFrameCodec();
  private readonly tasks = new Set<Promise<void>>();
  private readonly readerTask: Promise<void>;
  private stopped = false;
  public failure?: Error;

  public constructor(
    private readonly transport: ByteTransport,
    private readonly options: FakeLocoServerOptions,
  ) {
    this.readerTask = this.readLoop();
  }

  public async push(method: string, data: object, id = 0): Promise<void> {
    await this.send({ header: { id, status: 0, method }, ...this.encode(data) });
  }

  public async sendPacketsCoalesced(packets: readonly LocoPacket[]): Promise<void> {
    const frames = packets.map((packet) => this.frameCodec.encode(packet));
    const size = frames.reduce((total, frame) => total + frame.byteLength, 0);
    const wire = new Uint8Array(size);
    let offset = 0;
    for (const frame of frames) {
      wire.set(frame, offset);
      offset += frame.byteLength;
    }
    await this.transport.write(wire);
  }

  public makePacket(id: number, method: string, data: object, status = 0): LocoPacket {
    return { header: { id, status, method }, ...this.encode(data) };
  }

  public async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.transport.close();
    await Promise.allSettled([...this.tasks]);
    await this.readerTask;
  }

  private encode(data: object): Pick<LocoPacket, 'dataType' | 'payload'> {
    return this.options.codec.encode(data);
  }

  private async send(packet: LocoPacket): Promise<void> {
    if (!this.stopped) await this.transport.write(this.frameCodec.encode(packet));
  }

  private async readLoop(): Promise<void> {
    try {
      const reader = new LocoFrameReader();
      for await (const packet of reader.read(this.transport.readable)) {
        const handler = this.options.handlers[packet.header.method];
        if (handler === undefined) continue;
        const task = Promise.resolve(handler(
          this.options.codec.decode(packet.dataType, packet.payload),
          packet,
        )).then(async (response) => {
          if (response.send === false) return;
          await this.send({
            header: {
              id: packet.header.id,
              status: response.status ?? 0,
              method: response.method ?? packet.header.method,
            },
            ...this.encode(response.data),
          });
        }).catch((cause: unknown) => {
          this.failure = cause instanceof Error ? cause : new Error('Fake server handler failed');
        });
        this.tasks.add(task);
        void task.finally(() => this.tasks.delete(task));
      }
    } catch (cause) {
      if (!this.stopped) this.failure = cause instanceof Error ? cause : new Error('Fake server read failed');
    }
  }
}
