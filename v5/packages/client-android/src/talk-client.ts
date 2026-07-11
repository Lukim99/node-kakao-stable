import { EventEmitter } from 'node:events';
import type { KeyLike } from 'node:crypto';
import { Long } from 'bson';
import { BsonPayloadCodec, type LocoPacket } from '@lukim9-kakao/protocol-core';
import {
  LocoSession,
  NodeTcpTransport,
  NodeTlsTransport,
  LocoSecureTransport,
} from '@lukim9-kakao/transport-node';
import {
  parseFeed,
  parseReactionMeta,
  serializeChatLogInfos,
  type AndroidFeed,
  type OpenChannelUserPerm,
  type AndroidReferenceCommands,
  type ChannelLeftPush,
  type ChatlogDocument,
  type MessagePush,
  type ParsedReaction,
  type ReactionMetaPush,
  type ReadWatermarkPush,
  type SyncLinkProfilePush,
} from '@lukim9-kakao/protocol-android';
import type { AndroidClientConfiguration, AndroidSessionCredential, AndroidLoginCursor } from './configuration.js';
import { AndroidReferenceBootstrap, type AndroidLoginResult } from './bootstrap.js';
import { createAndroidReferenceSession } from './session.js';
import { AndroidChannelSession } from './channel-session.js';

export interface AndroidTalkClientOptions {
  /** Kakao LOCO RSA public key (caller-supplied; the legacy PEM is server-accepted). */
  readonly locoPublicKey: KeyLike;
  /** Advertisement id, required only to send reactions via REACT. */
  readonly advertisementId?: string;
  readonly bookingHost?: string;
  readonly bookingPort?: number;
  readonly maximumChatListPages?: number;
  /** Keepalive PING interval in ms. LOCO drops idle sessions without it. 0 disables. Default 30000. */
  readonly pingIntervalMs?: number;
}

export interface AndroidTalkClientEventMap {
  message: [MessagePush, LocoPacket];
  read: [ReadWatermarkPush];
  left: [ChannelLeftPush];
  reaction: [ParsedReaction];
  memberJoin: [AndroidFeed, Long];
  /** A member left or was kicked (feed.kicked distinguishes the two). */
  memberLeave: [AndroidFeed, Long];
  messageHidden: [AndroidFeed, Long];
  profileChanged: [SyncLinkProfilePush];
  /** Any push without a dedicated event (still delivered raw, never dropped). */
  raw: [LocoPacket];
  error: [Error];
  close: [];
}

/**
 * High-level Android KakaoTalk client: runs booking -> checkin -> login, keeps
 * the login session open, and re-emits server pushes as events. It ties the
 * existing bootstrap/session/channel pieces together for ordinary Node usage.
 *
 * Add an `error` listener: an unhandled `error` event terminates the process
 * (standard EventEmitter behaviour).
 */
export class AndroidTalkClient extends EventEmitter {
  private session: LocoSession<AndroidReferenceCommands> | undefined;
  private consumeTask: Promise<void> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private readonly bookingHost: string;
  private readonly bookingPort: number;

  public constructor(
    private readonly configuration: AndroidClientConfiguration,
    private readonly options: AndroidTalkClientOptions,
  ) {
    super();
    this.bookingHost = options.bookingHost ?? 'booking-loco.kakao.com';
    this.bookingPort = options.bookingPort ?? 443;
  }

  public get connected(): boolean {
    return this.session !== undefined;
  }

  /**
   * Connects and logs in with an already-issued credential (see AndroidAuthClient
   * for obtaining one). Returns the initial channel list; pushes then arrive as
   * events until `close()`.
   */
  public async connect(
    credential: AndroidSessionCredential,
    cursor: AndroidLoginCursor = {},
  ): Promise<AndroidLoginResult> {
    if (this.session !== undefined) throw new Error('AndroidTalkClient is already connected');
    const bootstrap = new AndroidReferenceBootstrap(this.configuration, {
      ...(this.options.maximumChatListPages === undefined
        ? {}
        : { maximumChatListPages: this.options.maximumChatListPages }),
    });

    const { host: loginHost, port: loginPort } = await this.resolveLoginEndpoint(bootstrap, credential.userId);

    const loginTcp = await NodeTcpTransport.connect({ host: loginHost, port: loginPort });
    const loginSecure = new LocoSecureTransport(loginTcp, { publicKey: this.options.locoPublicKey });
    const session = createAndroidReferenceSession(loginSecure, { validate: false });
    this.session = session;

    let loginResult: AndroidLoginResult;
    try {
      loginResult = await bootstrap.login(session, credential, cursor);
    } catch (error) {
      this.session = undefined;
      await session.close().catch(() => undefined);
      throw error;
    }

    this.consumeTask = this.consumePushes(session);
    this.startKeepAlive(session);
    return loginResult;
  }

  private startKeepAlive(session: LocoSession<AndroidReferenceCommands>): void {
    const interval = this.options.pingIntervalMs ?? 30_000;
    if (interval <= 0) return;
    this.pingTimer = setInterval(() => {
      if (this.session !== session) return;
      void session.request('PING', {}, { timeoutMs: 10_000 }).catch(() => undefined);
    }, interval);
  }

  private async resolveLoginEndpoint(
    bootstrap: AndroidReferenceBootstrap,
    userId: Long | number,
  ): Promise<{ host: string; port: number }> {
    const bookingTransport = await NodeTlsTransport.connect({
      host: this.bookingHost,
      port: this.bookingPort,
      servername: this.bookingHost,
    });
    const bookingSession = createAndroidReferenceSession(bookingTransport, { validate: false });
    let checkinHost: string;
    let checkinPort: number;
    try {
      const configuration = await bootstrap.getConfiguration(bookingSession);
      const host = configuration.ticket.lsl[0];
      const port = configuration.wifi.ports[0];
      if (host === undefined || port === undefined) throw new Error('Booking returned no checkin endpoint');
      checkinHost = host;
      checkinPort = port;
    } finally {
      await bookingSession.close().catch(() => undefined);
    }

    const checkinTcp = await NodeTcpTransport.connect({ host: checkinHost, port: checkinPort });
    const checkinSecure = new LocoSecureTransport(checkinTcp, { publicKey: this.options.locoPublicKey });
    const checkinSession = createAndroidReferenceSession(checkinSecure, { validate: false });
    try {
      const response = await bootstrap.checkin(checkinSession, userId);
      return { host: response.host, port: response.port };
    } finally {
      await checkinSession.close().catch(() => undefined);
    }
  }

  private async consumePushes(session: LocoSession<AndroidReferenceCommands>): Promise<void> {
    const codec = new BsonPayloadCodec();
    try {
      for await (const packet of session.pushes()) {
        const decoded = codec.decode(packet.dataType, packet.payload);
        switch (packet.header.method) {
          case 'MSG':
            this.emit('message', decoded as MessagePush, packet);
            break;
          case 'DECUNREAD':
            this.emit('read', decoded as ReadWatermarkPush);
            break;
          case 'LEFT':
            this.emit('left', decoded as ChannelLeftPush);
            break;
          case 'CHGLOGMETA': {
            const reaction = parseReactionMeta(decoded as ReactionMetaPush);
            if (reaction !== undefined) this.emit('reaction', reaction);
            else this.emit('raw', packet);
            break;
          }
          case 'NEWMEM':
            this.emitFeed('memberJoin', decoded, packet);
            break;
          case 'DELMEM':
            this.emitFeed('memberLeave', decoded, packet);
            break;
          case 'SYNCREWR':
            this.emitFeed('messageHidden', decoded, packet);
            break;
          case 'SYNCLINKPF':
            this.emit('profileChanged', decoded as SyncLinkProfilePush);
            break;
          default:
            this.emit('raw', packet);
        }
      }
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (this.session === session) {
        this.session = undefined;
        this.stopKeepAlive();
        this.emit('close');
      }
    }
  }

  private emitFeed(
    event: 'memberJoin' | 'memberLeave' | 'messageHidden',
    decoded: unknown,
    packet: LocoPacket,
  ): void {
    const chatLog = (decoded as { chatLog?: ChatlogDocument }).chatLog;
    const feed = parseFeed(chatLog?.message);
    if (feed !== undefined && chatLog !== undefined) {
      const channelId = Long.isLong(chatLog.chatId) ? chatLog.chatId : Long.fromValue(chatLog.chatId);
      this.emit(event, feed, channelId);
    } else {
      this.emit('raw', packet);
    }
  }

  private stopKeepAlive(): void {
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  /** Returns a channel handle bound to the live login session. */
  public channel(channelId: Long): AndroidChannelSession {
    if (this.session === undefined) throw new Error('AndroidTalkClient is not connected');
    return new AndroidChannelSession(this.session, channelId);
  }

  /** Adds or changes the current user's reaction on a message (see AndroidReactionType). */
  public async react(logId: Long, reactionType: number): Promise<void> {
    if (this.session === undefined) throw new Error('AndroidTalkClient is not connected');
    const adid = this.options.advertisementId;
    if (adid === undefined) throw new Error('advertisementId option is required to send reactions');
    await this.session.request('REACT', { li: logId, rt: reactionType, adid });
  }

  private requireSession(): LocoSession<AndroidReferenceCommands> {
    if (this.session === undefined) throw new Error('AndroidTalkClient is not connected');
    return this.session;
  }

  // --- Open-chat host actions (require host/manager permission in the target open chat) ---

  /** Kicks a member from an open chat. `report` flags the user to Kakao. */
  public async kickMember(
    linkId: number,
    channelId: Long,
    memberId: Long,
    report = false,
  ): Promise<AndroidReferenceCommands['KICKMEM']['response']> {
    return this.requireSession().request('KICKMEM', { li: linkId, c: channelId, mid: memberId, r: report });
  }

  /** Removes a member from the open chat's kick list (un-kick). */
  public async unkickMember(
    linkId: number,
    channelId: Long,
    kickedId: Long,
  ): Promise<AndroidReferenceCommands['KLDELITEM']['response']> {
    return this.requireSession().request('KLDELITEM', { li: linkId, c: channelId, kid: kickedId });
  }

  /** Hides (blinds) messages in an open chat as host. */
  public async hideMessages(
    linkId: number,
    channelId: Long,
    logs: readonly { readonly logId: Long; readonly type: number }[],
  ): Promise<AndroidReferenceCommands['REWRITES']['response']> {
    return this.requireSession().request('REWRITES', {
      linkId,
      chatId: channelId,
      chatLogInfos: serializeChatLogInfos(logs),
    });
  }

  /** Sets open-chat member permissions (promote/demote; see OpenChannelUserPerm). */
  public async setMemberPermission(
    linkId: number,
    channelId: Long,
    memberIds: readonly Long[],
    permissions: readonly OpenChannelUserPerm[],
  ): Promise<AndroidReferenceCommands['SETMEMTYPE']['response']> {
    return this.requireSession().request('SETMEMTYPE', {
      c: channelId,
      li: linkId,
      mids: [...memberIds],
      mts: [...permissions],
    });
  }

  /** Creates an open chat / community chat room. Defaults match Android 25.8.1. */
  public async createOpenLink(options: {
    readonly name: string;
    readonly nickname: string;
    readonly categoryId: number;
    readonly description?: string;
    readonly searchable?: boolean;
    readonly profileImagePath?: string;
    readonly coverImagePath?: string;
    readonly linkType?: number;
    readonly profileType?: number;
    readonly allowAnonymousProfile?: boolean;
  }): Promise<AndroidReferenceCommands['CREATELINK']['response']> {
    const adid = this.options.advertisementId;
    if (adid === undefined) throw new Error('advertisementId option is required to create an open link');
    return this.requireSession().request('CREATELINK', {
      ri: Date.now(),
      ln: options.name,
      ptp: options.profileType ?? 2,
      nn: options.nickname,
      pp: options.profileImagePath ?? '',
      lip: options.coverImagePath ?? '',
      lt: options.linkType ?? 8,
      aptp: options.allowAnonymousProfile ?? true,
      desc: options.description ?? '',
      sc: options.searchable ?? true,
      categoryId: options.categoryId,
      adid,
    });
  }

  /** Queries the reaction count for a message/profile log id. */
  public async getReactionCount(li: number): Promise<AndroidReferenceCommands['REACTCNT']['response']> {
    return this.requireSession().request('REACTCNT', { li });
  }

  public async close(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    this.stopKeepAlive();
    if (session !== undefined) await session.close().catch(() => undefined);
    await this.consumeTask?.catch(() => undefined);
  }

  public override on<K extends keyof AndroidTalkClientEventMap>(
    event: K,
    listener: (...args: AndroidTalkClientEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  public override emit<K extends keyof AndroidTalkClientEventMap>(
    event: K,
    ...args: AndroidTalkClientEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
  }
}
