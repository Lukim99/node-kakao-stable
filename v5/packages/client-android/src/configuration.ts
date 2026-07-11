import { Long, type Binary } from 'bson';
import type {
  CheckinRequest,
  GetConfRequest,
  LoginListRequest,
  LocoId,
} from '@lukim9-kakao/protocol-android';

export interface AndroidClientConfiguration {
  /** KakaoTalk application version, not an Android OS version. */
  readonly kakaoTalkAppVersion: string;
  readonly reportedAndroidOsVersion: string;
  readonly deviceModel: string;
  readonly networkType: number;
  readonly mccmnc: string;
  readonly countryIso: string;
  readonly language: string;
  readonly protocolVersion: string;
}

export const androidKakaoTalk11SmT870ReferenceConfiguration: AndroidClientConfiguration = Object.freeze({
  kakaoTalkAppVersion: '11.0.0',
  reportedAndroidOsVersion: '7.1.2',
  deviceModel: 'SM-T870',
  networkType: 0,
  mccmnc: '45005',
  countryIso: 'KR',
  language: 'ko',
  protocolVersion: '1',
});

export interface AndroidSessionCredential {
  readonly userId: LocoId;
  readonly accessToken: string;
  readonly deviceUuid: string;
}

export interface AndroidLoginCursor {
  readonly lastTokenId?: LocoId;
  readonly lastBlockId?: number;
  readonly chatIds?: readonly LocoId[];
  readonly maxIds?: readonly LocoId[];
  readonly revision?: number;
  readonly background?: boolean;
  readonly resumePayload?: Binary | Uint8Array | string | null;
}

export function createGetConfRequest(configuration: AndroidClientConfiguration): GetConfRequest {
  return {
    MCCMNC: configuration.mccmnc,
    model: configuration.deviceModel,
    os: 'android',
  };
}

export function createCheckinRequest(
  configuration: AndroidClientConfiguration,
  userId: LocoId,
  useSub = false,
): CheckinRequest {
  const base = {
    userId,
    os: 'android' as const,
    ntype: configuration.networkType,
    appVer: configuration.kakaoTalkAppVersion,
    lang: configuration.language,
  };
  const withMccmnc = configuration.mccmnc.length === 0
    ? base
    : { ...base, MCCMNC: configuration.mccmnc };
  return useSub ? { ...withMccmnc, useSub: true } : withMccmnc;
}

export function createLoginListRequest(
  configuration: AndroidClientConfiguration,
  credential: AndroidSessionCredential,
  cursor: AndroidLoginCursor = {},
): LoginListRequest {
  return {
    appVer: configuration.kakaoTalkAppVersion,
    prtVer: configuration.protocolVersion,
    os: 'android',
    lang: configuration.language,
    duuid: credential.deviceUuid,
    ntype: configuration.networkType,
    MCCMNC: configuration.mccmnc,
    revision: cursor.revision ?? 27,
    chatIds: [...(cursor.chatIds ?? [])],
    maxIds: [...(cursor.maxIds ?? [])],
    lastTokenId: cursor.lastTokenId ?? Long.ZERO,
    lbk: cursor.lastBlockId ?? 0,
    rp: cursor.resumePayload ?? null,
    bg: cursor.background ?? false,
    oauthToken: credential.accessToken,
  };
}
