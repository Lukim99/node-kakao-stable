import assert from 'node:assert/strict';
import test from 'node:test';
import { Long } from 'bson';
import {
  androidKakaoTalk11Reference,
  androidReferenceCommandSchemas,
  androidReferencePushSchemas,
  observedReactionProtocolEvidence,
  observedReactionPushSchemas,
  AndroidReactionType,
  AndroidFeedType,
  OpenChannelUserPerm,
  parseReactionMeta,
  parseFeed,
  serializeChatLogInfos,
  type AndroidReferenceCommands,
} from '../src/index.js';

test('reference evidence distinguishes KakaoTalk app and reported Android OS versions', () => {
  assert.equal(androidKakaoTalk11Reference.kakaoTalkAppVersion, '11.0.0');
  assert.equal(androidKakaoTalk11Reference.reportedAndroidOsVersion, '7.1.2');
  assert.equal(androidKakaoTalk11Reference.deviceModel, 'SM-T870');
});

test('reaction candidate stays explicitly marked as non-Android evidence', () => {
  assert.equal(observedReactionProtocolEvidence.observedPlatform, 'macos');
  assert.equal(observedReactionProtocolEvidence.androidCompatibility, 'unverified');
  const id = Long.ONE;
  assert.equal(observedReactionPushSchemas.SYNCACTION?.validate({
    chatId: id,
    userId: id,
    logId: id,
    type: 1,
  }), true);
});

test('verified Android reference request schemas accept known shapes and reject drift', () => {
  const checkin: AndroidReferenceCommands['CHECKIN']['request'] = {
    userId: Long.fromNumber(1),
    os: 'android',
    ntype: 0,
    appVer: '11.0.0',
    lang: 'ko',
    MCCMNC: '45005',
  };
  assert.equal(androidReferenceCommandSchemas.CHECKIN?.validateRequest?.(checkin), true);
  assert.equal(androidReferenceCommandSchemas.CHECKIN?.validateRequest?.({ ...checkin, os: 'win32' }), false);
});

test('CHECKIN response schema matches Android 25.8.1 capture (incl. MCCMNC)', () => {
  // Synthetic hosts/ids only; shape derived from the 2026-07-11 live capture.
  const response = {
    status: 0,
    host: 'loco.example', host6: '::1', port: 443,
    cshost: 'cs.example', cshost6: '::1', csport: 443,
    vsshost: 'vss.example', vsshost6: '::1', vssport: 443,
    cacheExpire: 0,
    MCCMNC: '45005',
  };
  assert.equal(androidReferenceCommandSchemas.CHECKIN?.validateResponse?.(response), true);
  const { MCCMNC: _omit, ...withoutMccmnc } = response;
  assert.equal(androidReferenceCommandSchemas.CHECKIN?.validateResponse?.(withoutMccmnc), false);
});

test('LOGINLIST response schema matches Android 25.8.1 capture (int32 ids, embedded chatlog)', () => {
  // Synthetic ids only. Mirrors the captured shape: chatDatas[].c and the
  // embedded l.chatId/l.authorId arrive as BSON int32 (number), not Long.
  const response = {
    status: 0,
    userId: 1001,
    revision: 197,
    revisionInfo: '',
    rp: new Uint8Array(),
    minLogId: Long.fromNumber(5000),
    pkToken: 0,
    pkUpdate: false,
    sb: 0,
    chatDatas: [{
      c: 2001, t: 'MultiChat', a: 0, n: 3, ii: 0,
      s: Long.fromNumber(9000),
      l: {
        logId: Long.fromNumber(9000), chatId: 2001, type: 1, authorId: 3001,
        message: 'x', sendAt: 1, attachment: '{}', msgId: 7, prevId: Long.ZERO,
        revision: 0, scope: 0,
      },
      i: [3001], k: ['nick'], m: null, mmr: 0,
      ll: Long.fromNumber(9000), o: 0, jn: 0, p: true,
    }],
    delChatIds: [], kc: [], mcmRevision: 0,
    lastTokenId: Long.fromNumber(100), lastChatId: 2001, ltk: 100, lbk: 0, eof: true,
  };
  assert.equal(androidReferenceCommandSchemas.LOGINLIST?.validateResponse?.(response), true);
  const { revision: _drop, ...missingRevision } = response;
  assert.equal(androidReferenceCommandSchemas.LOGINLIST?.validateResponse?.(missingRevision), false);
});

test('reaction type values match the Android 25.8.1 sequential-change capture', () => {
  assert.deepEqual(
    [AndroidReactionType.Heart, AndroidReactionType.Like, AndroidReactionType.Check,
      AndroidReactionType.Laugh, AndroidReactionType.Surprise, AndroidReactionType.Sad],
    [1, 2, 3, 4, 5, 6],
  );
});

test('parseReactionMeta decodes a CHGLOGMETA reaction aggregate (synthetic ids)', () => {
  const parsed = parseReactionMeta({
    logId: Long.fromNumber(9000),
    chatId: Long.fromNumber(2001),
    type: 1,
    content: '{"3":1}',
    extra: '{"my":3,"userId":1001,"type":3}',
  });
  assert.ok(parsed);
  assert.equal(parsed.counts[AndroidReactionType.Check], 1);
  assert.equal(parsed.myReaction, 3);
  assert.equal(parsed.actorId?.toString(), '1001');
  // Non-reaction meta (type !== 1) is not treated as a reaction.
  assert.equal(parseReactionMeta({
    logId: Long.ZERO, chatId: Long.ZERO, type: 2, content: '{}',
  }), undefined);
});

test('REACT request schema accepts the captured shape and rejects drift', () => {
  const request = { li: Long.fromNumber(9000), rt: AndroidReactionType.Sad, adid: 'synthetic-adid' };
  assert.equal(androidReferenceCommandSchemas.REACT?.validateRequest?.(request), true);
  assert.equal(androidReferenceCommandSchemas.REACT?.validateRequest?.({ ...request, adid: 5 }), false);
});

test('parseFeed distinguishes join, leave, kick, and hide (Android 25.8.1 shapes)', () => {
  const join = parseFeed('{"feedType":4,"members":[{"userId":9174400976476373063,"nickName":"member"}]}');
  assert.equal(join?.feedType, AndroidFeedType.Invite);
  assert.equal(join?.kicked, false);
  assert.equal(join?.memberIds[0]?.toString(), '9174400976476373063'); // precise, not rounded
  assert.equal(join?.nicknames[0], 'member');

  const leave = parseFeed('{"feedType":2,"member":{"userId":1001,"nickName":"a"}}');
  assert.equal(leave?.feedType, AndroidFeedType.Leave);
  assert.equal(leave?.kicked, false);

  const kick = parseFeed('{"feedType":6,"member":{"userId":1001,"nickName":"a"}}');
  assert.equal(kick?.kicked, true);

  const hide = parseFeed('{"feedType":26,"coverType":"openchat_blind","chatLogInfos":[{"logId":9174400976476373064}]}');
  assert.equal(hide?.feedType, AndroidFeedType.OpenChatBlind);
  assert.equal(hide?.hiddenLogIds[0]?.toString(), '9174400976476373064');

  assert.equal(parseFeed('not json'), undefined);
});

test('open-chat host command schemas match the Android 25.8.1 capture', () => {
  const c = Long.fromNumber(2001);
  assert.equal(androidReferenceCommandSchemas.KICKMEM?.validateRequest?.(
    { li: 5, c, mid: Long.fromNumber(3001), r: false }), true);
  assert.equal(androidReferenceCommandSchemas.KLDELITEM?.validateRequest?.(
    { li: 5, c, kid: Long.fromNumber(3001) }), true);
  assert.equal(androidReferenceCommandSchemas.REWRITES?.validateRequest?.(
    { linkId: 5, chatId: c, chatLogInfos: '[]' }), true);
  assert.equal(androidReferenceCommandSchemas.SETMEMTYPE?.validateRequest?.(
    { c, li: 5, mids: [Long.fromNumber(3001)], mts: [OpenChannelUserPerm.Manager] }), true);
  assert.equal(androidReferenceCommandSchemas.CREATELINK?.validateRequest?.(
    { ri: 1, ln: 'room', ptp: 2, nn: 'host', pp: '', lip: '', lt: 8, aptp: true, desc: '', sc: true, categoryId: 14, adid: 'x' }), true);
  assert.equal(androidReferenceCommandSchemas.REACTCNT?.validateRequest?.({ li: 5 }), true);
  // observed member type values
  assert.equal(OpenChannelUserPerm.Manager, 4);
  assert.equal(OpenChannelUserPerm.None, 2);
});

test('serializeChatLogInfos keeps big-int logIds as numeric literals', () => {
  const out = serializeChatLogInfos([{ logId: Long.fromString('3882095456451504129'), type: 1 }]);
  assert.equal(out, '[{"logId":3882095456451504129,"type":1}]');
});

test('message push schema validates BSON Long identifiers and chatlog structure', () => {
  const id = Long.fromNumber(10);
  const push = {
    chatId: id,
    logId: id,
    noSeen: true,
    chatLog: {
      logId: id,
      chatId: id,
      type: 1,
      authorId: id,
      message: 'fixture',
      sendAt: 1,
      attachment: '{}',
      msgId: 2,
      prevId: Long.ZERO,
    },
  };
  assert.equal(androidReferencePushSchemas.MSG?.validate(push), true);
  assert.equal(androidReferencePushSchemas.MSG?.validate({ ...push, logId: '10' }), false);
});
