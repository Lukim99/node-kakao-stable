export class LocoProtocolError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidLocoPacketError extends LocoProtocolError {}

export class LocoPacketTooLargeError extends LocoProtocolError {
  public constructor(
    public readonly actualSize: number,
    public readonly maximumSize: number,
  ) {
    super(`LOCO payload size ${actualSize} exceeds limit ${maximumSize}`);
  }
}

export class UnsupportedLocoDataTypeError extends LocoProtocolError {
  public constructor(public readonly dataType: number) {
    super(`Unsupported LOCO data type: ${dataType}`);
  }
}

export class RequestIdExhaustedError extends LocoProtocolError {
  public constructor(
    public readonly minimum: number,
    public readonly maximum: number,
  ) {
    super(`No LOCO request ID is available in range ${minimum}..${maximum}`);
  }
}
