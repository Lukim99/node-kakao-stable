export interface ProtocolProfile {
  readonly id: string;
  readonly agent: string;
  readonly version: string;
  readonly appVersion: string;
  readonly protocolVersion: string;
  readonly deviceType?: number;
  readonly maxPayloadSize: number;
  readonly features: ReadonlySet<string>;
}

export interface AndroidProtocolProfile extends ProtocolProfile {
  readonly agent: 'android';
  /** KakaoTalk application version, not the Android OS major version. */
  readonly kakaoTalkAppVersion: string;
  /** Value reported by the reference configuration; not proof of the device's installed OS. */
  readonly reportedAndroidOsVersion: string;
  readonly deviceModel: string;
  readonly evidence: 'local-reference';
  readonly compatibility: 'reference-only';
}

/**
 * Historical reference only. This does not claim current server compatibility.
 */
export const legacyNodeKakaoV4Profile: ProtocolProfile = Object.freeze({
  id: 'node-kakao-v4-win32-3.4.7',
  agent: 'win32',
  version: '3.4.7',
  appVersion: '3.4.7.3369',
  protocolVersion: '1',
  deviceType: 2,
  maxPayloadSize: 8 * 1024 * 1024,
  features: new Set(['booking', 'checkin', 'login-list']),
});

/**
 * Baseline copied from node-kakao-now/node-kakao/dist/config.js.
 * `11.0.0` is the KakaoTalk app version. This profile does not claim current
 * server compatibility and must not be treated as a latest-version profile.
 */
export const androidKakaoTalk11SmT870ReferenceProfile: AndroidProtocolProfile = Object.freeze({
  id: 'android-kakaotalk-11.0.0-sm-t870-reference',
  agent: 'android',
  version: '11.0.0',
  appVersion: '11.0.0',
  kakaoTalkAppVersion: '11.0.0',
  reportedAndroidOsVersion: '7.1.2',
  deviceModel: 'SM-T870',
  protocolVersion: '1',
  maxPayloadSize: 8 * 1024 * 1024,
  features: new Set([
    'booking',
    'checkin',
    'login-list',
    'chat-write',
    'chat-push',
    'read-watermark',
    'open-link-legacy',
  ]),
  evidence: 'local-reference',
  compatibility: 'reference-only',
});
