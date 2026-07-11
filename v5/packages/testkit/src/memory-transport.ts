import type { ByteTransport } from '@lukim9-kakao/transport-node';
import { fragmentBytes } from './bytes.js';

interface Waiter {
  readonly resolve: (result: IteratorResult<Uint8Array>) => void;
  readonly reject: (error: Error) => void;
}

class ByteQueue implements AsyncIterable<Uint8Array> {
  private readonly chunks: Uint8Array[] = [];
  private readonly waiters: Waiter[] = [];
  private ended = false;
  private failure?: Error;

  public push(chunk: Uint8Array): void {
    if (this.ended) throw new Error('Memory transport peer is closed');
    const copy = chunk.slice();
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.chunks.push(copy);
    else waiter.resolve({ done: false, value: copy });
  }

  public end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  public fail(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    this.chunks.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  public [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return { next: () => this.next() };
  }

  private next(): Promise<IteratorResult<Uint8Array>> {
    const chunk = this.chunks.shift();
    if (chunk !== undefined) return Promise.resolve({ done: false, value: chunk });
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

export interface MemoryTransportDirectionOptions {
  readonly fragmentSizes?: readonly number[];
  readonly writeDelayMs?: number;
}

export interface MemoryTransportPairOptions {
  readonly client?: MemoryTransportDirectionOptions;
  readonly server?: MemoryTransportDirectionOptions;
}

interface PairState {
  closed: boolean;
  readonly clientInbound: ByteQueue;
  readonly serverInbound: ByteQueue;
}

export class MemoryTransport implements ByteTransport {
  public readonly readable: AsyncIterable<Uint8Array>;
  public closeCallCount = 0;
  private nextWriteError: Error | undefined;

  public constructor(
    private readonly inbound: ByteQueue,
    private readonly outbound: ByteQueue,
    private readonly state: PairState,
    private readonly direction: MemoryTransportDirectionOptions,
  ) {
    this.readable = inbound;
  }

  public failNextWrite(error: Error): void {
    this.nextWriteError = error;
  }

  public injectReadError(error: Error): void {
    this.inbound.fail(error);
  }

  public async write(data: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void> {
    if (isAborted(options?.signal)) throw options?.signal?.reason;
    const failure = this.nextWriteError;
    this.nextWriteError = undefined;
    if (failure !== undefined) throw failure;
    if (this.state.closed) throw new Error('Memory transport is closed');
    const delay = this.direction.writeDelayMs ?? 0;
    if (!Number.isSafeInteger(delay) || delay < 0) throw new RangeError('writeDelayMs must be non-negative');
    if (delay > 0) {
      await new Promise<void>((resolve, reject) => {
        const signal = options?.signal;
        const onAbort = (): void => {
          clearTimeout(timer);
          reject(signal?.reason);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delay);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (isAborted(options?.signal)) throw options?.signal?.reason;
    const chunks = this.direction.fragmentSizes === undefined
      ? [data.slice()]
      : fragmentBytes(data, this.direction.fragmentSizes);
    for (const chunk of chunks) this.outbound.push(chunk);
  }

  public async close(_reason?: Error): Promise<void> {
    this.closeCallCount += 1;
    if (this.state.closed) return;
    this.state.closed = true;
    this.state.clientInbound.end();
    this.state.serverInbound.end();
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function createMemoryTransportPair(
  options: MemoryTransportPairOptions = {},
): { readonly client: MemoryTransport; readonly server: MemoryTransport } {
  const clientInbound = new ByteQueue();
  const serverInbound = new ByteQueue();
  const state: PairState = { closed: false, clientInbound, serverInbound };
  return {
    client: new MemoryTransport(clientInbound, serverInbound, state, options.client ?? {}),
    server: new MemoryTransport(serverInbound, clientInbound, state, options.server ?? {}),
  };
}
