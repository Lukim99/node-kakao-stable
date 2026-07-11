export class AndroidMediaError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class AndroidMediaTimeoutError extends AndroidMediaError {
  public constructor(public readonly timeoutMs: number) {
    super(`Android media operation timed out after ${timeoutMs}ms`);
  }
}

export class AndroidMediaAbortedError extends AndroidMediaError {
  public constructor(options?: ErrorOptions) {
    super('Android media operation was aborted', options);
  }
}

export class AndroidMediaCompleteError extends AndroidMediaError {
  public constructor(public readonly status: number) {
    super(`Android media upload failed with remote status ${status}`);
  }
}

export class AndroidMediaRemoteStatusError extends AndroidMediaError {
  public constructor(
    public readonly method: string,
    public readonly status: number,
  ) {
    super(`Android media command ${method} failed with remote status ${status}`);
  }
}

export class AndroidMediaProtocolError extends AndroidMediaError {}
