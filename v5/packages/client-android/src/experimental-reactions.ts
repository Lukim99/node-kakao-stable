import type { Long } from 'bson';
import type { AndroidCandidateCommands } from '@lukim9-kakao/protocol-android';
import type { LocoSession } from '@lukim9-kakao/transport-node';

/**
 * Candidate reaction API based on a public macOS observation. Do not present
 * this as Android-compatible until an Android fixture validates it.
 */
export class ExperimentalAndroidReactionSession {
  public constructor(private readonly session: LocoSession<AndroidCandidateCommands>) {}

  public async addReaction(chatId: Long, logId: Long, reactionType: number): Promise<void> {
    if (!Number.isInteger(reactionType)) throw new RangeError('reactionType must be an integer');
    await this.session.request('ACTION', { chatId, logId, type: reactionType });
  }
}
