import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Long } from 'bson';
import { createBotFeatureTestCommands } from '../bot/feature-test-commands.mjs';

function incoming(text, authorId = 7) {
  return {
    chatId: Long.fromNumber(100),
    authorNickname: '관리자',
    chatLog: { authorId: Long.fromNumber(authorId), message: text },
  };
}

function fakeSurface(calls) {
  return {
    channel: {
      sendText: async text => { calls.push({ method: 'sendText', text }); },
      sendEmoticon: async (attachment, chatType) => { calls.push({ method: 'sendEmoticon', attachment, chatType }); },
      sendTextWithEmojis: async (text, emojis) => { calls.push({ method: 'sendTextWithEmojis', text, emojis }); },
      sendMention: async segments => { calls.push({ method: 'sendMention', segments }); },
      sendShout: async text => { calls.push({ method: 'sendShout', text }); },
    },
    client: {
      sendMedia: async (channelId, type, form, options) => {
        calls.push({ method: 'sendMedia', channelId, type, form, options });
      },
      sendMultiMedia: async (channelId, type, forms, options) => {
        calls.push({ method: 'sendMultiMedia', channelId, type, forms, options });
      },
    },
  };
}

test('individual feature commands preserve optional environment overrides', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'node-kakao-feature-tests-'));
  t.after(async () => await rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, 'one.jpg'), new Uint8Array([1, 2, 3]));
  await writeFile(join(workspace, 'two.jpg'), new Uint8Array([4, 5]));

  const calls = [];
  const { client, channel } = fakeSurface(calls);
  const environment = {
    BOT_TEST_IMAGE_JSON: JSON.stringify({ path: 'one.jpg', width: 10, height: 20 }),
    BOT_TEST_IMAGES_JSON: JSON.stringify([
      { path: 'one.jpg', width: 10, height: 20 },
      { path: 'two.jpg', width: 30, height: 40 },
    ]),
    BOT_TEST_EMOTICON_JSON: JSON.stringify({ path: 'emoticon/test.webp', name: '(test)', type: 'xcon', chatType: 20 }),
    BOT_TEST_MINI_EMOTICON_JSON: JSON.stringify({
      text: 'mini',
      emojis: { total_item: 1, total_len: 1, items: [{ id: 'mini-id', len: 1, at: [0] }] },
    }),
    BOT_TEST_GROUPED_MESSAGE: '사진 두 장',
    BOT_TEST_SHOUT_TEXT: '외치기 테스트',
    BOT_TEST_MENTION_PREFIX: '멘션 테스트: ',
    BOT_TEST_MEDIA_TIMEOUT_MS: '5000',
  };
  const commands = createBotFeatureTestCommands({ workspace, environment });

  for (const text of [
    '!테스트 이미지', '!테스트 이미지묶음', '!테스트 이모티콘',
    '!테스트 미니이모티콘', '!테스트 멘션', '!테스트 외치기',
  ]) {
    assert.equal((await commands.handle({ client, channel, message: incoming(text) }))?.actions, 1);
  }

  assert.equal(calls[0].method, 'sendMedia');
  assert.equal(calls[0].type, 2);
  assert.deepEqual([...calls[0].form.data], [1, 2, 3]);
  assert.equal(calls[0].options.timeoutMs, 5_000);
  assert.equal(calls[1].method, 'sendMultiMedia');
  assert.equal(calls[1].type, 27);
  assert.equal(calls[1].options.groupedMessage, '사진 두 장');
  assert.deepEqual(calls[2], {
    method: 'sendEmoticon',
    attachment: { path: 'emoticon/test.webp', name: '(test)', type: 'xcon' },
    chatType: 20,
  });
  assert.equal(calls[3].emojis.items[0].id, 'mini-id');
  assert.equal(calls[4].segments[1].userId.toString(), '7');
  assert.equal(calls[4].segments[1].nickname, '관리자');
  assert.deepEqual(calls[5], { method: 'sendShout', text: '외치기 테스트' });
  assert.equal(await commands.handle({ client, channel, message: incoming('ordinary message') }), undefined);
});

test('default fixtures run all six features without admin or fixture environment values', async () => {
  const calls = [];
  const { client, channel } = fakeSurface(calls);
  const commands = createBotFeatureTestCommands({ workspace: process.cwd(), environment: {} });
  const result = await commands.handle({ client, channel, message: incoming('!테스트 전체', 999) });
  assert.equal(result?.actions, 6);
  assert.deepEqual(calls.map(call => call.method), [
    'sendMedia', 'sendMultiMedia', 'sendEmoticon',
    'sendTextWithEmojis', 'sendMention', 'sendShout',
  ]);

  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  assert.deepEqual([...calls[0].form.data.subarray(0, 8)], pngSignature);
  assert.equal(calls[0].form.name, 'node-kakao-test-1.png');
  assert.equal(calls[0].form.width, 320);
  assert.equal(calls[1].forms.length, 2);
  assert.deepEqual([...calls[1].forms[0].data.subarray(0, 8)], pngSignature);
  assert.equal(calls[1].options.groupedMessage, '사진 2장');

  assert.deepEqual(calls[2], {
    method: 'sendEmoticon',
    attachment: {
      path: '4412206.emot_003.webp',
      name: '(이모티콘)',
      type: 'image/webp',
    },
    chatType: 20,
  });
  assert.equal(calls[3].text, '(분노)');
  assert.deepEqual(calls[3].emojis, {
    total_item: 1,
    total_len: 4,
    items: [{ id: '1200283_004', len: 4, at: [1] }],
  });
});

test('help and individual commands do not require an administrator id', async () => {
  const calls = [];
  const { client, channel } = fakeSurface(calls);
  const commands = createBotFeatureTestCommands({ workspace: process.cwd(), environment: {} });
  assert.equal((await commands.handle({
    client,
    channel,
    message: incoming('!테스트 도움말', 123),
  }))?.actions, 1);
  assert.match(calls[0].text, /!테스트 이미지묶음/);
});
