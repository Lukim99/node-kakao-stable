import { Socket, createConnection, type TcpNetConnectOpts } from 'node:net';
import type { ByteTransport } from './transport.js';

export class LocoTcpConnectError extends Error {
  public constructor(options?: ErrorOptions) {
    super('TCP transport connection failed', options);
    this.name = new.target.name;
  }
}

export interface NodeTcpTransportConnectOptions extends TcpNetConnectOpts {
  readonly signal?: AbortSignal;
}

export class NodeTcpTransport implements ByteTransport {
  public readonly readable: AsyncIterable<Uint8Array>;
  private closeTask: Promise<void> | undefined;

  protected constructor(protected readonly socket: Socket) {
    this.readable = this.readSocket();
  }

  public static async connect(options: NodeTcpTransportConnectOptions): Promise<NodeTcpTransport> {
    if (options.signal?.aborted === true) {
      throw new LocoTcpConnectError({ cause: options.signal.reason });
    }
    const { signal, ...connectOptions } = options;
    return await new Promise<NodeTcpTransport>((resolve, reject) => {
      const socket = createConnection(connectOptions);
      const cleanup = (): void => {
        socket.removeListener('connect', onConnect);
        socket.removeListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      const onConnect = (): void => {
        cleanup();
        resolve(new NodeTcpTransport(socket));
      };
      const onError = (cause: Error): void => {
        cleanup();
        socket.destroy();
        reject(new LocoTcpConnectError({ cause }));
      };
      const onAbort = (): void => {
        cleanup();
        socket.destroy();
        reject(new LocoTcpConnectError({ cause: signal?.reason }));
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  public async write(data: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void> {
    if (options?.signal?.aborted === true) throw options.signal.reason;
    const copy = data.slice();
    await new Promise<void>((resolve, reject) => {
      const signal = options?.signal;
      const onAbort = (): void => reject(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.socket.write(copy, (error?: Error | null) => {
        signal?.removeEventListener('abort', onAbort);
        if (error === undefined || error === null) resolve();
        else reject(error);
      });
    });
  }

  public async close(_reason?: Error): Promise<void> {
    if (this.closeTask !== undefined) return await this.closeTask;
    this.closeTask = new Promise<void>((resolve) => {
      if (this.socket.destroyed) {
        resolve();
        return;
      }
      this.socket.once('close', () => resolve());
      this.socket.destroy();
    });
    await this.closeTask;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async *readSocket(): AsyncGenerator<Uint8Array> {
    for await (const chunk of this.socket) {
      if (!(chunk instanceof Uint8Array)) throw new Error('TCP socket yielded a non-byte chunk');
      yield chunk.slice();
    }
  }
}
