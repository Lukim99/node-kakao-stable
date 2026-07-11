# Managed chatbot and 24-hour hosting

## What the new bot does

`scripts/managed-chatbot.mjs` uses the v5 `AndroidTalkClient` and provides:

- first-entry and returning-member greetings;
- a capped per-member join/leave/kick history;
- per-room, per-user spam detection that kicks on either 4 messages in a rolling second or 25 messages in rolling 10 seconds;
- `!ping` -> `pong!`;
- `!가리기` on an open-chat comment to hide its parent message when the account has permission;
- server-provided keepalive plus bounded automatic reconnect;
- graceful `SIGINT`/`SIGTERM` shutdown;
- a token-protected web dashboard for Bot On/Off and status.

The old script's global prototype changes, plaintext credentials, recursive login, and unbounded history files are not carried forward. Kick events are recorded, but the kicker nickname is unavailable in the currently parsed Android feed.

## Local usage

The existing repository-root `.env.local` and `v5/.live-auth-credential.json` can be used locally.

```bash
cd v5
npm run bot:connect-check

# Local dashboard: http://127.0.0.1:3000
set BOT_ADMIN_TOKEN=replace-with-a-long-random-token
npm run bot:start
```

On PowerShell, set an environment variable with `$env:BOT_ADMIN_TOKEN='...'`.

The connect check logs in, confirms the channel list, disables all responses, and closes immediately. `bot:start` keeps the control process alive. Bot Off closes the Kakao session but leaves the dashboard running; Bot On performs a new authenticated connection.

## Environment variables

For remote hosting, configure secrets in the hosting provider rather than uploading `.env.local`.

| Variable | Purpose |
| --- | --- |
| `KAKAO_ID`, `KAKAO_PW` | Authorized account password login |
| `KAKAO_DEVICE_UUID` | Already approved Android sub-device UUID |
| `KAKAO_LOCO_PUBLIC_KEY` | Optional public-key override; the tested Android reference PEM is bundled |
| `KAKAO_LOCO_PUBLIC_KEY_PATH` | Optional path to a replacement public PEM |
| `BOT_ADMIN_TOKEN` | Required remote dashboard bearer token; use 20+ random characters |
| `BOT_CONTROL_HOST` | Set to `0.0.0.0` in a container |
| `PORT` | HTTP port; Railway supplies this automatically |
| `BOT_AUTO_START` | `false` keeps the bot Off when no persisted state exists |
| `BOT_DATA_DIR` | Member history directory |
| `BOT_STATE_PATH` | Persisted On/Off state file |
| `KAKAO_ADVERTISEMENT_ID` | Needed only by features that require an ad id |

Instead of account/password login, `KAKAO_USER_ID`, `KAKAO_DEVICE_UUID`, and `KAKAO_ACCESS_TOKEN` can provide an issued credential. Password login is preferable when the registered device remains valid because it obtains a fresh access token.

Never expose the dashboard directly without HTTPS and `BOT_ADMIN_TOKEN`. The dashboard keeps the token in browser `sessionStorage` and sends it as an `Authorization: Bearer` header; it is not placed in a URL or cookie.

## Railway deployment

Use `v5` as the service root. The included `Dockerfile` and `railway.json` build the workspaces, expose `/healthz`, run one persistent service, enable restart-always, and allow graceful shutdown.

1. Create a Railway persistent service from the repository.
2. Set the root/config directory to `v5`.
3. Add `KAKAO_ID`, `KAKAO_PW`, the approved `KAKAO_DEVICE_UUID`, and `BOT_ADMIN_TOKEN` as secret variables. The public LOCO key does not need a Railway variable.
4. Generate a public domain for the dashboard.
5. Attach a volume at `/app/data` if member history and the Off state must survive redeploys.
6. Keep exactly one replica. Multiple replicas would log the same Kakao account in concurrently and duplicate bot replies.

Set the Railway healthcheck path to `/healthz` if Config as Code is not being used. The endpoint is already implemented and intentionally reports only that the control process can serve HTTP; a temporary Kakao connection failure does not fail the deployment healthcheck.

Railway documents persistent services as always-running containers and supports an `ALWAYS` restart policy. Free/trial plans restrict that policy, so dependable 24-hour operation generally needs a paid plan.

Render is also viable as a continuously running web service with a persistent disk. A Render background worker alone cannot expose the dashboard URL, so use a web service for this combined process.

Vercel Functions are not suitable for the Kakao connection itself: functions have a maximum execution duration and cannot hold a TCP/LOCO session indefinitely. A Vercel page could control a separate worker hosted elsewhere, but it would add an unnecessary second service for this implementation.

## Operational boundary

- Main-device approval remains a manual security action.
- The dashboard On action never performs device-registration bypasses.
- Automatic spam moderation works only in open chats where the bot account has kick permission. It does not report the member, and failed kick attempts are recorded as operational errors.
- Filesystem history contains Kakao member identifiers and nicknames. Protect the volume and backups accordingly.
- Reconnect cannot guarantee zero downtime during provider maintenance or server-side session invalidation.
- Confirm Kakao's applicable terms before operating an automated account continuously.
