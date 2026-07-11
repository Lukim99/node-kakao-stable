import { RequestIdExhaustedError } from './errors.js';

export interface RequestIdAllocatorOptions {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly initial?: number;
}

export class RequestIdAllocator {
  public readonly minimum: number;
  public readonly maximum: number;
  private next: number;
  private readonly acquired = new Set<number>();

  public constructor(options: RequestIdAllocatorOptions = {}) {
    this.minimum = options.minimum ?? 1;
    this.maximum = options.maximum ?? 99_999;
    if (!Number.isSafeInteger(this.minimum) || this.minimum < 0) {
      throw new RangeError('minimum must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(this.maximum) || this.maximum > 0xffff_ffff) {
      throw new RangeError('maximum must be a safe uint32 integer');
    }
    if (this.maximum < this.minimum) {
      throw new RangeError('maximum must be greater than or equal to minimum');
    }
    this.next = options.initial ?? this.minimum;
    if (!Number.isSafeInteger(this.next) || this.next < this.minimum || this.next > this.maximum) {
      throw new RangeError('initial must be within the configured request ID range');
    }
  }

  public get size(): number {
    return this.acquired.size;
  }

  public acquire(): number {
    const capacity = this.maximum - this.minimum + 1;
    if (this.acquired.size >= capacity) {
      throw new RequestIdExhaustedError(this.minimum, this.maximum);
    }

    for (let attempts = 0; attempts < capacity; attempts += 1) {
      const candidate = this.next;
      this.next = candidate === this.maximum ? this.minimum : candidate + 1;
      if (!this.acquired.has(candidate)) {
        this.acquired.add(candidate);
        return candidate;
      }
    }

    throw new RequestIdExhaustedError(this.minimum, this.maximum);
  }

  public release(id: number): boolean {
    if (!Number.isSafeInteger(id) || id < this.minimum || id > this.maximum) return false;
    return this.acquired.delete(id);
  }

  public isAcquired(id: number): boolean {
    return this.acquired.has(id);
  }
}
