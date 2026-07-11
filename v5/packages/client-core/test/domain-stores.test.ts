import assert from 'node:assert/strict';
import test from 'node:test';
import { CommunityStore, MessageReactionStore } from '../src/index.js';

test('reaction reducer is idempotent and tracks the current user', () => {
  const store = new MessageReactionStore('me');
  const event = {
    channelId: 'channel-1',
    messageId: 'log-10',
    actorId: 'me',
    reaction: 'heart',
    operation: 'add' as const,
  };
  assert.equal(store.apply(event), true);
  assert.equal(store.apply(event), false);
  assert.equal(store.apply({ ...event, actorId: 'other' }), true);
  assert.deepEqual(store.get('channel-1', 'log-10').reactions, [{
    reaction: 'heart',
    count: 2,
    reactedByCurrentUser: true,
  }]);
  assert.equal(store.apply({ ...event, operation: 'remove' }), true);
  assert.equal(store.get('channel-1', 'log-10').reactions[0]?.reactedByCurrentUser, false);
});

test('reaction snapshots can be replaced and removed with their message', () => {
  const store = new MessageReactionStore('me');
  store.replace(
    { channelId: 'c', messageId: 'm', reactions: [] },
    new Map([['like', ['me', 'other']]]),
  );
  assert.equal(store.get('c', 'm').reactions[0]?.count, 2);
  assert.equal(store.deleteMessage('c', 'm'), true);
  assert.deepEqual(store.get('c', 'm').reactions, []);
});

test('community store ignores stale updates and preserves immutable snapshots', () => {
  const store = new CommunityStore();
  const community = {
    id: 'community-1',
    revision: 2,
    name: 'Local fixture community',
    joined: true,
    memberCount: 3,
    capabilities: new Set(['posts', 'message-reactions']),
  };
  assert.equal(store.apply({ type: 'upsert', community }), true);
  assert.equal(store.apply({ type: 'upsert', community: { ...community, revision: 1 } }), false);
  const read = store.get(community.id);
  assert.ok(read);
  assert.notEqual(read.capabilities, community.capabilities);
  assert.equal(store.apply({ type: 'remove', communityId: community.id, revision: 3 }), true);
  assert.equal(store.apply({ type: 'remove', communityId: community.id, revision: 3 }), false);
  assert.equal(store.apply({ type: 'upsert', community: { ...community, revision: 3 } }), false);
  assert.equal(store.get(community.id), undefined);
});
