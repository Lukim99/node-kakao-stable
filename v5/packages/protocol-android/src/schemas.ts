import { Long } from 'bson';
import type { LocoCommandSchemas, LocoPushSchemas } from '@lukim9-kakao/protocol-core';
import type { AndroidReferenceCommands, AndroidReferencePushes } from './commands.js';
import type {
  ChannelDataDocument,
  ChatlogDocument,
  LChatListResponse,
  LoginListResponse,
  NetworkConfigurationDocument,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEmptyRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isLong(value: unknown): value is Long {
  return Long.isLong(value);
}

// BSON encodes integers as int32 (JS number) or int64 (Long) by magnitude, so
// id-like fields legitimately arrive as either. Confirmed on Android 25.8.1.
function isLongOrNumber(value: unknown): value is Long | number {
  return Long.isLong(value) || isNumber(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

function isLongArray(value: unknown): value is Long[] {
  return Array.isArray(value) && value.every(isLong);
}

function isLongOrNumberArray(value: unknown): value is (Long | number)[] {
  return Array.isArray(value) && value.every(isLongOrNumber);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isNullableOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isString(value);
}

function isMediaPostResponse(value: unknown): value is AndroidReferenceCommands['POST']['response'] {
  return isRecord(value) && isNumber(value.status) && isNumber(value.o);
}

function isNetworkConfiguration(value: unknown): value is NetworkConfigurationDocument {
  if (!isRecord(value)) return false;
  return isNumber(value.bgKeepItv) && isNumber(value.bgReconnItv) &&
    isNumber(value.bgPingItv) && isNumber(value.fgPingItv) &&
    isNumber(value.reqTimeout) && isNumber(value.encType) &&
    isNumber(value.connTimeout) && isNumber(value.recvHeaderTimeout) &&
    isNumber(value.inSegTimeout) && isNumber(value.outSegTimeout) &&
    isNumber(value.blockSendBufSize) && isNumberArray(value.ports);
}

export function isChatlogDocument(value: unknown): value is ChatlogDocument {
  if (!isRecord(value)) return false;
  return isLongOrNumber(value.logId) && isLongOrNumber(value.chatId) && isNumber(value.type) &&
    isLongOrNumber(value.authorId) && (value.message === undefined || isString(value.message)) &&
    isNumber(value.sendAt) && isString(value.attachment) &&
    (isNumber(value.msgId) || isLong(value.msgId)) && isLongOrNumber(value.prevId);
}

function isChannelData(value: unknown): value is ChannelDataDocument {
  if (!isRecord(value)) return false;
  return isLongOrNumber(value.c) && isString(value.t) && isNumber(value.a) &&
    isNumber(value.n) && isLongOrNumber(value.s) && isLongOrNumber(value.ll) &&
    isNumber(value.o) && typeof value.p === 'boolean' &&
    (value.l === undefined || isChatlogDocument(value.l));
}

function isLChatListResponse(value: unknown): value is LChatListResponse {
  if (!isRecord(value)) return false;
  return Array.isArray(value.chatDatas) && value.chatDatas.every(isChannelData) &&
    isLongOrNumber(value.lastChatId) && isLongOrNumber(value.lastTokenId) &&
    isNumber(value.mcmRevision) && isLongOrNumberArray(value.delChatIds) &&
    Array.isArray(value.kc) && isLongOrNumber(value.ltk) && isNumber(value.lbk) &&
    typeof value.eof === 'boolean';
}

function isLoginListResponse(value: unknown): value is LoginListResponse {
  if (!isRecord(value) || !isLChatListResponse(value)) return false;
  const record: Record<string, unknown> = value;
  return isLongOrNumber(record.userId) && isNumber(record.revision) &&
    isString(record.revisionInfo) && isLongOrNumber(record.minLogId) && isNumber(record.sb);
}

export const androidReferenceCommandSchemas = {
  PING: {
    validateRequest: isEmptyRecord,
    validateResponse: isEmptyRecord,
  },
  GETCONF: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['GETCONF']['request'] =>
      isRecord(value) && value.os === 'android' && isString(value.MCCMNC) && isString(value.model),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['GETCONF']['response'] =>
      isRecord(value) && isNumber(value.revision) &&
      isNetworkConfiguration(value['3g']) && isNetworkConfiguration(value.wifi) &&
      isRecord(value.ticket) && isRecord(value.profile),
  },
  CHECKIN: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['CHECKIN']['request'] =>
      isRecord(value) && isLongOrNumber(value.userId) && value.os === 'android' &&
      isNumber(value.ntype) && isString(value.appVer) && isString(value.lang) &&
      (value.MCCMNC === undefined || isString(value.MCCMNC)) &&
      (value.useSub === undefined || typeof value.useSub === 'boolean'),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['CHECKIN']['response'] =>
      isRecord(value) && isString(value.host) && isString(value.host6) && isNumber(value.port) &&
      isNumber(value.cacheExpire) && isString(value.cshost) && isNumber(value.csport) &&
      isString(value.cshost6) && isString(value.vsshost) && isNumber(value.vssport) &&
      isString(value.vsshost6) && isString(value.MCCMNC),
  },
  LOGINLIST: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['LOGINLIST']['request'] =>
      isRecord(value) && isString(value.appVer) && isString(value.prtVer) &&
      value.os === 'android' && isString(value.lang) && isString(value.duuid) &&
      isNumber(value.ntype) && isString(value.MCCMNC) && isNumber(value.revision) &&
      isLongOrNumberArray(value.chatIds) && isLongOrNumberArray(value.maxIds) &&
      isLongOrNumber(value.lastTokenId) &&
      isNumber(value.lbk) && typeof value.bg === 'boolean' && isString(value.oauthToken),
    validateResponse: isLoginListResponse,
  },
  LCHATLIST: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['LCHATLIST']['request'] =>
      isRecord(value) && isLongOrNumber(value.lastTokenId) && isLongOrNumber(value.lastChatId),
    validateResponse: isLChatListResponse,
  },
  WRITE: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['WRITE']['request'] =>
      isRecord(value) && isLongOrNumber(value.chatId) && isNumber(value.msgId) &&
      isNumber(value.type) && typeof value.noSeen === 'boolean' &&
      (value.msg === undefined || isString(value.msg)) &&
      (value.extra === undefined || isString(value.extra)),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['WRITE']['response'] =>
      isRecord(value) && isNumber(value.msgId) && isLongOrNumber(value.chatId) &&
      isLongOrNumber(value.logId) && isLongOrNumber(value.prevId) && isNumber(value.sendAt) &&
      (value.chatLog === undefined || isChatlogDocument(value.chatLog)),
  },
  REACT: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['REACT']['request'] =>
      isRecord(value) && isLongOrNumber(value.li) && isNumber(value.rt) && isString(value.adid),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['REACT']['response'] =>
      isRecord(value) &&
      (value.status === undefined || isNumber(value.status)) &&
      (value.errMsg === undefined || value.errMsg === null || isString(value.errMsg)),
  },
  KICKMEM: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['KICKMEM']['request'] =>
      isRecord(value) && isNumber(value.li) && isLongOrNumber(value.c) &&
      isLongOrNumber(value.mid) && typeof value.r === 'boolean',
  },
  KLDELITEM: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['KLDELITEM']['request'] =>
      isRecord(value) && isNumber(value.li) && isLongOrNumber(value.c) && isLongOrNumber(value.kid),
  },
  REWRITES: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['REWRITES']['request'] =>
      isRecord(value) && isNumber(value.linkId) && isLongOrNumber(value.chatId) && isString(value.chatLogInfos),
  },
  SETMEMTYPE: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['SETMEMTYPE']['request'] =>
      isRecord(value) && isLongOrNumber(value.c) && isNumber(value.li) &&
      isLongOrNumberArray(value.mids) && isNumberArray(value.mts),
  },
  CREATELINK: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['CREATELINK']['request'] =>
      isRecord(value) && isNumber(value.ri) && isString(value.ln) && isNumber(value.ptp) &&
      isString(value.nn) && isNumber(value.lt) && typeof value.sc === 'boolean' &&
      isNumber(value.categoryId) && isString(value.adid),
  },
  REACTCNT: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['REACTCNT']['request'] =>
      isRecord(value) && isNumber(value.li),
  },
  SHIP: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['SHIP']['request'] =>
      isRecord(value) && isLongOrNumber(value.c) && isNumber(value.s) && isNumber(value.t) &&
      isString(value.cs) && isOptionalString(value.e) && isOptionalString(value.ex),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['SHIP']['response'] =>
      isRecord(value) && isString(value.k) && isString(value.vh) && isString(value.vh6) &&
      isNumber(value.p) && isBoolean(value.rd) && (value.status === undefined || isNumber(value.status)),
  },
  MSHIP: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['MSHIP']['request'] =>
      isRecord(value) && isLongOrNumber(value.c) && isNumberArray(value.sl) &&
      isNumber(value.t) && isStringArray(value.csl) &&
      (value.el === undefined || isStringArray(value.el)),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['MSHIP']['response'] =>
      isRecord(value) && isStringArray(value.kl) && isStringArray(value.mtl) &&
      isStringArray(value.vhl) && isStringArray(value.vh6l) && isNumberArray(value.pl) &&
      isBoolean(value.rd) && (value.status === undefined || isNumber(value.status)),
  },
  POST: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['POST']['request'] =>
      isRecord(value) && isString(value.k) && isNumber(value.t) && isNumber(value.s) &&
      isLongOrNumber(value.u) && isLongOrNumber(value.c) && isLongOrNumber(value.mid) &&
      (value.w === undefined || isNumber(value.w)) && (value.h === undefined || isNumber(value.h)) &&
      isString(value.mm) && isNumber(value.nt) && value.os === 'android' && isString(value.av) &&
      isOptionalString(value.ex) && isNullableOptionalString(value.f) &&
      isNullableOptionalString(value.sp) && (value.dt === undefined || isNumber(value.dt)) &&
      (value.scp === undefined || isNumber(value.scp)) &&
      isBoolean(value.ns),
    validateResponse: isMediaPostResponse,
  },
  MPOST: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['MPOST']['request'] =>
      isRecord(value) && isString(value.k) && isNumber(value.t) && isNumber(value.s) &&
      isLongOrNumber(value.u) && isString(value.mm) && isNumber(value.nt) &&
      value.os === 'android' && isString(value.av) && isNumber(value.dt) && isNumber(value.scp),
    validateResponse: isMediaPostResponse,
  },
  MINI: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['MINI']['request'] =>
      isRecord(value) && isString(value.k) && isLongOrNumber(value.u) && isNumber(value.o) &&
      isString(value.mm) && isNumber(value.nt) && value.os === 'android' && isString(value.av) &&
      isLongOrNumber(value.c),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['MINI']['response'] =>
      isRecord(value) && isNumber(value.status) && isNumber(value.s),
  },
  DOWN: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['DOWN']['request'] =>
      isRecord(value) && isString(value.k) && isLongOrNumber(value.u) && isNumber(value.o) &&
      isString(value.mm) && isNumber(value.nt) && value.os === 'android' && isString(value.av) &&
      isLongOrNumber(value.c) && isBoolean(value.rt),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['DOWN']['response'] =>
      isRecord(value) && isNumber(value.status) && isNumber(value.s),
  },
  GETTRAILER: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['GETTRAILER']['request'] =>
      isRecord(value) && isString(value.k) && isNumber(value.t),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['GETTRAILER']['response'] =>
      isRecord(value) && isString(value.vh) && isString(value.vh6) && isNumber(value.p) &&
      isBoolean(value.rd) && (value.status === undefined || isNumber(value.status)),
  },
  MCHKTOKENS: {
    validateRequest: (value: unknown): value is AndroidReferenceCommands['MCHKTOKENS']['request'] =>
      isRecord(value) && isNumberArray(value.ts) && isStringArray(value.ks),
    validateResponse: (value: unknown): value is AndroidReferenceCommands['MCHKTOKENS']['response'] =>
      isRecord(value) && Array.isArray(value.eks) && (value.status === undefined || isNumber(value.status)),
  },
} satisfies LocoCommandSchemas<AndroidReferenceCommands>;

export const androidReferencePushSchemas = {
  MSG: {
    validate: (value: unknown): value is AndroidReferencePushes['MSG'] =>
      isRecord(value) && isLongOrNumber(value.chatId) && isLongOrNumber(value.logId) &&
      isChatlogDocument(value.chatLog) && typeof value.noSeen === 'boolean',
  },
  DECUNREAD: {
    validate: (value: unknown): value is AndroidReferencePushes['DECUNREAD'] =>
      isRecord(value) && isLongOrNumber(value.chatId) && isLongOrNumber(value.userId) &&
      isLongOrNumber(value.watermark),
  },
  CHGMETA: {
    validate: (value: unknown): value is AndroidReferencePushes['CHGMETA'] =>
      isRecord(value) && isLongOrNumber(value.chatId) && isRecord(value.meta) &&
      isNumber(value.meta.type) && isNumber(value.meta.revision) &&
      isLongOrNumber(value.meta.authorId) && isString(value.meta.content) &&
      isNumber(value.meta.updatedAt),
  },
  LEFT: {
    validate: (value: unknown): value is AndroidReferencePushes['LEFT'] =>
      isRecord(value) && isLongOrNumber(value.chatId) && isLongOrNumber(value.lastTokenId),
  },
  KICKOUT: {
    validate: (value: unknown): value is AndroidReferencePushes['KICKOUT'] =>
      isRecord(value) && isNumber(value.reason),
  },
  COMPLETE: {
    validate: (value: unknown): value is AndroidReferencePushes['COMPLETE'] =>
      isRecord(value) && isNumber(value.status) &&
      (value.chatLog === undefined || isChatlogDocument(value.chatLog)) &&
      (value.li === undefined || isNumber(value.li)) &&
      (value.noSeen === undefined || isBoolean(value.noSeen)),
  },
} satisfies LocoPushSchemas<AndroidReferencePushes>;
