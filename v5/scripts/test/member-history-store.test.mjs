import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemberHistoryStore, formatHistory } from '../bot/member-history-store.mjs';

test('member history serializes concurrent joins without losing the count', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'node-kakao-bot-history-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const store = new MemberHistoryStore(directory);

  const [first, second] = await Promise.all([
    store.recordJoin('7', '첫째', new Date('2026-01-01T00:00:00Z')),
    store.recordJoin('7', '둘째', new Date('2026-01-02T00:00:00Z')),
  ]);
  assert.deepEqual([first.entryNumber, second.entryNumber].sort(), [1, 2]);
  const record = await store.get('7');
  assert.equal(record.joinCount, 2);
  assert.equal(record.events.length, 2);
});

test('member history records leave and kick events and caps retained history', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'node-kakao-bot-history-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const store = new MemberHistoryStore(directory, { maximumEvents: 2 });
  await store.recordJoin('8', '사용자');
  await store.recordLeave('8', '사용자', false);
  await store.recordLeave('8', '사용자', true);
  const record = await store.get('8');
  assert.deepEqual(record.events.map(event => event.type), ['leave', 'kick']);
  assert.match(formatHistory(record.events), /퇴장/);
  assert.match(formatHistory(record.events), /강퇴/);
});

test('member history rejects unsafe file keys', async () => {
  const store = new MemberHistoryStore(join(tmpdir(), 'unused-node-kakao-history'));
  await assert.rejects(store.get('../secret'), TypeError);
});
