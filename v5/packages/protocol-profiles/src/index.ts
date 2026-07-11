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
 * RSA public key used by the Android LOCO reference configuration.
 *
 * This is public key material, not an account secret. It is bundled so the v5
 * client can be deployed without copying `node-kakao-now` into the image or
 * configuring a multiline environment variable. The value comes from the
 * local Android 11.0.0 reference and has also been accepted by the server
 * during this workspace's live connection checks. That observation does not
 * make it an official or permanently current KakaoTalk key.
 */
export const androidReferenceLocoPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEArFhojUWXqu7GRj8GWNIg
X5J6w23jbW3spYzLvQqLSKct6EVD6Ut9dfXCA/wCE/9FfPeJBEhqsY5JxYUEHV
vz+2m7+cjDCxbQThSG5z1hDSggLxA30QRBF2/gKDo6um9Ng0q4QDO+3+mqVw1
cVox0Xt++R4UdNT2BkVG+vp0T2c5e1QdeKvYnHYImPbeocGY+SHRcMWeZPfUr
k0bLbnw6O/KDei5LOVk435LEsKHNtj7u4fswCVds4IFtgjjBrtrvhk4CitOcR
rVVyeuODIuXy7g3dca1ZLPLxhb6fT25UtKd+8/jFTIMh4n/ul2u6pi7ny+WlE
PPeBshwy4iPQ63PQIBAw==
-----END PUBLIC KEY-----`;

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
