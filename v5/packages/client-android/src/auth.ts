import { createHash } from 'node:crypto';
import { Long } from 'bson';
import type { AndroidClientConfiguration, AndroidSessionCredential } from './configuration.js';

export interface AndroidAuthIdentity {
  readonly deviceUuid: string;
  readonly deviceName: string;
  readonly advertisementId: string;
}

export interface AndroidPasswordLogin {
  readonly id: string;
  readonly password: string;
}

export interface AndroidIssuedCredential extends AndroidSessionCredential {
  readonly userId: Long;
  readonly refreshToken: string;
}

export type AndroidAuthResult =
  | { readonly success: true; readonly status: 0; readonly credential: AndroidIssuedCredential }
  | { readonly success: false; readonly status: number };

export interface AndroidPasscodeChallenge {
  readonly status: number;
  readonly passcode?: string;
  readonly remainingSeconds?: number;
}

export interface AndroidDeviceRegistrationAttempt {
  readonly status: number;
  readonly nextRequestIntervalInSeconds?: number;
  readonly remainingSeconds?: number;
}

/** Status returned by Android 25.8.1 when passcode-based device approval is required. */
export const ANDROID_NEED_DEVICE_AUTH_STATUS = -100;

export interface AndroidXvcProvider {
  create(deviceUuid: string, userAgent: string, accountId: string): Promise<string> | string;
}

/** Historical Android-sub X-VC formula from the local reference implementation. */
export const legacyAndroidSubXvcProvider: AndroidXvcProvider = Object.freeze({
  create(_deviceUuid: string, userAgent: string, accountId: string): string {
    return createHash('sha512')
      .update(`CAREY|${userAgent}|GLENN|${accountId}|PETER`)
      .digest('hex');
  },
});

export interface AndroidAuthClientOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
}

export interface AndroidAuthenticateOptions {
  /**
   * Called when the device is not registered and a passcode was issued. Show the
   * passcode to the user; they must approve it in the official KakaoTalk app on
   * their main device. Registration polling then completes automatically.
   */
  readonly onPasscodeRequired?: (challenge: AndroidPasscodeChallenge) => void | Promise<void>;
  readonly deviceOsApiLevel?: string;
  readonly permanent?: boolean;
  /** Overall timeout for waiting on main-device approval, in seconds. Default from the challenge. */
  readonly approvalTimeoutSeconds?: number;
  readonly signal?: AbortSignal;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function statusOf(value: unknown): number {
  if (!isRecord(value) || typeof value.status !== 'number') {
    throw new Error('Android auth response has no numeric status');
  }
  return value.status;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class AndroidAuthClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  public constructor(
    private readonly configuration: AndroidClientConfiguration,
    private readonly identity: AndroidAuthIdentity,
    private readonly xvcProvider: AndroidXvcProvider,
    options: AndroidAuthClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? 'https://katalk.kakao.com';
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  public async login(form: AndroidPasswordLogin): Promise<AndroidAuthResult> {
    const response = await this.requestForm('login.json', form, {
      device_uuid: this.identity.deviceUuid,
      device_name: this.identity.deviceName,
      forced: false,
      permanent: true,
      one_store: false,
    });
    const status = statusOf(response);
    if (status !== 0) return { success: false, status };
    if (!isRecord(response) ||
      (typeof response.userId !== 'number' && typeof response.userId !== 'string' &&
        !Long.isLong(response.userId)) ||
      typeof response.access_token !== 'string' || typeof response.refresh_token !== 'string') {
      throw new Error('Successful Android auth response is missing credential fields');
    }
    return {
      success: true,
      status: 0,
      credential: {
        userId: Long.fromValue(response.userId),
        deviceUuid: this.identity.deviceUuid,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
      },
    };
  }

  /**
   * Creates the passcode shown by a sub-device while the main device approves it.
   * This models the Android 25.8.1 `passcodeLogin/generate` flow.
   */
  public async generatePasscode(
    form: AndroidPasswordLogin,
    options: { readonly permanent?: boolean; readonly deviceOsApiLevel: string },
  ): Promise<AndroidPasscodeChallenge> {
    const response = await this.requestJson('passcodeLogin/generate', form.id, {
      email: form.id,
      password: form.password,
      permanent: options.permanent ?? true,
      device: {
        name: this.identity.deviceName,
        uuid: this.identity.deviceUuid,
        model: this.configuration.deviceModel,
        osVersion: options.deviceOsApiLevel,
        isOneStore: false,
      },
    });
    const status = statusOf(response);
    if (!isRecord(response)) return { status };
    const passcode = typeof response.passcode === 'string' ? response.passcode : undefined;
    const remainingSeconds = optionalNumber(response.remainingSeconds);
    return {
      status,
      ...(passcode === undefined ? {} : { passcode }),
      ...(remainingSeconds === undefined ? {} : { remainingSeconds }),
    };
  }

  /** Performs one deterministic registration poll; callers control retry scheduling. */
  public async registerPasscodeDevice(
    form: AndroidPasswordLogin,
  ): Promise<AndroidDeviceRegistrationAttempt> {
    const response = await this.requestJson('passcodeLogin/registerDevice', form.id, {
      email: form.id,
      password: form.password,
      device: { uuid: this.identity.deviceUuid },
    });
    const status = statusOf(response);
    if (!isRecord(response)) return { status };
    const nextRequestIntervalInSeconds = optionalNumber(response.nextRequestIntervalInSeconds);
    const remainingSeconds = optionalNumber(response.remainingSeconds);
    return {
      status,
      ...(nextRequestIntervalInSeconds === undefined ? {} : { nextRequestIntervalInSeconds }),
      ...(remainingSeconds === undefined ? {} : { remainingSeconds }),
    };
  }

  public async cancelPasscode(form: AndroidPasswordLogin): Promise<number> {
    return statusOf(await this.requestJson('passcodeLogin/cancel', form.id, {
      email: form.id,
      password: form.password,
      device: { uuid: this.identity.deviceUuid },
    }));
  }

  /**
   * High-level login mirroring the legacy node-kakao flow: attempts a password
   * login with the configured device UUID, and if the device is not registered
   * (NEED_DEVICE_AUTH) runs the passcode flow — generate a passcode, let the user
   * approve it in the official app on their main device, poll registerDevice, then
   * log in. Returns the issued credential on success.
   */
  public async authenticate(
    form: AndroidPasswordLogin,
    options: AndroidAuthenticateOptions = {},
  ): Promise<AndroidAuthResult> {
    const first = await this.login(form);
    if (first.success || first.status !== ANDROID_NEED_DEVICE_AUTH_STATUS) return first;

    const challenge = await this.generatePasscode(form, {
      deviceOsApiLevel: options.deviceOsApiLevel ?? '35',
      ...(options.permanent === undefined ? {} : { permanent: options.permanent }),
    });
    if (challenge.status !== 0) return { success: false, status: challenge.status };
    await options.onPasscodeRequired?.(challenge);

    let remainingSeconds = options.approvalTimeoutSeconds ?? challenge.remainingSeconds ?? 120;
    for (;;) {
      if (options.signal?.aborted === true) throw options.signal.reason ?? new Error('aborted');
      const attempt = await this.registerPasscodeDevice(form);
      if (attempt.status === 0) break;
      if (attempt.status !== ANDROID_NEED_DEVICE_AUTH_STATUS) return { success: false, status: attempt.status };
      const intervalSeconds = attempt.nextRequestIntervalInSeconds ?? 3;
      remainingSeconds = (attempt.remainingSeconds ?? remainingSeconds) - intervalSeconds;
      if (remainingSeconds <= 0) return { success: false, status: attempt.status };
      await delay(intervalSeconds * 1000, options.signal);
    }

    return await this.login(form);
  }

  private userAgent(): string {
    return `KT/${this.configuration.kakaoTalkAppVersion} An/${this.configuration.reportedAndroidOsVersion} ${this.configuration.language}`;
  }

  private async headers(accountId: string, contentType: string): Promise<Record<string, string>> {
    const userAgent = this.userAgent();
    const fullXvc = await this.xvcProvider.create(this.identity.deviceUuid, userAgent, accountId);
    return {
      'Accept-Language': this.configuration.language,
      A: `android/${this.configuration.kakaoTalkAppVersion}/${this.configuration.language}`,
      Adid: this.identity.advertisementId,
      'Content-Type': contentType,
      'User-Agent': userAgent,
      'X-Vc': fullXvc.slice(0, 16),
    };
  }

  private async requestForm(
    endpoint: string,
    form: AndroidPasswordLogin,
    extra: Readonly<Record<string, string | number | boolean>>,
  ): Promise<unknown> {
    const body = new URLSearchParams({
      email: form.id,
      password: form.password,
    });
    for (const [key, value] of Object.entries(extra)) body.set(key, String(value));
    const response = await this.fetchImplementation(
      `${this.baseUrl}/android/account/${endpoint}`,
      {
        method: 'POST',
        headers: await this.headers(form.id, 'application/x-www-form-urlencoded'),
        body,
      },
    );
    return await this.readResponse(response);
  }

  private async requestJson(
    endpoint: string,
    accountId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/android/account/${endpoint}`,
      {
        method: 'POST',
        headers: await this.headers(accountId, 'application/json'),
        body: JSON.stringify(body),
      },
    );
    return await this.readResponse(response);
  }

  private async readResponse(response: Response): Promise<unknown> {
    const body = await response.json() as unknown;
    if (!response.ok && (!isRecord(body) || typeof body.status !== 'number')) {
      throw new Error(`Android auth HTTP request failed with status ${response.status}`);
    }
    return body;
  }
}
