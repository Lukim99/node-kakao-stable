export class LocoSessionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class LocoSessionClosedError extends LocoSessionError {}

export class LocoRequestTimeoutError extends LocoSessionError {
  public constructor(
    public readonly method: string,
    public readonly requestId: number,
    public readonly timeoutMs: number,
  ) {
    super(`LOCO request ${method} #${requestId} timed out after ${timeoutMs}ms`);
  }
}

export class LocoRequestAbortedError extends LocoSessionError {
  public constructor(public readonly method: string, public readonly requestId?: number) {
    super(
      requestId === undefined
        ? `LOCO request ${method} was aborted before dispatch`
        : `LOCO request ${method} #${requestId} was aborted`,
    );
  }
}

export class LocoRemoteStatusError extends LocoSessionError {
  public constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly requestId: number,
  ) {
    super(`LOCO request ${method} #${requestId} failed with remote status ${status}`);
  }
}

export class LocoResponseMethodMismatchError extends LocoSessionError {
  public constructor(
    public readonly expectedMethod: string,
    public readonly actualMethod: string,
    public readonly requestId: number,
  ) {
    super(
      `LOCO response #${requestId} method mismatch: expected ${expectedMethod}, received ${actualMethod}`,
    );
  }
}

export class LocoResponseValidationError extends LocoSessionError {
  public constructor(public readonly method: string, public readonly requestId: number) {
    super(`LOCO response ${method} #${requestId} failed runtime validation`);
  }
}

export class LocoRequestValidationError extends LocoSessionError {
  public constructor(public readonly method: string) {
    super(`LOCO request ${method} failed runtime validation`);
  }
}

export class LocoPushQueueOverflowError extends LocoSessionError {
  public constructor(public readonly maximumSize: number) {
    super(`LOCO push queue exceeded its maximum size of ${maximumSize}`);
  }
}

export class LocoIncompleteFrameError extends LocoSessionError {
  public constructor(public readonly bufferedBytes: number) {
    super(`Transport ended with ${bufferedBytes} incomplete LOCO bytes`);
  }
}

export class LocoTransportReadError extends LocoSessionError {
  public constructor(options?: ErrorOptions) {
    super('LOCO transport read failed', options);
  }
}

export class LocoTransportWriteError extends LocoSessionError {
  public constructor(options?: ErrorOptions) {
    super('LOCO transport write failed', options);
  }
}
