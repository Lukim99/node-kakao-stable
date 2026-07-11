import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import { NodeTcpTransport } from './tcp-transport.js';

export class LocoTlsConnectError extends Error {
  public constructor(options?: ErrorOptions) {
    super('TLS transport connection failed', options);
    this.name = new.target.name;
  }
}

export interface NodeTlsTransportConnectOptions extends ConnectionOptions {
  readonly signal?: AbortSignal;
}

export class NodeTlsTransport extends NodeTcpTransport {
  private constructor(socket: TLSSocket) {
    super(socket);
  }

  public static override async connect(
    options: NodeTlsTransportConnectOptions,
  ): Promise<NodeTlsTransport> {
    if (options.signal?.aborted === true) {
      throw new LocoTlsConnectError({ cause: options.signal.reason });
    }
    const { signal, ...connectOptions } = options;
    return await new Promise<NodeTlsTransport>((resolve, reject) => {
      const socket = connect(connectOptions);
      const cleanup = (): void => {
        socket.removeListener('secureConnect', onConnect);
        socket.removeListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      const onConnect = (): void => {
        cleanup();
        resolve(new NodeTlsTransport(socket));
      };
      const onError = (cause: Error): void => {
        cleanup();
        socket.destroy();
        reject(new LocoTlsConnectError({ cause }));
      };
      const onAbort = (): void => {
        cleanup();
        socket.destroy();
        reject(new LocoTlsConnectError({ cause: signal?.reason }));
      };
      socket.once('secureConnect', onConnect);
      socket.once('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
