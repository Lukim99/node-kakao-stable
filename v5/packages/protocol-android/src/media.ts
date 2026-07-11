import type { ChatlogDocument, LocoId } from './types.js';

/**
 * Media (image/audio/file) upload & download control commands, captured on
 * KakaoTalk Android 25.8.1. The binary transfer itself runs over a separate
 * connection to the returned upload/download host and is NOT one of these LOCO
 * commands — these only negotiate tickets and post/finish the message.
 */

/** SHIP: request a single-file upload ticket. `t` is a ChatType (2 photo, 5 audio…). */
export interface ShipRequest {
  readonly c: LocoId;
  readonly s: number;
  readonly t: number;
  readonly cs: string;
  readonly e?: string;
  readonly ex?: string;
}
export interface ShipResponse {
  readonly k: string;
  readonly vh: string;
  readonly vh6: string;
  readonly p: number;
  readonly rd: boolean;
  readonly status?: number;
}

/** MSHIP: request a multi-file upload ticket. */
export interface MShipRequest {
  readonly c: LocoId;
  readonly sl: readonly number[];
  readonly t: number;
  readonly csl: readonly string[];
  readonly el?: readonly string[];
}
export interface MShipResponse {
  readonly kl: readonly string[];
  readonly mtl: readonly string[];
  readonly vhl: readonly string[];
  readonly vh6l: readonly string[];
  readonly pl: readonly number[];
  readonly rd: boolean;
  readonly status?: number;
}

/** POST: finalize one uploaded file as a message. */
export interface MediaPostRequest {
  readonly k: string;
  readonly t: number;
  readonly s: number;
  readonly u: LocoId;
  readonly c: LocoId;
  readonly mid: LocoId;
  readonly w?: number;
  readonly h?: number;
  readonly mm: string;
  readonly nt: number;
  readonly os: 'android';
  readonly av: string;
  readonly ex?: string;
  /** Android 25.8.1 photo capture used null; legacy media used the file name. */
  readonly f?: string | null;
  readonly sp?: string | null;
  readonly dt?: number;
  readonly scp?: number;
  readonly ns: boolean;
}

/** MPOST: finalize one member of an MSHIP upload. */
export interface MediaMultiPostRequest {
  readonly k: string;
  readonly t: number;
  readonly s: number;
  readonly u: LocoId;
  readonly mm: string;
  readonly nt: number;
  readonly os: 'android';
  readonly av: string;
  readonly dt: number;
  readonly scp: number;
}
export interface MediaPostResponse {
  readonly status: number;
  readonly o: number;
}

/** MINI (thumbnail upload) / DOWN (download): same transfer-ticket shape. */
export interface MediaTransferRequest {
  readonly k: string;
  readonly u?: LocoId;
  readonly o?: number;
  readonly mm?: string;
  readonly nt?: number;
  readonly os?: string;
  readonly av?: string;
  readonly c?: LocoId | number;
  readonly rt?: boolean;
}
export interface MediaTransferResponse {
  readonly status?: number;
  readonly s?: number;
}

/** GETTRAILER: resolve the download host for a media key. */
export interface GetTrailerRequest {
  readonly k: string;
  readonly t: number;
}
export interface GetTrailerResponse {
  readonly vh: string;
  readonly vh6: string;
  readonly p: number;
  readonly rd: boolean;
  readonly status?: number;
}

/** MCHKTOKENS: check which media are already uploaded (dedup by token/key). */
export interface MediaCheckTokensRequest {
  readonly ts: readonly number[];
  readonly ks: readonly string[];
}
export interface MediaCheckTokensResponse {
  readonly eks: readonly unknown[];
  readonly status?: number;
}

/** COMPLETE push: a media message has been finalized; carries the final chatLog. */
export interface MediaCompletePush {
  readonly status: number;
  readonly chatLog?: ChatlogDocument;
  readonly li?: number;
  readonly noSeen?: boolean;
}
