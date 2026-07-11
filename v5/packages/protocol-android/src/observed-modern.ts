import { Long } from 'bson';
import type { LocoCommandSchemas, LocoPushSchemas } from '@lukim9-kakao/protocol-core';
import type { AndroidReferenceCommands, AndroidReferencePushes } from './commands.js';

/**
 * Observed in openkakao-cli commit 4f28e2e90f80a305c5bccbb06b57ae77c74a0375.
 * That source targets macOS. Android compatibility is explicitly unverified.
 */
export const observedReactionProtocolEvidence = Object.freeze({
  source: 'https://github.com/JungHoonGhae/openkakao-cli',
  commit: '4f28e2e90f80a305c5bccbb06b57ae77c74a0375',
  observedPlatform: 'macos',
  androidCompatibility: 'unverified',
} as const);

export interface ObservedReactionCommands {
  ACTION: {
    request: {
      readonly chatId: Long;
      readonly logId: Long;
      readonly type: number;
    };
    response: Record<string, never>;
  };
}

export interface ObservedReactionPushes {
  SYNCACTION: {
    readonly chatId: Long;
    readonly userId: Long;
    readonly logId: Long;
    readonly type: number;
  };
}

export type AndroidCandidateCommands = AndroidReferenceCommands & ObservedReactionCommands;
export type AndroidCandidatePushes = AndroidReferencePushes & ObservedReactionPushes;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLong(value: unknown): value is Long {
  return Long.isLong(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}

export const observedReactionCommandSchemas = {
  ACTION: {
    validateRequest: (value: unknown): value is ObservedReactionCommands['ACTION']['request'] =>
      isRecord(value) && isLong(value.chatId) && isLong(value.logId) && isInteger(value.type),
    validateResponse: isEmptyRecord,
  },
} satisfies LocoCommandSchemas<ObservedReactionCommands>;

export const observedReactionPushSchemas = {
  SYNCACTION: {
    validate: (value: unknown): value is ObservedReactionPushes['SYNCACTION'] =>
      isRecord(value) && isLong(value.chatId) && isLong(value.userId) &&
      isLong(value.logId) && isInteger(value.type),
  },
} satisfies LocoPushSchemas<ObservedReactionPushes>;
