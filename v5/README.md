# node-kakao v5 workspace

This directory is an isolated, experimental rewrite of the packet and client foundations used by node-kakao v4.
The legacy source tree remains unchanged.

## Scope of this first milestone

- npm workspaces based monorepo
- strict TypeScript and Node.js 22+
- dependency-light LOCO frame codec
- incremental decoder for fragmented or coalesced TCP chunks
- BSON payload codec
- request-id packet assembler
- protocol profile, transport, client-state, and testkit package skeletons
- unit tests that do not contact Kakao servers

This milestone does **not** claim compatibility with current KakaoTalk servers. It deliberately contains no account credentials,
private keys, version spoofing logic, or production connection code.

## Commands

```bash
cd v5
npm install
npm run check
npm run build
```

## Package layout

- `@node-kakao/protocol-core`: frame format, streaming decoder, BSON payload codec, packet assembler
- `@node-kakao/protocol-profiles`: explicit versioned protocol configuration model
- `@node-kakao/transport-node`: Node transport contracts and frame reader
- `@node-kakao/client-core`: explicit client connection state machine
- `@node-kakao/testkit`: deterministic byte fragmentation helpers
