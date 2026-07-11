import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Long } from 'bson';
import { MemberHistoryStore } from '../bot/member-history-store.mjs';
import {
  ManagedLegacyBot,
  VIEWMORE,
  WELCOME_MESSAGE,
} from '../bot/managed-legacy-bot.mjs';

class FakeTalkClient extends EventEmitter {
  connected = false;
  sent = [];
  hidden = [];
  kicked = [];
  kickGate;

  async connect() {
    this.connected = true;
    return { channels: [{ id: 1 }] };
  }

  channel(channelId) {
    return { sendText: async text => { this.sent.push({ channelId, text }); } };
  }

  async hideMessages(linkId, channelId, logs) {
    this.hidden.push({ linkId, channelId, logs });
    return {};
  }

  async kickMember(linkId, channelId, memberId, report) {
    this.kicked.push({ linkId, channelId, memberId, report });
    await this.kickGate;
    return {};
  }

  async close() {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.emit('close');
  }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for bot handler');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('managed bot reproduces legacy join history and current commands', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'node-kakao-managed-bot-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const client = new FakeTalkClient();
  const store = new MemberHistoryStore(join(directory, 'members'));
  const bot = new ManagedLegacyBot({
    historyStore: store,
    statePath: join(directory, 'state.json'),
    reconnectDelaysMs: [1_000],
    createConnection: async () => ({
      client,
      credential: { userId: Long.fromNumber(99), deviceUuid: 'fixture', accessToken: 'fixture' },
    }),
  });
  t.after(async () => await bot.close());
  await bot.start();

  const feed = {
    feedType: 4,
    memberIds: [Long.fromNumber(7)],
    nicknames: ['테스터'],
    hiddenLogIds: [],
    kicked: false,
  };
  client.emit('memberJoin', feed, Long.fromNumber(11));
  await waitFor(() => client.sent.length === 1);
  assert.equal(client.sent[0].text, WELCOME_MESSAGE);

  client.emit('memberLeave', feed, Long.fromNumber(11));
  await waitFor(() => bot.status().counters.leaves === 1);
  client.emit('memberJoin', feed, Long.fromNumber(11));
  await waitFor(() => client.sent.length === 2);
  assert.ok(client.sent[1].text.startsWith(`🔄 테스터님은 2번째 입장입니다!\n\n${WELCOME_MESSAGE}`));
  assert.equal([...client.sent[1].text].filter(character => character === '\u200e').length, 500);
  assert.ok(client.sent[1].text.includes(VIEWMORE));
  const [, historyText] = client.sent[1].text.split(VIEWMORE);
  assert.match(historyText, /📋 입퇴장 로그/);
  assert.match(historyText, /\[입장\] 테스터/);
  assert.match(historyText, /\[퇴장\] 테스터/);

  client.emit('message', {
    chatId: Long.fromNumber(11),
    li: Long.fromNumber(5),
    chatLog: {
      authorId: Long.fromNumber(7), message: '!ping', threadId: Long.fromNumber(3),
    },
  });
  await waitFor(() => client.sent.length === 3);
  assert.equal(client.sent[2].text, 'pong!');
  client.emit('message', {
    chatId: Long.fromNumber(11),
    li: Long.fromNumber(5),
    chatLog: {
      authorId: Long.fromNumber(7), message: '!가리기', threadId: Long.fromNumber(3),
    },
  });
  await waitFor(() => client.hidden.length === 1);
  assert.equal(client.hidden[0].logs[0].logId.toNumber(), 3);
  await bot.stop();
  assert.equal(bot.status().state, 'off');
});

test('managed bot kicks a user once on the fourth message inside one second', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'node-kakao-spam-bot-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const client = new FakeTalkClient();
  let releaseKick;
  client.kickGate = new Promise(resolve => { releaseKick = resolve; });
  let now = 0;
  const bot = new ManagedLegacyBot({
    historyStore: new MemberHistoryStore(join(directory, 'members')),
    statePath: join(directory, 'state.json'),
    reconnectDelaysMs: [1_000],
    now: () => now,
    createConnection: async () => ({
      client,
      credential: { userId: Long.fromNumber(99), deviceUuid: 'fixture', accessToken: 'fixture' },
    }),
  });
  t.after(async () => await bot.close());
  await bot.start();

  const emitMessage = at => {
    now = at;
    client.emit('message', {
      chatId: Long.fromNumber(11),
      li: Long.fromNumber(5),
      chatLog: { authorId: Long.fromNumber(7), message: '도배 메시지' },
    });
  };

  for (const at of [0, 100, 200]) emitMessage(at);
  assert.equal(client.kicked.length, 0);
  emitMessage(300);
  await waitFor(() => client.kicked.length === 1);

  // Messages arriving while the kick request is pending must not dispatch it again.
  emitMessage(350);
  emitMessage(400);
  assert.equal(client.kicked.length, 1);
  releaseKick();
  await waitFor(() => bot.status().counters.spamKicks === 1);

  assert.equal(client.kicked[0].linkId, 5);
  assert.equal(client.kicked[0].channelId.toString(), '11');
  assert.equal(client.kicked[0].memberId.toString(), '7');
  assert.equal(client.kicked[0].report, false);
});

test('managed bot also kicks on the twenty-fifth message inside ten seconds', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'node-kakao-sustained-spam-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const client = new FakeTalkClient();
  let now = 0;
  const bot = new ManagedLegacyBot({
    historyStore: new MemberHistoryStore(join(directory, 'members')),
    statePath: join(directory, 'state.json'),
    reconnectDelaysMs: [1_000],
    now: () => now,
    createConnection: async () => ({
      client,
      credential: { userId: Long.fromNumber(99), deviceUuid: 'fixture', accessToken: 'fixture' },
    }),
  });
  t.after(async () => await bot.close());
  await bot.start();

  // 400ms spacing never reaches four messages in a rolling second.
  for (let index = 0; index < 24; index += 1) {
    now = index * 400;
    client.emit('message', {
      chatId: Long.fromNumber(12),
      li: Long.fromNumber(6),
      chatLog: { authorId: Long.fromNumber(8), message: '지속 도배' },
    });
  }
  assert.equal(client.kicked.length, 0);

  now = 24 * 400;
  client.emit('message', {
    chatId: Long.fromNumber(12),
    li: Long.fromNumber(6),
    chatLog: { authorId: Long.fromNumber(8), message: '지속 도배' },
  });
  await waitFor(() => client.kicked.length === 1);
  assert.equal(client.kicked[0].memberId.toString(), '8');
  await waitFor(() => bot.status().counters.spamKicks === 1);
});

test('managed bot routes configured feature commands before suppressing self messages', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'node-kakao-feature-route-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const client = new FakeTalkClient();
  const handled = [];
  const bot = new ManagedLegacyBot({
    historyStore: new MemberHistoryStore(join(directory, 'members')),
    statePath: join(directory, 'state.json'),
    reconnectDelaysMs: [1_000],
    featureTests: {
      handle: async context => {
        handled.push(context.message.chatLog.message);
        return { command: 'all', actions: 6 };
      },
    },
    createConnection: async () => ({
      client,
      credential: { userId: Long.fromNumber(99), deviceUuid: 'fixture', accessToken: 'fixture' },
    }),
  });
  t.after(async () => await bot.close());
  await bot.start();

  client.emit('message', {
    chatId: Long.fromNumber(11),
    chatLog: { authorId: Long.fromNumber(99), message: '!테스트 전체' },
  });
  await waitFor(() => handled.length === 1);
  assert.deepEqual(handled, ['!테스트 전체']);
  assert.equal(bot.status().featureTestsEnabled, true);
  assert.equal(bot.status().counters.featureTests, 6);
  assert.equal(bot.status().counters.replies, 6);
});
