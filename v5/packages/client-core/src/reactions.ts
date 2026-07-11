export type EntityId = string;
export type MessageReactionKey = string | number;

export interface MessageReactionEvent {
  readonly channelId: EntityId;
  readonly messageId: EntityId;
  readonly actorId: EntityId;
  readonly reaction: MessageReactionKey;
  readonly operation: 'add' | 'remove';
}

export interface MessageReactionSummary {
  readonly reaction: MessageReactionKey;
  readonly count: number;
  readonly reactedByCurrentUser: boolean;
}

export interface MessageReactionSnapshot {
  readonly channelId: EntityId;
  readonly messageId: EntityId;
  readonly reactions: readonly MessageReactionSummary[];
}

function messageKey(channelId: EntityId, messageId: EntityId): string {
  return `${channelId.length}:${channelId}${messageId}`;
}

function reactionKey(reaction: MessageReactionKey): string {
  return `${typeof reaction}:${String(reaction)}`;
}

interface ReactionEntry {
  readonly reaction: MessageReactionKey;
  readonly actors: Set<EntityId>;
}

/**
 * Protocol-independent reaction reducer. Wire command names and field mapping
 * must be supplied by a verified Android protocol adapter later.
 */
export class MessageReactionStore {
  private readonly messages = new Map<string, Map<string, ReactionEntry>>();

  public constructor(private readonly currentUserId: EntityId) {}

  public apply(event: MessageReactionEvent): boolean {
    const key = messageKey(event.channelId, event.messageId);
    let reactions = this.messages.get(key);
    if (reactions === undefined) {
      if (event.operation === 'remove') return false;
      reactions = new Map();
      this.messages.set(key, reactions);
    }

    const keyForReaction = reactionKey(event.reaction);
    let entry = reactions.get(keyForReaction);
    if (entry === undefined) {
      if (event.operation === 'remove') return false;
      entry = { reaction: event.reaction, actors: new Set() };
      reactions.set(keyForReaction, entry);
    }

    if (event.operation === 'add') {
      const size = entry.actors.size;
      entry.actors.add(event.actorId);
      return entry.actors.size !== size;
    }

    const changed = entry.actors.delete(event.actorId);
    if (entry.actors.size === 0) reactions.delete(keyForReaction);
    if (reactions.size === 0) this.messages.delete(key);
    return changed;
  }

  public replace(snapshot: MessageReactionSnapshot, actorsByReaction: ReadonlyMap<MessageReactionKey, readonly EntityId[]>): void {
    const key = messageKey(snapshot.channelId, snapshot.messageId);
    const reactions = new Map<string, ReactionEntry>();
    for (const [reaction, actors] of actorsByReaction) {
      const uniqueActors = new Set(actors);
      if (uniqueActors.size > 0) reactions.set(reactionKey(reaction), { reaction, actors: uniqueActors });
    }
    if (reactions.size === 0) this.messages.delete(key);
    else this.messages.set(key, reactions);
  }

  public get(channelId: EntityId, messageId: EntityId): MessageReactionSnapshot {
    const entries = [...(this.messages.get(messageKey(channelId, messageId))?.values() ?? [])];
    entries.sort((left, right) => reactionKey(left.reaction).localeCompare(reactionKey(right.reaction)));
    return {
      channelId,
      messageId,
      reactions: entries.map((entry) => ({
        reaction: entry.reaction,
        count: entry.actors.size,
        reactedByCurrentUser: entry.actors.has(this.currentUserId),
      })),
    };
  }

  public deleteMessage(channelId: EntityId, messageId: EntityId): boolean {
    return this.messages.delete(messageKey(channelId, messageId));
  }
}
