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
| `BOT_TEST_IMAGE_JSON` | Optional single-image override: `{"path":"...","width":1200,"height":900}` |
| `BOT_TEST_IMAGES_JSON` | Optional grouped-image override containing at least two image fixtures |
| `BOT_TEST_EMOTICON_JSON` | Optional captured emoticon override (`path`, `name`, `type`, `chatType`) |
| `BOT_TEST_MINI_EMOTICON_JSON` | Optional captured mini-emoticon override |
| `BOT_TEST_MEDIA_TIMEOUT_MS` | Overall image upload timeout; default 120000 |
| `BOT_TEST_MAX_FILE_BYTES` | Maximum bytes read for one test image; default 20 MiB |

Instead of account/password login, `KAKAO_USER_ID`, `KAKAO_DEVICE_UUID`, and `KAKAO_ACCESS_TOKEN` can provide an issued credential. Password login is preferable when the registered device remains valid because it obtains a fresh access token.

Never expose the dashboard directly without HTTPS and `BOT_ADMIN_TOKEN`. The dashboard keeps the token in browser `sessionStorage` and sends it as an `Authorization: Bearer` header; it is not placed in a URL or cookie.

### Feature-test commands

The commands are `!테스트 도움말`, `!테스트 이미지`, `!테스트 이미지묶음`,
`!테스트 이모티콘`, `!테스트 미니이모티콘`, `!테스트 멘션`,
`!테스트 외치기`, and `!테스트 전체`. They intentionally have no user-id check
because this bot is operated in a private room; do not enable it in an untrusted room.

No fixture variables are required. The bot generates three checkerboard PNGs in
memory and uses the emoticon/mini-emoticon attachment values captured from Android
25.8.1. The following values are optional overrides for a different fixture:

Example `.env.local` values (use captured identifiers belonging to your own test):

```dotenv
BOT_TEST_IMAGE_JSON={"path":"test-assets/photo.jpg","width":1200,"height":900,"ext":"jpg"}
BOT_TEST_IMAGES_JSON=[{"path":"test-assets/a.jpg","width":1200,"height":900,"ext":"jpg"},{"path":"test-assets/b.jpg","width":1200,"height":900,"ext":"jpg"}]
BOT_TEST_EMOTICON_JSON={"path":"captured/path.webp","name":"(test)","type":"xcon","chatType":20}
BOT_TEST_MINI_EMOTICON_JSON={"text":"mini","emojis":{"total_item":1,"total_len":1,"items":[{"id":"captured-id","len":1,"at":[0]}]}}
```

Relative image paths resolve from the `v5` directory. On Railway, place persistent
fixtures on the mounted volume and use absolute paths such as `/app/data/test.jpg`.
`!테스트 전체` prepares all image fixtures before sending the first item. Mention
tests target the command author and use the received nickname;
`BOT_TEST_MENTION_NICKNAME` is available only as a fallback.

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
