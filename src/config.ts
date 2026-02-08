/*
 * Created on Tue Jul 07 2020
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

export const DefaultConfiguration: OAuthLoginConfig & ClientConfig = {

  locoBookingHost: 'booking-loco.kakao.com',
  locoBookingPort: 443,

  // eslint-disable-next-line max-len
  locoPEMPublicKey: `-----BEGIN PUBLIC KEY-----\nMIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEAo7B26MRFhR8ZpnDCMarG20Lv0JcX0GBIpcxWkGzRqye53zf/1QF+fBOhQFtdHD5IeaakmdPGGKckcrC1DKXvHvbupwNp2UE/5mLY4rR5qfchQu5wzubCrRIEXVKyXEogSiiWjjfwumpJ7j7J8qx6ZRhBYPIvYsQ6QGfNjSpvE9m4KYqwAnY9I2ydGHnX/OW4+pEIgrIeFSR+DQokeRMI5RmDYUQC6foDBXxX6eF4scw5/mcojvxGGUXLyqEdH8wSPnULhh8NRH6+PBFfQRpC3JXdsh2kJ3SlvLHd9/pfEGKAEMdPNvMcQO/P4on9gbq6RKZVamwwEhBBS2Ajw/RjcQIBAw==\n-----END PUBLIC KEY-----`,

  agent: 'win32',

  version: '26.1.2',
  appVersion: '26.1.2.4957',

  osVersion: '10.0',

  // 2 == sub, 1 == main
  deviceType: 2,
  // 0 == wired(WIFI), 3 == cellular
  netType: 0,
  // 999: pc
  mccmnc: '999',

  countryIso: 'KR',
  language: 'ko',

  subDevice: true,
  deviceModel: '',

  loginTokenSeedList: ['PITT', 'INORAN'],

};

export interface BookingConfig {

  locoBookingHost: string;
  locoBookingPort: number;

  agent: string;
  mccmnc: string;

}

export interface CheckinConfig extends BookingConfig {

  locoCheckinFallbackHost?: string;
  locoCheckinFallbackPort?: number;

  subDevice: boolean;
  appVersion: string;

  countryIso: string;
  language: string;

  netType: number;

  locoPEMPublicKey: string;
}

export interface WebApiConfig {

  agent: string;

  version: string;
  osVersion: string;

  language: string;
  
  deviceModel: string;

}

export type SessionConfig = CheckinConfig;

export interface ClientConfig extends SessionConfig, WebApiConfig {

  deviceType: number;

}

export interface OAuthLoginConfig extends WebApiConfig {

  loginTokenSeedList: [string, string];

}
