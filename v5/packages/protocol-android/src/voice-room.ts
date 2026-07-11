import type { ChatlogDocument } from './types.js';

/** Chat type observed for Android voice-room lifecycle messages. */
export const ANDROID_VOICE_ROOM_CHAT_TYPE = 52;

export type AndroidVoiceRoomEventType = 'vr_invite' | 'vr_bye' | (string & {});

/**
 * Voice-room metadata observed in Android 25.8.1 MSG type 52 packets.
 * This describes received lifecycle messages; creating/joining the media call is
 * a separate protocol which is not covered by the current LOCO capture.
 */
export interface AndroidVoiceRoomAttachment {
  readonly type: AndroidVoiceRoomEventType;
  readonly csIP: string;
  readonly csIP6: string;
  readonly csPort: number;
  readonly callId: string;
  readonly duration: number;
}

export interface AndroidVoiceRoomEvent {
  readonly chatLog: ChatlogDocument;
  readonly attachment: AndroidVoiceRoomAttachment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAndroidVoiceRoomEvent(
  chatLog: ChatlogDocument,
): AndroidVoiceRoomEvent | undefined {
  if (chatLog.type !== ANDROID_VOICE_ROOM_CHAT_TYPE) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(chatLog.attachment);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded) ||
    typeof decoded.type !== 'string' ||
    typeof decoded.csIP !== 'string' ||
    typeof decoded.csIP6 !== 'string' ||
    typeof decoded.csPort !== 'number' || !Number.isSafeInteger(decoded.csPort) ||
    decoded.csPort < 1 || decoded.csPort > 65_535 ||
    typeof decoded.callId !== 'string' ||
    typeof decoded.duration !== 'number' || !Number.isFinite(decoded.duration) || decoded.duration < 0) {
    return undefined;
  }
  return {
    chatLog,
    attachment: {
      type: decoded.type,
      csIP: decoded.csIP,
      csIP6: decoded.csIP6,
      csPort: decoded.csPort,
      callId: decoded.callId,
      duration: decoded.duration,
    },
  };
}
