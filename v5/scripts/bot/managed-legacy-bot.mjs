import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Long } from 'bson';
import { formatHistory } from './member-history-store.mjs';

const toLong = value => Long.isLong(value) ? value : Long.fromValue(value);

export const VIEWMORE = ('\u200e'.repeat(500));

export const WELCOME_MESSAGE = `💯 우리방은 진짜 매칭이 됩니다!


📌 소개 신청 방법
오른쪽 상단 메뉴(☰)에서 공지사항을 클릭해 확인해주세요 ✨
공지에 신청 링크가 있어요!
(10초면 완료💌)


❤️ 채팅방 하트(♡)도 꼭 눌러주세요 :)
궁금한 점은 신청 후 물어보시면 돼요😄`;

async function readDesiredState(path, fallback) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return typeof value.desiredRunning === 'boolean' ? value.desiredRunning : fallback;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeDesiredState(path, desiredRunning) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify({ desiredRunning }), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

export class ManagedLegacyBot {
  #client;
  #credential;
  #channels = new Map();
  #operation = Promise.resolve();
  #reconnectTimer;
  #reconnectAttempt = 0;
  #desiredRunning = false;
  #state = 'off';
  #startedAt;
  #lastError;
  #initialChannelCount = 0;
  #responsesEnabled = true;
  #counters = { joins: 0, leaves: 0, messages: 0, replies: 0, errors: 0 };

  constructor(options) {
    this.createConnection = options.createConnection;
    this.historyStore = options.historyStore;
    this.statePath = options.statePath;
    this.log = options.log ?? (() => undefined);
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [1_000, 2_000, 5_000, 10_000, 30_000];
    if (!Array.isArray(this.reconnectDelaysMs) || this.reconnectDelaysMs.length === 0 ||
      this.reconnectDelaysMs.some(delay => !Number.isSafeInteger(delay) || delay < 0)) {
      throw new RangeError('reconnectDelaysMs must contain non-negative safe integers');
    }
  }

  async initialize(defaultEnabled = true) {
    this.#desiredRunning = await readDesiredState(this.statePath, defaultEnabled);
    if (this.#desiredRunning) await this.#enqueue(async () => await this.#startNow());
  }

  async start() {
    this.#desiredRunning = true;
    await writeDesiredState(this.statePath, true);
    return await this.#enqueue(async () => await this.#startNow());
  }

  async stop() {
    this.#desiredRunning = false;
    await writeDesiredState(this.statePath, false);
    return await this.#enqueue(async () => await this.#stopNow());
  }

  async connectCheck() {
    return await this.#enqueue(async () => {
      this.#responsesEnabled = false;
      try {
        await this.#startNow();
        return this.status();
      } finally {
        this.#desiredRunning = false;
        await this.#stopNow();
        this.#responsesEnabled = true;
      }
    });
  }

  status() {
    return {
      desiredRunning: this.#desiredRunning,
      state: this.#state,
      connected: this.#client?.connected ?? false,
      startedAt: this.#startedAt,
      initialChannelCount: this.#initialChannelCount,
      reconnectAttempt: this.#reconnectAttempt,
      lastError: this.#lastError,
      counters: { ...this.#counters },
    };
  }

  async close() {
    this.#desiredRunning = false;
    await this.#enqueue(async () => await this.#stopNow());
  }

  async #startNow() {
    if (this.#client?.connected) return this.status();
    this.#clearReconnect();
    this.#state = 'starting';
    this.#lastError = undefined;
    let client;
    try {
      const connection = await this.createConnection();
      client = connection.client;
      this.#credential = connection.credential;
      this.#client = client;
      this.#channels.clear();
      this.#attach(client);
      const login = await client.connect(connection.credential);
      if (this.#client !== client) throw new Error('Bot connection was replaced during login');
      this.#state = 'on';
      this.#startedAt = new Date().toISOString();
      this.#initialChannelCount = login.channels.length;
      this.#reconnectAttempt = 0;
      this.log('bot-connected', { channels: login.channels.length });
      return this.status();
    } catch (error) {
      if (this.#client === client) this.#client = undefined;
      if (client !== undefined) await client.close().catch(() => undefined);
      this.#state = 'error';
      this.#counters.errors += 1;
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.log('bot-connect-error', { message: this.#lastError });
      this.#scheduleReconnect();
      throw error;
    }
  }

  async #stopNow() {
    this.#clearReconnect();
    const client = this.#client;
    this.#client = undefined;
    this.#credential = undefined;
    this.#channels.clear();
    if (client === undefined) {
      this.#state = 'off';
      return this.status();
    }
    this.#state = 'stopping';
    await client.close();
    this.#state = 'off';
    this.#startedAt = undefined;
    this.log('bot-stopped');
    return this.status();
  }

  #attach(client) {
    client.on('error', error => {
      if (this.#client !== client) return;
      this.#counters.errors += 1;
      this.#lastError = error.message;
      this.log('bot-error', { message: error.message });
    });
    client.on('close', () => {
      if (this.#client !== client) return;
      this.#client = undefined;
      this.#channels.clear();
      this.#state = 'off';
      this.log('bot-disconnected');
      this.#scheduleReconnect();
    });
    client.on('memberJoin', (feed, channelId) => {
      if (this.#responsesEnabled) void this.#onJoin(client, feed, channelId);
    });
    client.on('memberLeave', (feed, _channelId) => {
      if (this.#responsesEnabled) void this.#onLeave(feed);
    });
    client.on('message', message => {
      if (this.#responsesEnabled) void this.#onMessage(client, message);
    });
  }

  async #onJoin(client, feed, channelId) {
    try {
      for (let index = 0; index < feed.nicknames.length; index += 1) {
        const nickname = feed.nicknames[index];
        const memberId = feed.memberIds[index];
        if (nickname === undefined) continue;
        let text = WELCOME_MESSAGE;
        if (memberId !== undefined) {
          const history = await this.historyStore.recordJoin(memberId.toString(), nickname);
          if (history.entryNumber > 1) {
            const historyText = formatHistory(history.previousEvents);
            text = `🔄 ${nickname}님은 ${history.entryNumber}번째 입장입니다!\n\n${WELCOME_MESSAGE}`;
            if (historyText.length > 0) {
              text += `\n\n${VIEWMORE}\n\n📋 입퇴장 로그\n${historyText}`;
            }
          }
        }
        await this.#channelFor(client, channelId).sendText(text);
        this.#counters.joins += 1;
        this.#counters.replies += 1;
      }
    } catch (error) {
      this.#recordHandlerError('join-handler-error', error);
    }
  }

  async #onLeave(feed) {
    try {
      for (let index = 0; index < feed.nicknames.length; index += 1) {
        const nickname = feed.nicknames[index];
        const memberId = feed.memberIds[index];
        if (nickname === undefined || memberId === undefined) continue;
        await this.historyStore.recordLeave(memberId.toString(), nickname, feed.kicked);
        this.#counters.leaves += 1;
      }
    } catch (error) {
      this.#recordHandlerError('leave-handler-error', error);
    }
  }

  async #onMessage(client, message) {
    this.#counters.messages += 1;
    const chatLog = message.chatLog;
    const text = chatLog?.message;
    if (typeof text !== 'string') return;
    const selfUserId = this.#credential?.userId;
    if (selfUserId !== undefined && toLong(chatLog.authorId).equals(toLong(selfUserId))) return;
    try {
      if (text === '!ping') {
        await this.#channelFor(client, message.chatId).sendText('pong!');
        this.#counters.replies += 1;
        return;
      }
      if (text !== '!가리기' || message.li === undefined || chatLog.threadId === undefined) return;
      const linkId = toLong(message.li).toNumber();
      if (!Number.isSafeInteger(linkId)) throw new Error('Open-link id is outside the safe integer range');
      await client.hideMessages(
        linkId,
        toLong(message.chatId),
        [{ logId: toLong(chatLog.threadId), type: 1 }],
      );
      this.#counters.replies += 1;
    } catch (error) {
      this.#recordHandlerError('message-handler-error', error);
    }
  }

  #channelFor(client, channelId) {
    const id = toLong(channelId);
    const key = id.toString();
    let channel = this.#channels.get(key);
    if (channel === undefined) {
      channel = client.channel(id);
      this.#channels.set(key, channel);
    }
    return channel;
  }

  #recordHandlerError(event, error) {
    this.#counters.errors += 1;
    const message = error instanceof Error ? error.message : String(error);
    this.#lastError = message;
    this.log(event, { message });
  }

  #scheduleReconnect() {
    if (!this.#desiredRunning || this.#reconnectTimer !== undefined) return;
    const index = Math.min(this.#reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const delay = this.reconnectDelaysMs[index];
    this.#reconnectAttempt += 1;
    this.#state = 'reconnecting';
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#enqueue(async () => await this.#startNow()).catch(() => undefined);
    }, delay);
  }

  #clearReconnect() {
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
  }

  #enqueue(operation) {
    const result = this.#operation.then(operation, operation);
    this.#operation = result.catch(() => undefined);
    return result;
  }
}
