/*
 * Created on Thu Jan 28 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import * as forge from 'node-forge';
import { CryptoStore } from '.';

export async function createForgeCrypto(pubKey: string): Promise<CryptoStore> {
  const publicKey = forge.pki.publicKeyFromPem(pubKey);

  const key = forge.random.getBytesSync(16);

  return {
    toAESEncrypted(buffer: Uint8Array, iv: Uint8Array): Uint8Array {
      const cipher = forge.cipher.createCipher('AES-GCM', key);

      cipher.start({
        iv: forge.util.binary.raw.encode(iv),
        tagLength: 128,
      });

      cipher.update(new forge.util.ByteStringBuffer(buffer));
      cipher.finish();

      const encrypted = forge.util.binary.raw.decode(cipher.output.data);
      const tag = forge.util.binary.raw.decode(cipher.mode.tag.data);

      const res = new Uint8Array(encrypted.length + tag.length);
      res.set(encrypted, 0);
      res.set(tag, encrypted.length);

      return res;
    },
    toAESDecrypted(buffer: Uint8Array, iv: Uint8Array): Uint8Array {
      const tag = buffer.slice(buffer.length - 16);
      const ciphertext = buffer.slice(0, buffer.length - 16);

      const cipher = forge.cipher.createDecipher('AES-GCM', key);

      cipher.start({
        iv: forge.util.binary.raw.encode(iv),
        tagLength: 128,
        tag: forge.util.createBuffer(
          forge.util.binary.raw.encode(tag)
        ),
      });

      cipher.update(new forge.util.ByteStringBuffer(ciphertext));
      cipher.finish();

      const array = forge.util.binary.raw.decode(cipher.output.data);
      return array;
    },

    toRSAEncrypted(buffer: Uint8Array): Uint8Array {
      const encrypted = publicKey.encrypt(new forge.util.ByteStringBuffer(buffer).data, 'RSA-OAEP');
      return forge.util.binary.raw.decode(encrypted);
    },

    randomCipherIV(): Uint8Array {
      const buffer = new Uint8Array(12);
      forge.util.binary.raw.decode(forge.random.getBytesSync(12), buffer);

      return buffer;
    },

    getRSAEncryptedKey(): Uint8Array {
      const encrypted = publicKey.encrypt(new forge.util.ByteStringBuffer(key).data, 'RSA-OAEP');
      return forge.util.binary.raw.decode(encrypted);
    },
  };
}