# Android protocol status

Last reviewed: 2026-07-11

## Version terminology

The local `node-kakao-now/node-kakao` reference reports:

- platform: Android
- KakaoTalk application version: `11.0.0`
- reported Android OS value: `7.1.2`
- device model: `SM-T870`
- LOCO protocol value: `1`

`11.0.0` is the KakaoTalk application version, not Android 11. The separate OS value is merely what that client configuration reports.

The emulator capture used KakaoTalk Android `25.8.1`. This is an observed profile, not a claim that 25.8.1 is the latest release. Changing an `appVer` string alone does not establish compatibility.

## Evidence

### Historical local reference

The 11.0.0 distribution supplies the older request flow, public PEM, and command structures used as architectural reference. It is not copied wholesale and is not presented as current protocol truth.

### Android 25.8.1 capture

An authorized Android emulator session was captured through Frida. Raw records remain local and ignored by git. Sanitized analysis retains command names, field names, BSON value kinds, and counts without account identifiers, tokens, device UUIDs, or message content.

Observed LOCO methods include:

- connection/session: `CHECKIN`, `LOGINLIST`, `GETTOKEN`, `SETPK`
- chat: `SYNCMSG`, `MCHATLOGS`, `WRITE`, `MSG`, `DECUNREAD`, `CHGLOGMETA`
- reactions: `ACTION`, `REACT`, `SYNCACTION`
- open-link/community-related: `JOININFO`, `JOINLINK`, `GETMEM`, `MEMBER`, `NEWMEM`, `DELMEM`, `SYNCLINKPF`

Important observed shapes:

- `CHECKIN` request includes user/app/network/language data; empty `MCCMNC` is omitted.
- `LOGINLIST` includes `duuid`, OAuth token, revision/cursors, resume payload, and background state.
- `SYNCACTION` push includes `userId`, `chatId`, `type`, and `logId`.
- captured open-link `ACTION` uses `chatId`, `type`, and `linkId`; it must not be conflated with a generic `logId` reaction request.
- `WRITE` can include `scope` and an optional `threadId`.
- open-link/community responses contain richer room, member, category, permission, and pagination data than the historical types.

Only a small number of reaction/community samples were captured. Reaction change/removal semantics, all reaction type values, and complete Community schemas remain unverified.

### Live server validation

With explicit operator authorization, v5 completed the following against the real service on 2026-07-11:

1. password login returned `NEED_DEVICE_AUTH` (`-100`) for an unapproved device;
2. `passcodeLogin/generate` issued an eight-digit challenge;
3. manual approval through the official KakaoTalk UI was reflected by `passcodeLogin/registerDevice` returning status `0`;
4. `login.json` returned status `0` and issued OAuth credentials;
5. booking TLS, RSA/AES secure transport, `CHECKIN`, and `LOGINLIST` succeeded using those newly issued credentials.

The live scripts print only stages, status codes, counts, and response value kinds. Passcodes and credentials are stored in git-ignored local files. Main-device security approval is never automated.

## Implemented boundary

- strict command-linked request/response types and optional runtime validators
- single-reader session dispatch, bounded push queue, timeout/abort cleanup, and typed errors
- collision-free request ID allocation
- memory and localhost transports/fake server
- Node TCP/TLS and caller-keyed RSA/AES secure transport
- Android booking, checkin, login pagination, channel calls, and push routing
- Android password authentication and one-at-a-time passcode registration operations
- evidence-labelled reaction and Community/open-link state handling

Normal tests remain account-free and never contact external servers. Live scripts are separate, opt-in commands.

## Remaining gaps

- tracking and validating a genuinely latest Android app profile
- reconnect/resume and long-running production session policy
- complete current command schemas and server-specific method/status exceptions
- reaction change/removal semantics and full reaction type mapping
- complete Community/open-link write operations, permissions, pagination, and pushes
- token refresh/expiry lifecycle and secure credential storage suitable for production
- broader live testing across devices, locales, network types, and server responses

No app-integrity bypass, version spoofing, private-key extraction, or security-check bypass belongs in this project.
