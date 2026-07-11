# node-kakao v5 workspace

This directory is an isolated, experimental rewrite of node-kakao's protocol and client foundations. The legacy v4 source tree is not changed by this workspace.

## Current scope

This milestone provides:

- strict command-linked request and response types with optional runtime validators
- the 22-byte LOCO frame codec and an incremental, bounded decoder
- BSON as one replaceable `PayloadCodec` implementation
- collision-free, releasable request IDs
- a single-reader `LocoSession` that dispatches responses and queues server pushes
- typed timeout, abort, remote-status, transport, incomplete-frame, and queue-overflow errors
- a bounded push queue that closes the session on overflow
- deterministic in-memory duplex transports and a deliberately small fake LOCO server
- tests for fragmentation, coalescing, reordered responses, push interleaving, failures, and cleanup
- an Android KakaoTalk app `11.0.0` / `SM-T870` reference profile and typed command subset
- account-free Android booking, checkin, login-pagination, and channel request builders
- localhost TCP, TLS, and caller-keyed RSA/AES secure transports
- protocol-independent message-reaction and Community state stores
- an Android password-auth client and the observed passcode device-approval flow
- sanitized Android 25.8.1 command shapes derived from the local Frida capture

The reference `11.0.0` value is the KakaoTalk Android application version, not Android OS 11. Its copied configuration separately reports `osVersion: 7.1.2` and model `SM-T870`.

The Android 25.8.1 capture is newer evidence than the 11.0.0 reference, but it is not a claim that 25.8.1 is the latest KakaoTalk release or that every current server feature is supported. On 2026-07-11, an explicitly enabled live test completed password authentication, booking, secure `CHECKIN`, and `LOGINLIST`. This repository still contains no embedded account credential, private key, app-integrity bypass, or version-spoofing logic. See [Android protocol status](./ANDROID_PROTOCOL_STATUS.md) for evidence levels and remaining gaps.

## Install and verify

The normal build and test commands use no Kakao account, token, password, device UUID, or verification code. Session tests run through memory transports or localhost only.

```bash
cd v5
npm install
npm run check
npm run build
```

`npm run check` builds and type-checks every workspace, then runs all package test suites.

## Android reference usage

```ts
import { Long } from 'bson';
import {
  AndroidChannelSession,
  androidKakaoTalk11SmT870ReferenceConfiguration,
  createAndroidReferenceSession,
  createCheckinRequest,
} from '@node-kakao/client-android';
import { createMemoryTransportPair } from '@node-kakao/testkit';

const { client } = createMemoryTransportPair();
const session = createAndroidReferenceSession(client);
const channel = new AndroidChannelSession(session, Long.fromNumber(123));

const checkinShape = createCheckinRequest(
  androidKakaoTalk11SmT870ReferenceConfiguration,
  Long.fromNumber(456),
);

void checkinShape;
void channel; // Channel calls require a matching local fake server in tests.
await session.close();
```

The request builders accept credentials only as caller-provided values. Unit tests never contact Kakao servers.

The Android capture confirms `SYNCACTION` and an open-link `ACTION` shape, but the semantics of reaction change/removal and all reaction type values remain incomplete. Community/open-link schemas are kept evidence-labelled; uncaptured fields are not guessed.

## Optional live Android validation

Live scripts are deliberately excluded from `npm run check`. They require the explicit `--allow-live` guard embedded in the workspace scripts and are intended only for an account the operator is authorized to use. Put `KAKAO_ID` and `KAKAO_PW` in the repository-root `.env.local`; never commit that file.

```bash
cd v5
npm run live:auth
npm run live:login:capture
```

For a new device, the server can return `-100` (`NEED_DEVICE_AUTH`). Generate the official eight-digit sub-device passcode, approve it in the main KakaoTalk device, then poll registration:

```bash
npm run live:auth:generate-passcode
npm run live:auth:poll-register
```

`npm run live:auth:complete` combines those operations and follows the server-provided polling interval. The passcode and issued credentials are written only to git-ignored `v5/.live-auth-passcode` and `v5/.live-auth-credential.json`; scripts log response shapes and status codes, not secret values. The main-device approval is a manual security step and is not automated.

The current live script uses sanitized Frida capture metadata for the observed 25.8.1 profile and a caller-supplied public PEM from the local reference checkout. It does not discover or assert a latest app version.

The corresponding public API is `AndroidAuthClient`:

```ts
const result = await authClient.login({ id, password });

if (!result.success && result.status === ANDROID_NEED_DEVICE_AUTH_STATUS) {
  const challenge = await authClient.generatePasscode(
    { id, password },
    { deviceOsApiLevel: '35' },
  );
  // Show challenge.passcode locally and approve it through the official main-device UI.
}
```

Callers provide the `AndroidXvcProvider`; v5 does not embed a newly extracted integrity secret or bypass implementation.

## Managed chatbot

The v5 workspace now includes a legacy-style live bot with member history, `!ping`, open-chat reply hiding through `!가리기`, automatic reconnect, graceful shutdown, and a token-protected web On/Off dashboard.

```bash
cd v5
npm run bot:connect-check
npm run bot:start
```

The connect check performs a real login without sending chat responses. See [BOT_HOSTING.md](./BOT_HOSTING.md) for dashboard security, environment variables, persistent storage, Docker, and 24-hour Railway/Render deployment guidance. Serverless functions are not used for the long-lived LOCO connection.

The private managed bot exposes feature checks through:
`!테스트 이미지`, `!테스트 이미지묶음`, `!테스트 이모티콘`,
`!테스트 미니이모티콘`, `!테스트 멘션`, `!테스트 외치기`, and
`!테스트 전체`. No administrator id is required. Images are deterministic PNGs
generated in memory, while the default emoticon and mini-emoticon values come from
the local Android 25.8.1 capture. Environment JSON can override each fixture.

## Typed session example

```ts
import {
  BsonPayloadCodec,
  type LocoRequestUnion,
} from '@node-kakao/protocol-core';
import { LocoSession } from '@node-kakao/transport-node';
import { FakeLocoServer, createMemoryTransportPair } from '@node-kakao/testkit';

interface Commands {
  PING: {
    request: Record<string, never>;
    response: Record<string, never>;
  };
  ECHO: {
    request: { value: string };
    response: { value: string };
  };
}

const { client, server } = createMemoryTransportPair();
const session = new LocoSession<Commands>(
  client,
  new BsonPayloadCodec<LocoRequestUnion<Commands>, unknown>(),
);
const fakeServer = new FakeLocoServer(server, {
  codec: new BsonPayloadCodec<object, unknown>(),
  handlers: {
    ECHO: (request) => {
      if (typeof request !== 'object' || request === null || !('value' in request) ||
        typeof request.value !== 'string') throw new Error('Invalid local ECHO request');
      return { data: { value: request.value } };
    },
  },
});

const response = await session.request('ECHO', { value: 'local test' }, {
  timeoutMs: 5_000,
});
console.log(response.value);

await session.close();
await fakeServer.close();
```

The method is a key of `Commands`; its request and response types are inferred together. Unknown methods and mismatched request shapes fail TypeScript compilation. A custom `PayloadCodec` can replace BSON.

## Pushes, timeout, and cancellation

```ts
const controller = new AbortController();

const pending = session.request('ECHO', { value: 'cancel-safe' }, {
  timeoutMs: 5_000,
  signal: controller.signal,
});

for await (const packet of session.pushes()) {
  console.log(packet.header.method);
}

controller.abort();
await pending;
```

Only the session's internal reader consumes the transport. Packets whose IDs match pending requests resolve those requests; other packets enter the bounded push queue. The default queue limit is 100. Overflow raises `LocoPushQueueOverflowError` and closes the session instead of silently dropping messages.

`close()` is idempotent, rejects pending requests, releases their IDs, removes timers and abort listeners, finishes the push iterator, and closes the transport once. `await using` is also available on the supported Node.js 22+ and TypeScript configuration.

## Test-only transport and server

`createMemoryTransportPair()` returns connected client/server `ByteTransport` endpoints. Tests can configure fragmentation and write delay, coalesce frames in one write, inject read/write failures, and close with incomplete input. `FakeLocoServer` can dispatch local handlers, reorder responses through handler scheduling, insert pushes, and send coalesced packets. Neither utility opens a real network connection or attempts to reproduce every production server behavior.

## Packages

- `@lukim9-kakao/protocol-core`: command types, frame/payload codecs, packet assembler, request ID allocator
- `@lukim9-kakao/protocol-android`: Android reference schemas and explicitly labelled captured additions
- `@lukim9-kakao/transport-node`: transport contract, frame reader, session, bounded async queue, typed session errors
- `@lukim9-kakao/testkit`: memory transport, byte helpers, and fake test server
- `@lukim9-kakao/protocol-profiles`: explicit historical/reference profiles with compatibility labels
- `@lukim9-kakao/client-core`: state machine, typed push router, reaction and Community reducers
- `@lukim9-kakao/client-android`: auth/device approval, bootstrap, channel API, media upload, and `AndroidTalkClient`

## High-level client

`AndroidTalkClient` ties booking, checkin, login, the persistent session, and push
routing into an event-driven client for ordinary Node usage. It needs an already
issued credential (obtain one with `AndroidAuthClient`) and a caller-supplied LOCO
public key.

```ts
import { Long } from 'bson';
import {
  AndroidTalkClient,
  AndroidReactionType,
  androidKakaoTalk11SmT870ReferenceConfiguration as configuration,
} from '@lukim9-kakao/client-android';

const client = new AndroidTalkClient(configuration, {
  locoPublicKey: LOCO_PEM,                     // caller-supplied RSA public key
  advertisementId: identity.advertisementId,   // only needed to send reactions
});

client.on('error', (error) => console.error(error));
client.on('message', (message) => console.log('message in', message.chatId.toString()));
client.on('reaction', (reaction) => console.log('reaction counts', reaction.counts));
client.on('voiceRoom', ({ attachment }) => console.log('voice-room event', attachment.type));

const login = await client.connect(credential); // credential from AndroidAuthClient
console.log('channels:', login.channels.length);

const channel = client.channel(Long.fromString(channelId));
await channel.sendText('hello');
await channel.sendShout('important message');
await client.react(Long.fromString(logId), AndroidReactionType.Heart);

await client.close();
```

### Captured chat additions and media

`sendEmoticon`, `sendTextWithEmojis`, and `sendShout` build the Android 25.8.1
`WRITE` attachment shapes. Received `MSG` type 52 packets are parsed and also emitted
as `voiceRoom` events (`vr_invite` / `vr_bye`). Starting or joining the voice media
session is not implemented because that separate negotiation was not present in the
LOCO capture. Shop-search payloads were also not present, so no speculative type-23
sender is exposed.

Photo upload uses the captured Android `SHIP`/`POST` fields. Audio and other media
types retain the legacy POST fields and must not be described as capture-verified.
Every media operation has an overall timeout and supports cancellation:

```ts
const controller = new AbortController();

const photo = await client.sendMedia(
  Long.fromString(channelId),
  2,
  { data: photoBytes, name: 'photo.jpg', ext: 'jpg', width: 1200, height: 900 },
  { timeoutMs: 120_000, signal: controller.signal },
);

const grouped = await client.sendMultiMedia(
  Long.fromString(channelId),
  27,
  photoForms,
  { groupedMessage: 'photos', timeoutMs: 120_000 },
);
```

The test suite injects memory media connections and never uploads these fixtures to
Kakao. Passing real bytes to `AndroidTalkClient` opens ticketed network connections.

Pushes without a dedicated event are still delivered through the `raw` event, never
dropped. Connecting opens real network sockets, so it runs outside the account-free
test suite. Reaction type values (`Heart`=1 … `Sad`=6) are the Android 25.8.1 capture.
