import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Long } from 'bson';

const COMMANDS = new Map([
  ['!테스트 도움말', 'help'],
  ['!테스트 전체', 'all'],
  ['!테스트 이미지', 'image'],
  ['!테스트 이미지묶음', 'multiImage'],
  ['!테스트 이모티콘', 'emoticon'],
  ['!테스트 미니이모티콘', 'miniEmoticon'],
  ['!테스트 멘션', 'mention'],
  ['!테스트 외치기', 'shout'],
]);

const HELP = `🧪 기능 테스트 명령어

!테스트 이미지
!테스트 이미지묶음
!테스트 이모티콘
!테스트 미니이모티콘
!테스트 멘션
!테스트 외치기
!테스트 전체`;

// Values copied from the user's Android 25.8.1 WRITE captures.
const DEFAULT_EMOTICON = Object.freeze({
  path: '4412206.emot_003.webp',
  name: '(이모티콘)',
  type: 'image/webp',
  chatType: 20,
});

const DEFAULT_MINI_EMOTICON = Object.freeze({
  text: '(분노)',
  emojis: Object.freeze({
    total_item: 1,
    total_len: 4,
    items: Object.freeze([
      Object.freeze({ id: '1200283_004', len: 4, at: Object.freeze([1]) }),
    ]),
  }),
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(environment, name) {
  const source = environment[name];
  if (source === undefined || source.trim().length === 0) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

function positiveInteger(value, name, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function optionalDimension(value, name) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function imageConfiguration(value, name) {
  if (!isRecord(value) || typeof value.path !== 'string' || value.path.length === 0) {
    throw new Error(`${name} must be an object with a non-empty path`);
  }
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length === 0)) {
    throw new Error(`${name}.name must be a non-empty string`);
  }
  if (value.ext !== undefined && (typeof value.ext !== 'string' || value.ext.length === 0)) {
    throw new Error(`${name}.ext must be a non-empty string`);
  }
  return Object.freeze({
    path: value.path,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.ext === undefined ? {} : { ext: value.ext.replace(/^\./, '') }),
    ...(value.width === undefined ? {} : { width: optionalDimension(value.width, `${name}.width`) }),
    ...(value.height === undefined ? {} : { height: optionalDimension(value.height, `${name}.height`) }),
  });
}

function emoticonConfiguration(value) {
  if (value === undefined) return DEFAULT_EMOTICON;
  if (!isRecord(value) ||
    typeof value.path !== 'string' || value.path.length === 0 ||
    typeof value.name !== 'string' || value.name.length === 0 ||
    typeof value.type !== 'string' || value.type.length === 0) {
    throw new Error('BOT_TEST_EMOTICON_JSON must contain path, name, and type strings');
  }
  const chatType = value.chatType ?? 20;
  if (!Number.isSafeInteger(chatType) || chatType < 1) {
    throw new RangeError('BOT_TEST_EMOTICON_JSON.chatType must be a positive safe integer');
  }
  return Object.freeze({ path: value.path, name: value.name, type: value.type, chatType });
}

function miniEmoticonConfiguration(value) {
  if (value === undefined) return DEFAULT_MINI_EMOTICON;
  if (!isRecord(value) || typeof value.text !== 'string' || !isRecord(value.emojis)) {
    throw new Error('BOT_TEST_MINI_EMOTICON_JSON must contain text and emojis');
  }
  const emojis = value.emojis;
  if (!Number.isSafeInteger(emojis.total_item) || emojis.total_item < 0 ||
    !Number.isSafeInteger(emojis.total_len) || emojis.total_len < 0 ||
    !Array.isArray(emojis.items)) {
    throw new Error('BOT_TEST_MINI_EMOTICON_JSON.emojis has an invalid summary');
  }
  const items = emojis.items.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0 ||
      !Number.isSafeInteger(item.len) || item.len < 1 || !Array.isArray(item.at) ||
      !item.at.every(position => Number.isSafeInteger(position) && position >= 0)) {
      throw new Error(`BOT_TEST_MINI_EMOTICON_JSON.emojis.items[${index}] is invalid`);
    }
    return Object.freeze({ id: item.id, len: item.len, at: Object.freeze([...item.at]) });
  });
  if (emojis.total_item !== items.length) {
    throw new Error('BOT_TEST_MINI_EMOTICON_JSON.emojis.total_item must match items.length');
  }
  return Object.freeze({
    text: value.text,
    emojis: Object.freeze({
      total_item: emojis.total_item,
      total_len: emojis.total_len,
      items: Object.freeze(items),
    }),
  });
}

function toLong(value) {
  return Long.isLong(value) ? value : Long.fromValue(value);
}

function crc32(data) {
  let crc = 0xffff_ffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb8_8320);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

/** Creates a deterministic checkerboard PNG without network or fixture files. */
function generatedImage(index) {
  const width = 320;
  const height = 180;
  const palettes = [
    [[255, 229, 0], [38, 38, 38]],
    [[66, 133, 244], [255, 255, 255]],
    [[52, 168, 83], [245, 245, 245]],
  ];
  const palette = palettes[index % palettes.length];
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const color = palette[(Math.floor(x / 32) + Math.floor(y / 30)) % 2];
      const offset = row + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const data = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return { data, name: `node-kakao-test-${index + 1}.png`, ext: 'png', width, height };
}

export function createBotFeatureTestCommands({ workspace, environment, log = () => undefined }) {
  const singleValue = parseJson(environment, 'BOT_TEST_IMAGE_JSON');
  const multiValue = parseJson(environment, 'BOT_TEST_IMAGES_JSON');
  const singleImage = singleValue === undefined
    ? undefined
    : imageConfiguration(singleValue, 'BOT_TEST_IMAGE_JSON');
  const multiImages = multiValue === undefined
    ? undefined
    : (() => {
      if (!Array.isArray(multiValue) || multiValue.length < 2) {
        throw new Error('BOT_TEST_IMAGES_JSON must contain at least two image objects');
      }
      return Object.freeze(multiValue.map((value, index) =>
        imageConfiguration(value, `BOT_TEST_IMAGES_JSON[${index}]`),
      ));
    })();
  const emoticon = emoticonConfiguration(parseJson(environment, 'BOT_TEST_EMOTICON_JSON'));
  const miniEmoticon = miniEmoticonConfiguration(parseJson(environment, 'BOT_TEST_MINI_EMOTICON_JSON'));
  const mediaTimeoutMs = positiveInteger(environment.BOT_TEST_MEDIA_TIMEOUT_MS, 'BOT_TEST_MEDIA_TIMEOUT_MS', 120_000);
  const maximumFileBytes = positiveInteger(environment.BOT_TEST_MAX_FILE_BYTES, 'BOT_TEST_MAX_FILE_BYTES', 20 * 1024 * 1024);
  const groupedMessage = environment.BOT_TEST_GROUPED_MESSAGE;
  const shoutText = environment.BOT_TEST_SHOUT_TEXT ?? '외치기 기능 테스트';
  const mentionPrefix = environment.BOT_TEST_MENTION_PREFIX ?? '멘션 기능 테스트: ';
  const mentionNickname = environment.BOT_TEST_MENTION_NICKNAME ?? '테스트';
  let operation = Promise.resolve();

  async function loadConfiguredImage(config) {
    const path = isAbsolute(config.path) ? config.path : resolve(workspace, config.path);
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Configured test image is not a regular file');
    if (info.size > maximumFileBytes) {
      throw new Error(`Configured test image exceeds BOT_TEST_MAX_FILE_BYTES (${maximumFileBytes})`);
    }
    const extension = config.ext ?? extname(path).replace(/^\./, '');
    const data = await readFile(path);
    if (data.byteLength > maximumFileBytes) {
      throw new Error(`Configured test image exceeds BOT_TEST_MAX_FILE_BYTES (${maximumFileBytes})`);
    }
    return {
      data,
      name: config.name ?? basename(path),
      ...(extension.length === 0 ? {} : { ext: extension }),
      ...(config.width === undefined ? {} : { width: config.width }),
      ...(config.height === undefined ? {} : { height: config.height }),
    };
  }

  async function singleForm() {
    return singleImage === undefined ? generatedImage(0) : await loadConfiguredImage(singleImage);
  }

  async function multiForms() {
    if (multiImages === undefined) return [generatedImage(1), generatedImage(2)];
    const forms = [];
    for (const config of multiImages) forms.push(await loadConfiguredImage(config));
    return forms;
  }

  async function executeOne(command, context) {
    const channelId = toLong(context.message.chatId);
    switch (command) {
      case 'help':
        await context.channel.sendText(HELP);
        return 1;
      case 'image':
        await context.client.sendMedia(channelId, 2, await singleForm(), { timeoutMs: mediaTimeoutMs });
        return 1;
      case 'multiImage': {
        const forms = await multiForms();
        await context.client.sendMultiMedia(channelId, 27, forms, {
          timeoutMs: mediaTimeoutMs,
          groupedMessage: groupedMessage ?? `사진 ${forms.length}장`,
        });
        return 1;
      }
      case 'emoticon':
        await context.channel.sendEmoticon(
          { path: emoticon.path, name: emoticon.name, type: emoticon.type },
          emoticon.chatType,
        );
        return 1;
      case 'miniEmoticon':
        await context.channel.sendTextWithEmojis(miniEmoticon.text, miniEmoticon.emojis);
        return 1;
      case 'mention': {
        const nickname = context.message.authorNickname ?? mentionNickname;
        await context.channel.sendMention([
          mentionPrefix,
          { userId: toLong(context.message.chatLog.authorId), nickname },
        ]);
        return 1;
      }
      case 'shout':
        await context.channel.sendShout(shoutText);
        return 1;
      default:
        throw new Error(`Unknown feature test command: ${command}`);
    }
  }

  async function execute(command, context) {
    if (command !== 'all') return await executeOne(command, context);
    const image = await singleForm();
    const images = await multiForms();
    const nickname = context.message.authorNickname ?? mentionNickname;
    const channelId = toLong(context.message.chatId);
    await context.client.sendMedia(channelId, 2, image, { timeoutMs: mediaTimeoutMs });
    await context.client.sendMultiMedia(channelId, 27, images, {
      timeoutMs: mediaTimeoutMs,
      groupedMessage: groupedMessage ?? `사진 ${images.length}장`,
    });
    await context.channel.sendEmoticon(
      { path: emoticon.path, name: emoticon.name, type: emoticon.type },
      emoticon.chatType,
    );
    await context.channel.sendTextWithEmojis(miniEmoticon.text, miniEmoticon.emojis);
    await context.channel.sendMention([
      mentionPrefix,
      { userId: toLong(context.message.chatLog.authorId), nickname },
    ]);
    await context.channel.sendShout(shoutText);
    return 6;
  }

  return Object.freeze({
    async handle(context) {
      const text = context.message.chatLog?.message;
      if (typeof text !== 'string') return undefined;
      const command = COMMANDS.get(text.trim());
      if (command === undefined) return undefined;
      const result = operation.then(async () => await execute(command, context));
      operation = result.then(() => undefined, () => undefined);
      const actions = await result;
      log('feature-test-command', { command, actions });
      return { command, actions };
    },
  });
}
