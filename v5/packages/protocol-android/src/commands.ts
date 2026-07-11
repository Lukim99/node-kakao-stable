import type {
  ChannelLeftPush,
  ChannelMetaPush,
  CheckinRequest,
  CheckinResponse,
  GetConfRequest,
  GetConfResponse,
  LChatListRequest,
  LChatListResponse,
  LoginListRequest,
  LoginListResponse,
  LocoId,
  MessagePush,
  ReadWatermarkPush,
  SyncMessageRequest,
  SyncMessageResponse,
  WriteRequest,
  WriteResponse,
} from './types.js';
import type { ReactRequest, ReactResponse } from './reactions.js';
import type {
  GetTrailerRequest,
  GetTrailerResponse,
  MediaCheckTokensRequest,
  MediaCheckTokensResponse,
  MediaCompletePush,
  MediaPostRequest,
  MediaPostResponse,
  MediaMultiPostRequest,
  MediaTransferRequest,
  MediaTransferResponse,
  MShipRequest,
  MShipResponse,
  ShipRequest,
  ShipResponse,
} from './media.js';
import type {
  CreateOpenLinkRequest,
  CreateOpenLinkResponse,
  KickMemberRequest,
  KickMemberResponse,
  ReactionCountRequest,
  ReactionCountResponse,
  RewritesRequest,
  RewritesResponse,
  SetMemberTypeRequest,
  SetMemberTypeResponse,
  UnkickMemberRequest,
  UnkickMemberResponse,
} from './openlink.js';

export interface AndroidReferenceCommands {
  PING: { request: Record<string, never>; response: Record<string, never> };
  GETCONF: { request: GetConfRequest; response: GetConfResponse };
  CHECKIN: { request: CheckinRequest; response: CheckinResponse };
  LOGINLIST: { request: LoginListRequest; response: LoginListResponse };
  LCHATLIST: { request: LChatListRequest; response: LChatListResponse };
  SETST: { request: { readonly st: number }; response: Record<string, never> };
  GETTOKEN: { request: { readonly ts: readonly number[] }; response: Readonly<Record<string, unknown>> };
  WRITE: { request: WriteRequest; response: WriteResponse };
  DELETEMSG: { request: { readonly chatId: LocoId; readonly logId: LocoId }; response: Record<string, never> };
  NOTIREAD: { request: { readonly chatId: LocoId; readonly watermark: LocoId }; response: Record<string, never> };
  SYNCMSG: { request: SyncMessageRequest; response: SyncMessageResponse };
  MCHATLOGS: {
    request: { readonly chatIds: readonly LocoId[]; readonly sinces: readonly LocoId[] };
    response: { readonly chatLogs: readonly import('./types.js').ChatlogDocument[] };
  };
  UPDATECHAT: { request: { readonly chatId: LocoId; readonly pushAlert: boolean }; response: Record<string, never> };
  // General-chat message reaction, confirmed on Android 25.8.1.
  REACT: { request: ReactRequest; response: ReactResponse };
  // Open-chat host actions, confirmed on Android 25.8.1 (SETMEMTYPE is legacy-shaped).
  KICKMEM: { request: KickMemberRequest; response: KickMemberResponse };
  KLDELITEM: { request: UnkickMemberRequest; response: UnkickMemberResponse };
  REWRITES: { request: RewritesRequest; response: RewritesResponse };
  SETMEMTYPE: { request: SetMemberTypeRequest; response: SetMemberTypeResponse };
  CREATELINK: { request: CreateOpenLinkRequest; response: CreateOpenLinkResponse };
  REACTCNT: { request: ReactionCountRequest; response: ReactionCountResponse };
  // Media (image/audio/file) upload & download control, confirmed on Android 25.8.1.
  SHIP: { request: ShipRequest; response: ShipResponse };
  MSHIP: { request: MShipRequest; response: MShipResponse };
  POST: { request: MediaPostRequest; response: MediaPostResponse };
  MPOST: { request: MediaMultiPostRequest; response: MediaPostResponse };
  MINI: { request: MediaTransferRequest; response: MediaTransferResponse };
  DOWN: { request: MediaTransferRequest; response: MediaTransferResponse };
  GETTRAILER: { request: GetTrailerRequest; response: GetTrailerResponse };
  MCHKTOKENS: { request: MediaCheckTokensRequest; response: MediaCheckTokensResponse };
}

export interface AndroidReferencePushes {
  MSG: MessagePush;
  FEED: Readonly<Record<string, unknown>>;
  DECUNREAD: ReadWatermarkPush;
  CHGMETA: ChannelMetaPush;
  LEFT: ChannelLeftPush;
  SYNCDLMSG: Readonly<Record<string, unknown>>;
  KICKOUT: { readonly reason: number };
  CHANGESVR: Readonly<Record<string, unknown>>;
  BLSYNC: Readonly<Record<string, unknown>>;
  COMPLETE: MediaCompletePush;
}
