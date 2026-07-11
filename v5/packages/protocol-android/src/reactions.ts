import { Long } from 'bson';
import type { LocoId } from './types.js';

/**
 * Message reaction type values, confirmed on KakaoTalk Android 25.8.1 by
 * capturing sequential reaction changes (2026-07-11).
 */
export const AndroidReactionType = {
  Heart: 1,
  Like: 2,
  Check: 3,
  Laugh: 4,
  Surprise: 5,
  Sad: 6,
} as const;
export type AndroidReactionType = (typeof AndroidReactionType)[keyof typeof AndroidReactionType];

/** REACT request (general chat reaction). Keyed by logId only; no chatId. */
export interface ReactRequest {
  readonly li: LocoId;
  readonly rt: number;
  readonly adid: string;
}
export interface ReactResponse {
  readonly status?: number;
  readonly errMsg?: string | null;
}

/** CHGLOGMETA meta `type` used for reaction aggregates. */
export const REACTION_META_TYPE = 1;

/** CHGLOGMETA push carrying a reaction-count aggregate for one message. */
export interface ReactionMetaPush {
  readonly logId: LocoId;
  readonly chatId: LocoId;
  readonly type: number;
  readonly content: string;
  readonly extra?: string;
  readonly revision?: LocoId;
  readonly linkId?: number;
}

export interface ParsedReaction {
  readonly logId: LocoId;
  readonly chatId: LocoId;
  /** reaction type -> count, e.g. { 3: 1 } for one Check. */
  readonly counts: Readonly<Record<number, number>>;
  /** the current user's own reaction type, if present in `extra`. */
  readonly myReaction?: number;
  readonly actorId?: LocoId;
}

/**
 * Parses a CHGLOGMETA reaction aggregate. Returns undefined for non-reaction
 * meta (`type !== REACTION_META_TYPE`) or unparseable content.
 */
export function parseReactionMeta(push: ReactionMetaPush): ParsedReaction | undefined {
  if (push.type !== REACTION_META_TYPE) return undefined;
  let counts: Record<number, number>;
  try {
    const map = JSON.parse(push.content) as Record<string, number>;
    counts = {};
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'number') counts[Number(key)] = value;
    }
  } catch {
    return undefined;
  }

  let myReaction: number | undefined;
  let actorId: LocoId | undefined;
  if (typeof push.extra === 'string') {
    const my = /"my"\s*:\s*(\d+)/.exec(push.extra) ?? /"type"\s*:\s*(\d+)/.exec(push.extra);
    if (my?.[1] !== undefined) myReaction = Number(my[1]);
    // userId can exceed 2^53; extract as string to avoid JSON precision loss.
    const uid = /"userId"\s*:\s*(\d+)/.exec(push.extra);
    if (uid?.[1] !== undefined) actorId = Long.fromString(uid[1]);
  }

  return {
    logId: push.logId,
    chatId: push.chatId,
    counts,
    ...(myReaction === undefined ? {} : { myReaction }),
    ...(actorId === undefined ? {} : { actorId }),
  };
}
