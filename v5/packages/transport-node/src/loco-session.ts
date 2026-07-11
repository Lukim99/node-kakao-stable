import {
  LocoFrameCodec,
  RequestIdAllocator,
  type LocoCommandSchemas,
  type LocoMethodOf,
  type LocoPacket,
  type LocoRequestOf,
  type LocoRequestUnion,
  type LocoResponseOf,
  type PayloadCodec,
} from '@lukim9-kakao/protocol-core';
import { AsyncPacketQueue } from './async-packet-queue.js';
import { LocoFrameReader } from './frame-reader.js';
import {
  LocoIncompleteFrameError,
  LocoPushQueueOverflowError,
  LocoRemoteStatusError,
  LocoRequestAbortedError,
  LocoRequestTimeoutError,
  LocoRequestValidationError,
  LocoResponseMethodMismatchError,
  LocoResponseValidationError,
  LocoSessionClosedError,
  LocoTransportReadError,
  LocoTransportWriteError,
} from './errors.js';
import type { ByteTransport } from './transport.js';

export interface LocoRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface LocoSessionOptions<TCommands> {
  readonly requestIds?: RequestIdAllocator;
  readonly pushQueueSize?: number;
  readonly commandSchemas?: LocoCommandSchemas<TCommands>;
  readonly isSuccessStatus?: (status: number, method: string) => boolean;
  readonly validateResponseMethod?: (expected: string, actual: string) => boolean;
  readonly frameReader?: LocoFrameReader;
}

interface PendingRequest {
  readonly id: number;
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export class LocoSession<TCommands> implements AsyncDisposable {
  private readonly frameCodec = new LocoFrameCodec();
  private readonly frameReader: LocoFrameReader;
  private readonly requestIds: RequestIdAllocator;
  private readonly pushQueue: AsyncPacketQueue<LocoPacket>;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly commandSchemas: LocoCommandSchemas<TCommands> | undefined;
  private readonly isSuccessStatus: (status: number, method: string) => boolean;
  private readonly validateResponseMethod: (expected: string, actual: string) => boolean;
  private readonly readerTask: Promise<void>;
  private state: 'open' | 'closing' | 'closed' = 'open';
  private transportCloseTask?: Promise<void>;

  public constructor(
    private readonly transport: ByteTransport,
    private readonly payloadCodec: PayloadCodec<LocoRequestUnion<TCommands>, unknown>,
    options: LocoSessionOptions<TCommands> = {},
  ) {
    this.frameReader = options.frameReader ?? new LocoFrameReader();
    this.requestIds = options.requestIds ?? new RequestIdAllocator();
    this.pushQueue = new AsyncPacketQueue(options.pushQueueSize ?? 100);
    this.commandSchemas = options.commandSchemas;
    this.isSuccessStatus = options.isSuccessStatus ?? ((status) => status === 0);
    this.validateResponseMethod = options.validateResponseMethod ?? ((expected, actual) => expected === actual);
    this.readerTask = this.runReader();
  }

  public get pendingRequestCount(): number {
    return this.pending.size;
  }

  public get queuedPushCount(): number {
    return this.pushQueue.size;
  }

  public pushes(): AsyncIterable<LocoPacket> {
    return this.pushQueue;
  }

  public async request<TMethod extends LocoMethodOf<TCommands>>(
    method: TMethod,
    request: LocoRequestOf<TCommands, TMethod>,
    options: LocoRequestOptions = {},
  ): Promise<LocoResponseOf<TCommands, TMethod>> {
    if (this.state !== 'open') throw new LocoSessionClosedError('LOCO session is closed');
    if (options.signal?.aborted === true) throw new LocoRequestAbortedError(method);
    if (options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0)) {
      throw new RangeError('timeoutMs must be a non-negative safe integer');
    }
    const schema = this.commandSchemas?.[method as keyof TCommands];
    if (schema?.validateRequest !== undefined && !schema.validateRequest(request)) {
      throw new LocoRequestValidationError(method);
    }

    const requestId = this.requestIds.acquire();
    let pending!: PendingRequest;
    const response = new Promise<unknown>((resolve, reject) => {
      pending = { id: requestId, method, resolve, reject, settled: false };
    });
    this.pending.set(requestId, pending);

    if (options.timeoutMs !== undefined) {
      pending.timer = setTimeout(() => {
        this.finishPending(
          pending,
          undefined,
          new LocoRequestTimeoutError(method, requestId, options.timeoutMs ?? 0),
        );
      }, options.timeoutMs);
    }
    if (options.signal !== undefined) {
      const listener = (): void => {
        this.finishPending(pending, undefined, new LocoRequestAbortedError(method, requestId));
      };
      pending.signal = options.signal;
      pending.abortListener = listener;
      options.signal.addEventListener('abort', listener, { once: true });
    }

    let wire: Uint8Array;
    try {
      const encoded = this.payloadCodec.encode(request as LocoRequestUnion<TCommands>);
      const packet: LocoPacket = {
        header: { id: requestId, status: 0, method },
        dataType: encoded.dataType,
        payload: encoded.payload,
      };
      wire = this.frameCodec.encode(packet);
    } catch (cause) {
      this.finishPending(
        pending,
        undefined,
        cause instanceof Error ? cause : new Error(`LOCO request ${method} encoding failed`),
      );
      return await response as LocoResponseOf<TCommands, TMethod>;
    }

    try {
      if (options.signal === undefined) await this.transport.write(wire);
      else await this.transport.write(wire, { signal: options.signal });
    } catch (cause) {
      const error = isAborted(options.signal)
        ? new LocoRequestAbortedError(method, requestId)
        : new LocoTransportWriteError({ cause });
      this.finishPending(pending, undefined, error);
      if (!(error instanceof LocoRequestAbortedError)) await this.terminate(error, false);
    }

    return await response as LocoResponseOf<TCommands, TMethod>;
  }

  public async close(): Promise<void> {
    await this.terminate(new LocoSessionClosedError('LOCO session was closed'), true);
    await this.readerTask;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async runReader(): Promise<void> {
    try {
      for await (const packet of this.frameReader.read(this.transport.readable)) {
        this.routePacket(packet);
      }
      if (this.state === 'open') {
        await this.terminate(new LocoSessionClosedError('LOCO transport ended'), false);
      }
    } catch (cause) {
      if (this.state !== 'open') return;
      const error = cause instanceof LocoIncompleteFrameError
        ? cause
        : cause instanceof LocoPushQueueOverflowError
          ? cause
          : new LocoTransportReadError({ cause });
      await this.terminate(error, false);
    }
  }

  private routePacket(packet: LocoPacket): void {
    const pending = this.pending.get(packet.header.id);
    if (pending === undefined) {
      this.pushQueue.enqueue(packet);
      return;
    }
    if (!this.validateResponseMethod(pending.method, packet.header.method)) {
      this.finishPending(
        pending,
        undefined,
        new LocoResponseMethodMismatchError(pending.method, packet.header.method, pending.id),
      );
      return;
    }
    if (!this.isSuccessStatus(packet.header.status, packet.header.method)) {
      this.finishPending(
        pending,
        undefined,
        new LocoRemoteStatusError(packet.header.status, pending.method, pending.id),
      );
      return;
    }

    try {
      const decoded = this.payloadCodec.decode(packet.dataType, packet.payload);
      const schema = this.commandSchemas?.[pending.method as keyof TCommands];
      if (schema?.validateResponse !== undefined && !schema.validateResponse(decoded)) {
        throw new LocoResponseValidationError(pending.method, pending.id);
      }
      this.finishPending(pending, decoded);
    } catch (cause) {
      this.finishPending(
        pending,
        undefined,
        cause instanceof Error ? cause : new LocoResponseValidationError(pending.method, pending.id),
      );
    }
  }

  private finishPending(pending: PendingRequest, value?: unknown, error?: Error): boolean {
    if (pending.settled || this.pending.get(pending.id) !== pending) return false;
    pending.settled = true;
    this.pending.delete(pending.id);
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    if (pending.signal !== undefined && pending.abortListener !== undefined) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
    this.requestIds.release(pending.id);
    if (error !== undefined) pending.reject(error);
    else pending.resolve(value);
    return true;
  }

  private async terminate(error: Error, explicit: boolean): Promise<void> {
    if (this.state === 'closed') return;
    if (this.state === 'closing') {
      await this.transportCloseTask;
      return;
    }
    this.state = 'closing';
    for (const pending of [...this.pending.values()]) this.finishPending(pending, undefined, error);
    if (explicit) this.pushQueue.close();
    else this.pushQueue.fail(error);
    this.transportCloseTask = this.transport.close(error).catch(() => undefined);
    await this.transportCloseTask;
    this.state = 'closed';
  }
}
