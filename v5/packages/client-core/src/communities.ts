import type { EntityId } from './reactions.js';

export type CommunityCapability =
  | 'posts'
  | 'comments'
  | 'message-reactions'
  | 'threads'
  | (string & {});

export interface CommunitySnapshot {
  readonly id: EntityId;
  readonly revision: number;
  readonly name: string;
  readonly description?: string;
  readonly joined: boolean;
  readonly memberCount: number;
  readonly capabilities: ReadonlySet<CommunityCapability>;
}

export type CommunityEvent =
  | { readonly type: 'upsert'; readonly community: CommunitySnapshot }
  | { readonly type: 'remove'; readonly communityId: EntityId; readonly revision: number };

function copyCommunity(community: CommunitySnapshot): CommunitySnapshot {
  const base = {
    id: community.id,
    revision: community.revision,
    name: community.name,
    joined: community.joined,
    memberCount: community.memberCount,
    capabilities: new Set(community.capabilities),
  };
  return community.description === undefined ? base : { ...base, description: community.description };
}

/**
 * Revision-aware normalized community cache. It deliberately has no LOCO
 * method or BSON field assumptions until current Android fixtures exist.
 */
export class CommunityStore {
  private readonly communities = new Map<EntityId, CommunitySnapshot>();
  private readonly tombstones = new Map<EntityId, number>();

  public apply(event: CommunityEvent): boolean {
    if (event.type === 'remove') {
      const tombstoneRevision = this.tombstones.get(event.communityId);
      const currentRevision = Math.max(
        this.communities.get(event.communityId)?.revision ?? -1,
        tombstoneRevision ?? -1,
      );
      if (event.revision < currentRevision ||
        (tombstoneRevision !== undefined && event.revision === tombstoneRevision)) return false;
      this.communities.delete(event.communityId);
      this.tombstones.set(event.communityId, event.revision);
      return true;
    }

    const currentRevision = Math.max(
      this.communities.get(event.community.id)?.revision ?? -1,
      this.tombstones.get(event.community.id) ?? -1,
    );
    if (event.community.revision <= currentRevision) return false;
    this.communities.set(event.community.id, copyCommunity(event.community));
    this.tombstones.delete(event.community.id);
    return true;
  }

  public get(id: EntityId): CommunitySnapshot | undefined {
    const community = this.communities.get(id);
    return community === undefined ? undefined : copyCommunity(community);
  }

  public list(): readonly CommunitySnapshot[] {
    return [...this.communities.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(copyCommunity);
  }
}
