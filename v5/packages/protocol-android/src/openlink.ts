import type { Long } from 'bson';
import type { ChatlogDocument, LocoId } from './types.js';

/**
 * Open-chat member permission values. Confirmed on Android 25.8.1: SYNCMEMT
 * pushes carried mts `4` (promote to manager) and `2` (demote to member).
 */
export const OpenChannelUserPerm = {
  Owner: 1,
  None: 2,
  Manager: 4,
  Bot: 8,
} as const;
export type OpenChannelUserPerm = (typeof OpenChannelUserPerm)[keyof typeof OpenChannelUserPerm];

/** KICKMEM: kick a member from an open chat. `r` reports the user. */
export interface KickMemberRequest {
  readonly li: number;
  readonly c: LocoId;
  readonly mid: LocoId;
  readonly r: boolean;
}
export interface KickMemberResponse {
  readonly chatId?: LocoId;
  readonly kid?: LocoId;
  readonly chatLog?: ChatlogDocument;
  readonly status?: number;
}

/** KLDELITEM: remove a member from the kick list (un-kick). */
export interface UnkickMemberRequest {
  readonly li: number;
  readonly c: LocoId;
  readonly kid: LocoId;
}
export interface UnkickMemberResponse {
  readonly status?: number;
  readonly errMsg?: string | null;
}

/** REWRITES: hide (blind) one or more messages as host. */
export interface RewritesRequest {
  readonly linkId: number;
  readonly chatId: LocoId;
  /** JSON array string: `[{"logId":<int>,"type":<int>}]`. Use serializeChatLogInfos. */
  readonly chatLogInfos: string;
}
export interface RewritesResponse {
  readonly chatLog?: ChatlogDocument;
  readonly status?: number;
}

/**
 * CREATELINK: create an open chat / community chat room. Field values observed
 * on Android 25.8.1: ptp=2, lt=8 (community chat room), aptp=true.
 */
export interface CreateOpenLinkRequest {
  /** client request id (timestamp-based). */
  readonly ri: number;
  readonly ln: string;
  readonly ptp: number;
  readonly nn: string;
  readonly pp: string;
  readonly lip: string;
  readonly lt: number;
  readonly aptp: boolean;
  readonly desc: string;
  readonly sc: boolean;
  readonly categoryId: number;
  readonly adid: string;
}
export interface CreateOpenLinkResponse {
  readonly ol?: Readonly<Record<string, unknown>>;
  readonly chatRoom?: Readonly<Record<string, unknown>>;
  readonly category?: Readonly<Record<string, unknown>>;
  readonly status?: number;
}

/** REACTCNT: query a message/profile reaction count. */
export interface ReactionCountRequest {
  readonly li: number;
}
export interface ReactionCountResponse {
  readonly li?: number;
  readonly rt?: number;
  readonly rc?: number;
  readonly status?: number;
  readonly errMsg?: string | null;
}

/**
 * SETMEMTYPE: set member permissions (promote/demote, host handover). Request
 * shape confirmed on Android 25.8.1.
 */
export interface SetMemberTypeRequest {
  readonly c: LocoId;
  readonly li: number;
  readonly mids: readonly LocoId[];
  readonly mts: readonly number[];
}
export interface SetMemberTypeResponse {
  readonly status?: number;
}

/** SYNCMEMT: a member's permission changed. */
export interface SyncMemberTypePush {
  readonly c: LocoId;
  readonly li: number;
  readonly mids: readonly number[];
  readonly mts: readonly number[];
  readonly chatLog?: ChatlogDocument;
  readonly status?: number;
}

/**
 * Builds a REWRITES `chatLogInfos` string. logId is emitted as a bare JSON
 * integer literal (it exceeds 2^53, so JSON.stringify of a number would lose
 * precision) to match the wire format.
 */
export function serializeChatLogInfos(
  logs: readonly { readonly logId: Long; readonly type: number }[],
): string {
  return `[${logs.map((log) => `{"logId":${log.logId.toString()},"type":${log.type}}`).join(',')}]`;
}
