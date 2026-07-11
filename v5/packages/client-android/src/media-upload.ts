import { createHash, type KeyLike } from 'node:crypto';
import { Long } from 'bson';
import { BsonPayloadCodec } from '@lukim9-kakao/protocol-core';
import {
  LocoSecureTransport,
  NodeTcpTransport,
  type LocoRequestOptions,
  type LocoSession,
} from '@lukim9-kakao/transport-node';
import {
  androidReferencePushSchemas,
  type AndroidReferenceCommands,
  type ChatlogDocument,
  type LocoId,
  type MediaCompletePush,
  type MediaPostRequest,
} from '@lukim9-kakao/protocol-android';
import {
  AndroidMediaAbortedError,
  AndroidMediaCompleteError,
  AndroidMediaProtocolError,
  AndroidMediaRemoteStatusError,
  AndroidMediaTimeoutError,
} from './media-errors.js';
import { createAndroidReferenceSession } from './session.js';

const MEDIA_CHUNK_SIZE = 512 * 1024;
const DEFAULT_MEDIA_TIMEOUT_MS = 120_000;
let fallbackMessageId = 0;

/** A media file to upload (image/audio/file). `checksum` is computed if omitted. */
export interface AndroidMediaUploadForm {
  readonly data: Uint8Array;
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
  readonly ext?: string;
  readonly checksum?: string;
}

/** Client identity fields the media host requires on POST/MPOST. */
export interface AndroidMediaUploadContext {
  readonly publicKey: KeyLike;
  readonly userId: LocoId;
  readonly appVersion: string;
  readonly networkType: number;
  readonly mccmnc: string;
}

export interface AndroidMediaConnection {
  readonly session: LocoSession<AndroidReferenceCommands>;
  write(data: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void>;
  close(): Promise<void>;
}

export interface AndroidMediaConnectionParameters {
  readonly host: string;
  readonly port: number;
  readonly context: AndroidMediaUploadContext;
  readonly signal: AbortSignal;
}

export type AndroidMediaConnectionFactory = (
  parameters: AndroidMediaConnectionParameters,
) => Promise<AndroidMediaConnection>;

export interface AndroidMediaSendOptions {
  /** Deadline for the complete operation, including ticketing, upload and COMPLETE. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Localized summary used by grouped WRITE, e.g. a photo-count label. */
  readonly groupedMessage?: string;
  /** Internal/testing seam; ordinary callers should leave this unset. */
  readonly connectionFactory?: AndroidMediaConnectionFactory;
}

interface OwnedMediaUploadForm extends Omit<AndroidMediaUploadForm, 'data'> {
  readonly data: Uint8Array;
}

function nextFallbackMessageId(): number {
  fallbackMessageId = fallbackMessageId === 0x7fff_ffff ? 1 : fallbackMessageId + 1;
  return fallbackMessageId;
}

function resolveMessageId(value: number | undefined): number {
  const id = value ?? nextFallbackMessageId();
  if (!Number.isSafeInteger(id) || id < 1 || id > 0x7fff_ffff) {
    throw new RangeError('media messageId must be within 1..2147483647');
  }
  return id;
}

function ownForm(form: AndroidMediaUploadForm): OwnedMediaUploadForm {
  return { ...form, data: form.data.slice() };
}

function assertResponseStatus(method: string, response: { readonly status?: number }): void {
  if (response.status !== undefined && response.status !== 0) {
    throw new AndroidMediaRemoteStatusError(method, response.status);
  }
}

/** sha1 hex checksum, matching what SHIP/MSHIP expect. */
export function computeMediaChecksum(data: Uint8Array): string {
  return createHash('sha1').update(data).digest('hex');
}

/** Builds the modern photo POST body; non-photo types retain legacy file-name behavior. */
export function buildMediaPostRequest(params: {
  readonly key: string;
  readonly channelId: LocoId;
  readonly type: number;
  readonly form: AndroidMediaUploadForm;
  readonly context: AndroidMediaUploadContext;
  readonly messageId?: number;
}): MediaPostRequest {
  const { key, channelId, type, form, context } = params;
  const photo = type === 2;
  return {
    k: key,
    s: form.data.byteLength,
    t: type,
    c: channelId,
    mid: params.messageId ?? 1,
    u: context.userId,
    os: 'android',
    av: context.appVersion,
    nt: context.networkType,
    mm: context.mccmnc,
    ...(photo
      ? { dt: 1, scp: 1, ns: false, f: null, ex: '{"cmt":""}', sp: null }
      : { ns: true, f: form.name }),
    ...(form.width !== undefined ? { w: form.width } : {}),
    ...(form.height !== undefined ? { h: form.height } : {}),
  };
}

/** Yields `data` from `offset` in bounded chunks. */
export function* mediaChunks(
  data: Uint8Array,
  offset: number,
  chunkSize = MEDIA_CHUNK_SIZE,
): Generator<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > data.byteLength) {
    throw new RangeError('media offset must be an integer within the data bounds');
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('media chunkSize must be a positive safe integer');
  }
  for (let pos = offset; pos < data.byteLength; pos += chunkSize) {
    yield data.subarray(pos, Math.min(pos + chunkSize, data.byteLength));
  }
}

async function defaultConnectionFactory(
  parameters: AndroidMediaConnectionParameters,
): Promise<AndroidMediaConnection> {
  const tcp = await NodeTcpTransport.connect({
    host: parameters.host,
    port: parameters.port,
    keepAlive: true,
    signal: parameters.signal,
  });
  const secure = new LocoSecureTransport(tcp, { publicKey: parameters.context.publicKey });
  const session = createAndroidReferenceSession(secure, { validate: false });
  return {
    session,
    write: async (data, options) => await secure.write(data, options),
    close: async () => await session.close(),
  };
}

async function awaitComplete(
  session: LocoSession<AndroidReferenceCommands>,
  signal: AbortSignal,
): Promise<MediaCompletePush> {
  const codec = new BsonPayloadCodec();
  const consume = async (): Promise<MediaCompletePush> => {
    for await (const packet of session.pushes()) {
      if (packet.header.method !== 'COMPLETE') continue;
      const decoded = codec.decode(packet.dataType, packet.payload);
      if (!androidReferencePushSchemas.COMPLETE.validate(decoded)) {
        throw new AndroidMediaProtocolError('Android media COMPLETE failed runtime validation');
      }
      if (decoded.status !== 0) throw new AndroidMediaCompleteError(decoded.status);
      return decoded;
    }
    throw new AndroidMediaProtocolError('Android media transport ended before COMPLETE');
  };

  if (signal.aborted) throw signal.reason;
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(signal.reason);
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    return await Promise.race([consume(), aborted]);
  } finally {
    if (abortListener !== undefined) signal.removeEventListener('abort', abortListener);
  }
}

async function runMediaOperation<T>(
  options: AndroidMediaSendOptions,
  operation: (signal: AbortSignal, requestOptions: LocoRequestOptions) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MEDIA_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('media timeoutMs must be a non-negative safe integer');
  }
  if (options.signal?.aborted === true) {
    throw new AndroidMediaAbortedError({ cause: options.signal.reason });
  }

  const controller = new AbortController();
  const timeoutError = new AndroidMediaTimeoutError(timeoutMs);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const onAbort = (): void => {
    controller.abort(new AndroidMediaAbortedError({ cause: options.signal?.reason }));
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await operation(controller.signal, { timeoutMs, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Uploads one media file and returns the finalized chatlog. */
export async function sendMedia(params: {
  readonly controlSession: LocoSession<AndroidReferenceCommands>;
  readonly context: AndroidMediaUploadContext;
  readonly channelId: Long;
  readonly type: number;
  readonly form: AndroidMediaUploadForm;
  readonly options?: AndroidMediaSendOptions;
  /** Internal message sequence value; direct helper users may supply one. */
  readonly messageId?: number;
}): Promise<ChatlogDocument> {
  const { controlSession, context, channelId, type } = params;
  const options = params.options ?? {};
  const form = ownForm(params.form);
  const checksum = form.checksum ?? computeMediaChecksum(form.data);
  const messageId = resolveMessageId(params.messageId);
  const connectionFactory = options.connectionFactory ?? defaultConnectionFactory;

  return await runMediaOperation(options, async (signal, requestOptions) => {
    const ship = await controlSession.request('SHIP', {
      c: channelId,
      t: type,
      s: form.data.byteLength,
      cs: checksum,
      e: form.ext ?? '',
      ...(type === 2 ? { ex: '{}' } : {}),
    }, requestOptions);
    assertResponseStatus('SHIP', ship);

    const connection = await connectionFactory({ host: ship.vh, port: ship.p, context, signal });
    try {
      const post = await connection.session.request('POST', buildMediaPostRequest({
        key: ship.k,
        channelId,
        type,
        form,
        context,
        messageId,
      }), requestOptions);
      assertResponseStatus('POST', post);
      for (const chunk of mediaChunks(form.data, post.o)) {
        await connection.write(chunk, { signal });
      }
      const complete = await awaitComplete(connection.session, signal);
      if (complete.chatLog === undefined) {
        throw new AndroidMediaProtocolError('Android media COMPLETE did not include a chatlog');
      }
      return complete.chatLog;
    } finally {
      await connection.close();
    }
  });
}

/** Uploads several media files and sends one captured-shape grouped WRITE. */
export async function sendMultiMedia(params: {
  readonly controlSession: LocoSession<AndroidReferenceCommands>;
  readonly context: AndroidMediaUploadContext;
  readonly channelId: Long;
  readonly type: number;
  readonly forms: readonly AndroidMediaUploadForm[];
  readonly options?: AndroidMediaSendOptions;
  /** Internal message sequence value; direct helper users may supply one. */
  readonly messageId?: number;
}): Promise<ChatlogDocument> {
  const { controlSession, context, channelId, type } = params;
  if (params.forms.length === 0) throw new RangeError('forms must contain at least one media item');
  const forms = params.forms.map(ownForm);
  const options = params.options ?? {};
  const checksums = forms.map((form) => form.checksum ?? computeMediaChecksum(form.data));
  const messageId = resolveMessageId(params.messageId);
  const connectionFactory = options.connectionFactory ?? defaultConnectionFactory;

  return await runMediaOperation(options, async (signal, requestOptions) => {
    const mship = await controlSession.request('MSHIP', {
      c: channelId,
      t: type,
      sl: forms.map((form) => form.data.byteLength),
      csl: checksums,
      el: forms.map((form) => form.ext ?? ''),
    }, requestOptions);
    assertResponseStatus('MSHIP', mship);
    const ticketLengths = [mship.kl.length, mship.mtl.length, mship.vhl.length, mship.vh6l.length, mship.pl.length];
    if (ticketLengths.some((length) => length !== forms.length)) {
      throw new AndroidMediaProtocolError('MSHIP returned mismatched upload ticket arrays');
    }

    for (let i = 0; i < forms.length; i++) {
      const form = forms[i]!;
      const host = mship.vhl[i];
      const port = mship.pl[i];
      const key = mship.kl[i];
      if (host === undefined || port === undefined || key === undefined) {
        throw new AndroidMediaProtocolError(`MSHIP returned no upload ticket for media #${i}`);
      }
      const connection = await connectionFactory({ host, port, context, signal });
      try {
        const post = await connection.session.request('MPOST', {
          k: key,
          s: form.data.byteLength,
          t: type,
          u: context.userId,
          os: 'android',
          av: context.appVersion,
          nt: context.networkType,
          mm: context.mccmnc,
          dt: 1,
          scp: 1,
        }, requestOptions);
        assertResponseStatus('MPOST', post);
        for (const chunk of mediaChunks(form.data, post.o)) {
          await connection.write(chunk, { signal });
        }
        await awaitComplete(connection.session, signal);
      } finally {
        await connection.close();
      }
    }

    const write = await controlSession.request('WRITE', {
      chatId: channelId,
      msgId: messageId,
      msg: options.groupedMessage ?? '',
      type,
      noSeen: false,
      scope: 1,
      extra: JSON.stringify({
        kl: mship.kl,
        mtl: mship.mtl,
        csl: checksums,
        wl: forms.map((form) => form.width ?? 0),
        hl: forms.map((form) => form.height ?? 0),
        cmtl: forms.map(() => ''),
        sl: forms.map((form) => form.data.byteLength),
      }),
    }, requestOptions);
    if (write.chatLog === undefined) {
      throw new AndroidMediaProtocolError('Grouped media WRITE did not include a chatlog');
    }
    return write.chatLog;
  });
}
