export interface ProtocolProfile {
  readonly id: string;
  readonly agent: string;
  readonly version: string;
  readonly appVersion: string;
  readonly protocolVersion: string;
  readonly deviceType: number;
  readonly maxPayloadSize: number;
  readonly features: ReadonlySet<string>;
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
