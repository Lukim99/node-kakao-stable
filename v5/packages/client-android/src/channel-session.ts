import { Long } from 'bson';
import type {
  AndroidReferenceCommands,
  ChatlogDocument,
  SyncMessageResponse,
  WriteResponse,
} from '@lukim9-kakao/protocol-android';
import type { LocoSession } from '@lukim9-kakao/transport-node';

export interface AndroidSendChatInput {
  readonly type: number;
  readonly text?: string;
  readonly attachmentJson?: string;
  readonly noSeen?: boolean;
}

export interface AndroidSyncRange {
  readonly currentLogId?: Long;
  readonly maximumLogId: Long;
  readonly countHint?: number;
}

/** Emoticon/sticker attachment. Android 25.8.1 sends these as WRITE type 20; other kinds use 6/12/25. */
export interface AndroidEmoticonAttachment {
  readonly path: string;
  readonly name: string;
  readonly type: string;
  readonly sound?: string;
  readonly width?: number;
  readonly height?: number;
}

/** Inline mini-emoji descriptor carried in a text message's `emojis` attachment. */
export interface AndroidInlineEmojis {
  readonly total_item: number;
  readonly total_len: number;
  readonly items: readonly {
    readonly id: string;
    readonly len: number;
    readonly at: readonly number[];
  }[];
}

export interface AndroidMentionUser {
  readonly userId: Long;
  readonly nickname: string;
}

export class AndroidMessageIdSequence {
  private current: number;

  public constructor(initial = 0, private readonly maximum = 0x7fff_ffff) {
    if (!Number.isSafeInteger(initial) || initial < 0 || initial > maximum) {
      throw new RangeError('initial message ID must be within 0..maximum');
    }
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      throw new RangeError('maximum message ID must be a positive safe integer');
    }
    this.current = initial;
  }

  public next(): number {
    this.current = this.current === this.maximum ? 1 : this.current + 1;
    return this.current;
  }
}

/** Android KakaoTalk 11.0.0 reference command surface, tested only in memory. */
export class AndroidChannelSession {
  public constructor(
    private readonly session: LocoSession<AndroidReferenceCommands>,
    public readonly channelId: Long,
    private readonly messageIds = new AndroidMessageIdSequence(),
  ) {}

  public async send(input: AndroidSendChatInput): Promise<WriteResponse> {
    const base = {
      chatId: this.channelId,
      msgId: this.messageIds.next(),
      type: input.type,
      noSeen: input.noSeen ?? false,
    };
    const withText = input.text === undefined ? base : { ...base, msg: input.text };
    const request = input.attachmentJson === undefined
      ? withText
      : { ...withText, extra: input.attachmentJson };
    return await this.session.request('WRITE', request);
  }

  public async sendText(text: string, type = 1): Promise<WriteResponse> {
    return await this.send({ type, text });
  }

  /** Sends the Android 25.8.1 shout attachment (`WRITE` type 1). */
  public async sendShout(text: string): Promise<WriteResponse> {
    return await this.send({ type: 1, text, attachmentJson: '{"shout":true}' });
  }

  /** Sends an emoticon/sticker. `chatType` defaults to 20 (animated); use 6/12/25 for other kinds. */
  public async sendEmoticon(emoticon: AndroidEmoticonAttachment, chatType = 20): Promise<WriteResponse> {
    return await this.send({ type: chatType, text: '', attachmentJson: JSON.stringify(emoticon) });
  }

  /** Sends text carrying inline mini-emojis (the `emojis` attachment observed on Android 25.8.1). */
  public async sendTextWithEmojis(text: string, emojis: AndroidInlineEmojis): Promise<WriteResponse> {
    return await this.send({ type: 1, text, attachmentJson: JSON.stringify({ emojis }) });
  }

  /**
   * Sends a text message with @mentions. Pass an ordered list of plain strings and
   * mention targets; the text and mention offsets are built for you. The mention wire
   * shape is legacy-derived (`mentions:[{user_id,len,at}]`) and not re-verified on 25.8.1.
   */
  public async sendMention(
    segments: readonly (string | AndroidMentionUser)[],
  ): Promise<WriteResponse> {
    let text = '';
    const mentions: { userId: Long; len: number; at: number[] }[] = [];
    for (const segment of segments) {
      if (typeof segment === 'string') {
        text += segment;
        continue;
      }
      const lastAt = Math.max(0, ...mentions.flatMap((m) => m.at));
      let entry = mentions.find((m) => m.userId.eq(segment.userId) && m.len === segment.nickname.length);
      if (entry === undefined) {
        entry = { userId: segment.userId, len: segment.nickname.length, at: [] };
        mentions.push(entry);
      }
      entry.at.push(lastAt + 1);
      text += `@${segment.nickname}`;
    }
    // Build the JSON manually so user_id stays an exact integer literal (it can exceed 2^53).
    const mentionsJson = `[${mentions
      .map((m) => `{"user_id":${m.userId.toString()},"len":${m.len},"at":[${m.at.join(',')}]}`)
      .join(',')}]`;
    return await this.send({ type: 1, text, attachmentJson: `{"mentions":${mentionsJson}}` });
  }

  public async deleteMessage(logId: Long): Promise<void> {
    await this.session.request('DELETEMSG', { chatId: this.channelId, logId });
  }

  public async markRead(watermark: Long): Promise<void> {
    await this.session.request('NOTIREAD', { chatId: this.channelId, watermark });
  }

  public async sync(range: AndroidSyncRange): Promise<SyncMessageResponse> {
    return await this.session.request('SYNCMSG', {
      chatId: this.channelId,
      cur: range.currentLogId ?? Long.ZERO,
      cnt: range.countHint ?? 0,
      max: range.maximumLogId,
    });
  }

  public async getMessagesSince(since: Long = Long.ZERO): Promise<readonly ChatlogDocument[]> {
    const response = await this.session.request('MCHATLOGS', {
      chatIds: [this.channelId],
      sinces: [since],
    });
    return response.chatLogs;
  }
}
