import { Long } from 'bson';

/**
 * Feed message subtypes carried in a chatLog `message` JSON, confirmed on
 * KakaoTalk Android 25.8.1 (2026-07 capture of join/leave/kick/hide events).
 */
export const AndroidFeedType = {
  Leave: 2,
  Invite: 4,
  Kicked: 6,
  OpenChatBlind: 26,
} as const;
export type AndroidFeedType = (typeof AndroidFeedType)[keyof typeof AndroidFeedType];

/** SYNCLINKPF push: an open-link member's profile changed. */
export interface SyncLinkProfilePush {
  readonly c: Long | number;
  readonly li: number;
  readonly olu: Readonly<Record<string, unknown>>;
}

export interface AndroidFeed {
  readonly feedType: number;
  /** member ids referenced by the feed (join/leave/kick). */
  readonly memberIds: readonly Long[];
  readonly nicknames: readonly string[];
  /** hidden message log ids (OpenChatBlind / REWRITES result). */
  readonly hiddenLogIds: readonly Long[];
  /** true for host kick (feedType Kicked). */
  readonly kicked: boolean;
}

// ids in feed JSON exceed 2^53, so extract them from the raw string as Long
// instead of JSON.parse (which would round them).
function extractLongs(source: string, key: string): Long[] {
  const out: Long[] = [];
  const pattern = new RegExp(`"${key}"\\s*:\\s*(\\d+)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1] !== undefined) out.push(Long.fromString(match[1]));
  }
  return out;
}

/**
 * Parses a feed chatLog `message` payload. Returns undefined if it is not a
 * recognizable feed JSON. Only structural fields are read; ids stay precise.
 */
export function parseFeed(message: string | undefined): AndroidFeed | undefined {
  if (typeof message !== 'string') return undefined;
  let document: unknown;
  try {
    document = JSON.parse(message);
  } catch {
    return undefined;
  }
  if (typeof document !== 'object' || document === null) return undefined;
  const record = document as { feedType?: unknown; member?: unknown; members?: unknown };
  if (typeof record.feedType !== 'number') return undefined;

  const nicknames: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'object' && value !== null && typeof (value as { nickName?: unknown }).nickName === 'string') {
      nicknames.push((value as { nickName: string }).nickName);
    }
  };
  collect(record.member);
  if (Array.isArray(record.members)) for (const member of record.members) collect(member);

  return {
    feedType: record.feedType,
    memberIds: extractLongs(message, 'userId'),
    nicknames,
    hiddenLogIds: extractLongs(message, 'logId'),
    kicked: record.feedType === AndroidFeedType.Kicked,
  };
}
