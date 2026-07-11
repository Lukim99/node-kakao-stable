import { LocoPushQueueOverflowError } from './errors.js';

interface QueueWaiter<T> {
  readonly resolve: (result: IteratorResult<T>) => void;
  readonly reject: (error: Error) => void;
}

export class AsyncPacketQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: QueueWaiter<T>[] = [];
  private ended = false;
  private failure?: Error;

  public constructor(public readonly maximumSize: number) {
    if (!Number.isSafeInteger(maximumSize) || maximumSize < 1) {
      throw new RangeError('maximumSize must be a positive safe integer');
    }
  }

  public get size(): number {
    return this.values.length;
  }

  public enqueue(value: T): void {
    if (this.ended) throw this.failure ?? new Error('Cannot enqueue into a closed queue');
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ done: false, value });
      return;
    }
    if (this.values.length >= this.maximumSize) {
      throw new LocoPushQueueOverflowError(this.maximumSize);
    }
    this.values.push(value);
  }

  public close(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  public fail(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    this.values.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => this.next(),
      return: async (): Promise<IteratorResult<T>> => ({ done: true, value: undefined }),
    };
  }

  private next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve({ done: true, value: undefined });
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
