import {
  BsonPayloadCodec,
  type LocoRequestUnion,
} from '@lukim9-kakao/protocol-core';
import {
  androidReferenceCommandSchemas,
  observedReactionCommandSchemas,
  type AndroidReferenceCommands,
  type AndroidCandidateCommands,
} from '@lukim9-kakao/protocol-android';
import {
  LocoSession,
  type ByteTransport,
  type LocoSessionOptions,
} from '@lukim9-kakao/transport-node';

export type AndroidReferenceSessionOptions = Omit<
  LocoSessionOptions<AndroidReferenceCommands>,
  'commandSchemas'
> & {
  /**
   * Attach runtime request/response validators. Defaults to true. Set false for
   * live production sessions, where real-server responses vary and a validation
   * mismatch should not throw (e.g. the GETCONF config blob).
   */
  readonly validate?: boolean;
};

export function createAndroidReferenceSession(
  transport: ByteTransport,
  options: AndroidReferenceSessionOptions = {},
): LocoSession<AndroidReferenceCommands> {
  const { validate = true, ...sessionOptions } = options;
  return new LocoSession<AndroidReferenceCommands>(
    transport,
    new BsonPayloadCodec<LocoRequestUnion<AndroidReferenceCommands>, unknown>(),
    { ...sessionOptions, ...(validate ? { commandSchemas: androidReferenceCommandSchemas } : {}) },
  );
}

/** Creates a session with the macOS-observed, Android-unverified ACTION schema. */
export function createAndroidCandidateSession(
  transport: ByteTransport,
  options: Omit<LocoSessionOptions<AndroidCandidateCommands>, 'commandSchemas'> = {},
): LocoSession<AndroidCandidateCommands> {
  return new LocoSession<AndroidCandidateCommands>(
    transport,
    new BsonPayloadCodec<LocoRequestUnion<AndroidCandidateCommands>, unknown>(),
    {
      ...options,
      commandSchemas: {
        ...androidReferenceCommandSchemas,
        ...observedReactionCommandSchemas,
      },
    },
  );
}
