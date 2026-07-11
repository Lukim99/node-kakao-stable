import type { Binary, Long } from 'bson';

export type LocoId = Long | number;

export interface AndroidReferenceEvidence {
  readonly platform: 'android';
  readonly kakaoTalkAppVersion: string;
  readonly reportedAndroidOsVersion: string;
  readonly deviceModel: string;
  readonly protocolVersion: string;
  readonly source: 'node-kakao-now/dist/config.js';
}

export const androidKakaoTalk11Reference: AndroidReferenceEvidence = Object.freeze({
  platform: 'android',
  kakaoTalkAppVersion: '11.0.0',
  reportedAndroidOsVersion: '7.1.2',
  deviceModel: 'SM-T870',
  protocolVersion: '1',
  source: 'node-kakao-now/dist/config.js',
});

export interface NetworkConfigurationDocument {
  readonly bgKeepItv: number;
  readonly bgReconnItv: number;
  readonly bgPingItv: number;
  readonly fgPingItv: number;
  readonly reqTimeout: number;
  readonly encType: number;
  readonly connTimeout: number;
  readonly recvHeaderTimeout: number;
  readonly inSegTimeout: number;
  readonly outSegTimeout: number;
  readonly blockSendBufSize: number;
  readonly ports: readonly number[];
}

export interface GetConfRequest {
  readonly MCCMNC: string;
  readonly model: string;
  readonly os: 'android';
}

export interface GetConfResponse {
  readonly revision: number;
  readonly '3g': NetworkConfigurationDocument;
  readonly wifi: NetworkConfigurationDocument;
  readonly ticket: Readonly<{
    ssl: readonly string[];
    v2sl: readonly string[];
    lsl: readonly string[];
    lsl6: readonly string[];
  }>;
  readonly profile: Readonly<{ vBitrate: number; vResolution: number }>;
}

export interface CheckinRequest {
  readonly userId: LocoId;
  readonly os: 'android';
  readonly ntype: number;
  readonly appVer: string;
  readonly lang: string;
  readonly MCCMNC?: string;
  readonly useSub?: boolean;
}

export interface CheckinResponse {
  readonly host: string;
  readonly host6: string;
  readonly port: number;
  readonly cacheExpire: number;
  readonly cshost: string;
  readonly csport: number;
  readonly cshost6: string;
  readonly vsshost: string;
  readonly vssport: number;
  readonly vsshost6: string;
  // Observed on KakaoTalk Android 25.8.1 (2026-07-11 live capture).
  readonly MCCMNC: string;
  readonly status?: number;
}

export interface ChatlogDocument {
  readonly logId: LocoId;
  // chatId/authorId arrive as BSON int64 (Long) or int32 (number) depending on
  // magnitude and sender; the LOGINLIST-embedded chatlog uses number.
  readonly chatId: LocoId;
  readonly type: number;
  readonly authorId: LocoId;
  readonly message?: string;
  readonly sendAt: number;
  readonly attachment: string;
  readonly msgId: number | Long;
  readonly prevId: LocoId;
  readonly supplement?: string;
  readonly referer?: number;
  // Observed in LOGINLIST chatDatas[].l on Android 25.8.1.
  readonly scope?: number;
  readonly revision?: number;
  // Community open-chat comment: parent message logId. scope 3 marks a comment.
  readonly threadId?: LocoId;
}

export interface ChannelDataDocument {
  readonly c: LocoId;
  readonly t: string;
  readonly a: number;
  readonly n: number;
  readonly s: LocoId;
  readonly l?: ChatlogDocument;
  readonly ll: LocoId;
  readonly o: number;
  readonly p: boolean;
  readonly li?: LocoId;
  readonly otk?: number;
  // Observed on Android 25.8.1 LOGINLIST chatDatas element.
  readonly ii?: number;
  readonly i?: readonly number[];
  readonly k?: readonly string[];
  readonly m?: null;
  readonly mmr?: number;
  readonly jn?: number;
  readonly [key: string]: unknown;
}

export interface LoginListRequest {
  readonly appVer: string;
  readonly prtVer: string;
  readonly os: 'android';
  readonly lang: string;
  readonly duuid: string;
  readonly ntype: number;
  readonly MCCMNC: string;
  readonly revision: number;
  readonly chatIds: readonly LocoId[];
  readonly maxIds: readonly LocoId[];
  readonly lastTokenId: LocoId;
  readonly lbk: number;
  readonly rp: Binary | Uint8Array | string | null;
  readonly bg: boolean;
  readonly oauthToken: string;
}

export interface LChatListRequest {
  readonly lastTokenId: LocoId;
  readonly lastChatId: LocoId;
}

export interface LChatListResponse {
  readonly chatDatas: ChannelDataDocument[];
  readonly lastChatId: LocoId;
  readonly lastTokenId: LocoId;
  readonly mcmRevision: number;
  readonly delChatIds: LocoId[];
  readonly kc: unknown[];
  readonly ltk: LocoId;
  readonly lbk: number;
  readonly eof: boolean;
}

export interface LoginListResponse extends LChatListResponse {
  readonly userId: LocoId;
  readonly revision: number;
  readonly revisionInfo: string;
  readonly minLogId: LocoId;
  readonly sb: number;
  // Observed on Android 25.8.1 (2026-07-11 live capture).
  readonly rp?: unknown;
  readonly pkToken?: number;
  readonly pkUpdate?: boolean;
  readonly status?: number;
}

export interface WriteRequest {
  readonly chatId: Long;
  readonly msgId: number;
  readonly type: number;
  readonly noSeen: boolean;
  readonly msg?: string;
  readonly extra?: string;
}

export interface WriteResponse {
  readonly msgId: number;
  readonly chatId: LocoId;
  readonly logId: LocoId;
  readonly prevId: LocoId;
  readonly sendAt: number;
  readonly chatLog?: ChatlogDocument;
}

export interface MessagePush {
  readonly chatId: LocoId;
  readonly li?: LocoId;
  readonly logId: LocoId;
  readonly chatLog: ChatlogDocument;
  readonly noSeen: boolean;
  readonly authorNickname?: string;
  readonly notiRead?: boolean;
}

export interface ReadWatermarkPush {
  readonly chatId: LocoId;
  readonly userId: LocoId;
  readonly watermark: LocoId;
}

export interface ChannelMetaDocument {
  readonly type: number;
  readonly revision: number;
  readonly authorId: LocoId;
  readonly content: string;
  readonly updatedAt: number;
}

export interface ChannelMetaPush {
  readonly chatId: LocoId;
  readonly meta: ChannelMetaDocument;
}

export interface ChannelLeftPush {
  readonly chatId: LocoId;
  readonly lastTokenId: LocoId;
}

export interface SyncMessageRequest {
  readonly chatId: LocoId;
  readonly cur: LocoId;
  readonly cnt: number;
  readonly max: LocoId;
}

export interface SyncMessageResponse {
  readonly isOK: boolean;
  readonly chatLogs?: ChatlogDocument[];
  readonly minLogId?: LocoId;
  readonly jsi?: LocoId;
  readonly li?: LocoId;
  readonly lastTokenId: LocoId;
}
