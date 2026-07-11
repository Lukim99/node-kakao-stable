import { Long } from 'bson';
import type {
  AndroidReferenceCommands,
  ChannelDataDocument,
  CheckinResponse,
  GetConfResponse,
  LChatListResponse,
} from '@lukim9-kakao/protocol-android';

// Wire ids arrive as BSON int64 (Long) or int32 (number); normalize to Long for
// the domain result. Number-encoded ids are int32-range, so this is lossless.
const toLong = (value: Long | number): Long => (Long.isLong(value) ? value : Long.fromNumber(value));
import type { LocoSession } from '@lukim9-kakao/transport-node';
import {
  createCheckinRequest,
  createGetConfRequest,
  createLoginListRequest,
  type AndroidClientConfiguration,
  type AndroidLoginCursor,
  type AndroidSessionCredential,
} from './configuration.js';

export class AndroidChatListPaginationError extends Error {
  public constructor(public readonly maximumPages: number) {
    super(`Android chat list exceeded the configured ${maximumPages}-page safety limit`);
    this.name = new.target.name;
  }
}

export interface AndroidLoginResult {
  readonly userId: Long;
  readonly revision: number;
  readonly revisionInfo: string;
  readonly minLogId: Long;
  readonly channels: readonly ChannelDataDocument[];
  readonly removedChannelIds: readonly Long[];
  readonly lastChatId: Long;
  readonly lastTokenId: Long;
  readonly lastBlockId: number;
  readonly mcmRevision: number;
}

export interface AndroidBootstrapOptions {
  readonly maximumChatListPages?: number;
}

/**
 * Account-independent orchestration code for the verified 11.0.0 request
 * sequence. Calling login against a real service still requires credentials.
 */
export class AndroidReferenceBootstrap {
  private readonly maximumChatListPages: number;

  public constructor(
    private readonly configuration: AndroidClientConfiguration,
    options: AndroidBootstrapOptions = {},
  ) {
    this.maximumChatListPages = options.maximumChatListPages ?? 1_000;
    if (!Number.isSafeInteger(this.maximumChatListPages) || this.maximumChatListPages < 1) {
      throw new RangeError('maximumChatListPages must be a positive safe integer');
    }
  }

  public async getConfiguration(
    session: LocoSession<AndroidReferenceCommands>,
  ): Promise<GetConfResponse> {
    return await session.request('GETCONF', createGetConfRequest(this.configuration));
  }

  public async checkin(
    session: LocoSession<AndroidReferenceCommands>,
    userId: Long | number,
    useSub = false,
  ): Promise<CheckinResponse> {
    return await session.request('CHECKIN', createCheckinRequest(this.configuration, userId, useSub));
  }

  public async login(
    session: LocoSession<AndroidReferenceCommands>,
    credential: AndroidSessionCredential,
    cursor: AndroidLoginCursor = {},
  ): Promise<AndroidLoginResult> {
    const first = await session.request(
      'LOGINLIST',
      createLoginListRequest(this.configuration, credential, cursor),
    );
    const channels = [...first.chatDatas];
    const removedChannelIds = first.delChatIds.map(toLong);
    let last: LChatListResponse = first;
    let pageCount = 1;

    while (!last.eof) {
      if (pageCount >= this.maximumChatListPages) {
        throw new AndroidChatListPaginationError(this.maximumChatListPages);
      }
      last = await session.request('LCHATLIST', {
        lastTokenId: last.lastTokenId,
        lastChatId: last.lastChatId,
      });
      channels.push(...last.chatDatas);
      removedChannelIds.push(...last.delChatIds.map(toLong));
      pageCount += 1;
    }

    return {
      userId: toLong(first.userId),
      revision: first.revision,
      revisionInfo: first.revisionInfo,
      minLogId: toLong(first.minLogId),
      channels,
      removedChannelIds,
      lastChatId: toLong(last.lastChatId),
      lastTokenId: toLong(last.lastTokenId),
      lastBlockId: last.lbk,
      mcmRevision: last.mcmRevision,
    };
  }
}
