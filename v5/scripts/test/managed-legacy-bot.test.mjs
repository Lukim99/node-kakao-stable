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
