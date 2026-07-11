import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

function emptyRecord() {
  return { version: 1, joinCount: 0, events: [] };
}

function isEvent(value) {
  return typeof value === 'object' && value !== null &&
    (value.type === 'join' || value.type === 'leave' || value.type === 'kick') &&
    typeof value.nickname === 'string' && typeof value.at === 'string';
}

function parseRecord(source) {
  const value = JSON.parse(source);
  if (typeof value !== 'object' || value === null || value.version !== 1 ||
    !Number.isSafeInteger(value.joinCount) || value.joinCount < 0 ||
    !Array.isArray(value.events) || !value.events.every(isEvent)) {
    throw new Error('Member history file has an invalid structure');
  }
  return value;
}

function memberKey(value) {
  const key = String(value);
  if (!/^\d+$/.test(key)) throw new TypeError('Member id must contain decimal digits only');
  return key;
}

export class MemberHistoryStore {
  #locks = new Map();

  constructor(directory, options = {}) {
    this.directory = directory;
    this.maximumEvents = options.maximumEvents ?? 50;
    if (!Number.isSafeInteger(this.maximumEvents) || this.maximumEvents < 1) {
      throw new RangeError('maximumEvents must be a positive safe integer');
    }
  }

  async recordJoin(userId, nickname, at = new Date()) {
    return await this.#update(userId, record => {
      const previousEvents = [...record.events];
      record.joinCount += 1;
      record.events.push({ type: 'join', nickname, at: at.toISOString() });
      return { entryNumber: record.joinCount, previousEvents };
    });
  }

  async recordLeave(userId, nickname, kicked, at = new Date()) {
    return await this.#update(userId, record => {
      record.events.push({ type: kicked ? 'kick' : 'leave', nickname, at: at.toISOString() });
      return { joinCount: record.joinCount };
    });
  }

  async get(userId) {
    const key = memberKey(userId);
    return await this.#withLock(key, async () => await this.#read(key));
  }

  async #update(userId, mutate) {
    const key = memberKey(userId);
    return await this.#withLock(key, async () => {
      const record = await this.#read(key);
      const result = mutate(record);
      if (record.events.length > this.maximumEvents) {
        record.events = record.events.slice(-this.maximumEvents);
      }
      await this.#write(key, record);
      return result;
    });
  }

  async #read(key) {
    try {
      return parseRecord(await readFile(join(this.directory, `${key}.json`), 'utf8'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return emptyRecord();
      throw error;
    }
  }

  async #write(key, record) {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${key}.json`);
    const temporary = join(this.directory, `.${key}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  }

  async #withLock(key, operation) {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.#locks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(key) === tail) this.#locks.delete(key);
    }
  }
}

export function formatHistory(events, locale = 'ko-KR') {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const label = { join: '입장', leave: '퇴장', kick: '강퇴' };
  return events.map(event =>
    `• [${label[event.type]}] ${event.nickname} — ${formatter.format(new Date(event.at))}`,
  ).join('\n');
}
