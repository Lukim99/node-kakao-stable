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
