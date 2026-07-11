export interface LocoCommandSpec<TRequest, TResponse> {
  readonly request: TRequest;
  readonly response: TResponse;
}

export type LocoCommandMap = Readonly<
  Record<string, LocoCommandSpec<unknown, unknown>>
>;

export type LocoRequestOf<TCommands, TMethod extends keyof TCommands> =
  TCommands[TMethod] extends LocoCommandSpec<infer TRequest, unknown>
    ? TRequest
    : never;

export type LocoResponseOf<TCommands, TMethod extends keyof TCommands> =
  TCommands[TMethod] extends LocoCommandSpec<unknown, infer TResponse>
    ? TResponse
    : never;

export type LocoMethodOf<TCommands> = Extract<keyof TCommands, string>;

export type LocoRequestUnion<TCommands> = {
  [TMethod in keyof TCommands]: LocoRequestOf<TCommands, TMethod>;
}[keyof TCommands];

export interface LocoCommandSchema<TRequest, TResponse> {
  readonly validateRequest?: (value: unknown) => value is TRequest;
  readonly validateResponse?: (value: unknown) => value is TResponse;
}

export type LocoCommandSchemas<TCommands> = Partial<{
  readonly [TMethod in keyof TCommands]: TCommands[TMethod] extends LocoCommandSpec<
    infer TRequest,
    infer TResponse
  >
    ? LocoCommandSchema<TRequest, TResponse>
    : never;
}>;

export type LocoPushMap = Readonly<Record<string, unknown>>;

export type LocoPushOf<TPushes, TMethod extends keyof TPushes> = TPushes[TMethod];

export interface LocoPushSchema<TPush> {
  readonly validate: (value: unknown) => value is TPush;
}

export type LocoPushSchemas<TPushes> = Partial<{
  readonly [TMethod in keyof TPushes]: LocoPushSchema<TPushes[TMethod]>;
}>;
