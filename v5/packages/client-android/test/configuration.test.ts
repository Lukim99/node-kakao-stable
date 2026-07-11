import assert from 'node:assert/strict';
import test from 'node:test';
import { Long } from 'bson';
import {
  androidKakaoTalk11SmT870ReferenceConfiguration,
  createCheckinRequest,
  createGetConfRequest,
  createLoginListRequest,
} from '../src/index.js';

test('reference configuration keeps app and reported OS versions distinct', () => {
  const configuration = androidKakaoTalk11SmT870ReferenceConfiguration;
  assert.equal(configuration.kakaoTalkAppVersion, '11.0.0');
  assert.equal(configuration.reportedAndroidOsVersion, '7.1.2');
  assert.deepEqual(createGetConfRequest(configuration), {
    MCCMNC: '45005',
    model: 'SM-T870',
    os: 'android',
  });
  assert.equal(createCheckinRequest(configuration, Long.ONE).appVer, '11.0.0');
});

test('login builder accepts credentials without retaining mutable cursor arrays', () => {
  const chatIds = [Long.ONE];
  const request = createLoginListRequest(
    androidKakaoTalk11SmT870ReferenceConfiguration,
    { userId: Long.ONE, accessToken: 'fixture-token', deviceUuid: 'fixture-device' },
    { chatIds },
  );
  chatIds.push(Long.fromNumber(2));
  assert.equal(request.chatIds.length, 1);
  assert.equal(request.appVer, '11.0.0');
  assert.equal(request.prtVer, '1');
});
