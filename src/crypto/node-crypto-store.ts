/*
 * Created on Sat Jan 30 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import * as crypto from 'crypto';
import { CryptoStore } from '.';

export async function createNodeCrypto(pubKey: string): Promise<CryptoStore> {
  const key = crypto.randomBytes(16);

  const store = {
    toAESEncrypted(buffer: Uint8Array, iv: Uint8Array) {
      const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);

      const encrypted = cipher.update(buffer);
      const final = cipher.final();
      const tag = cipher.getAuthTag();

      const res = new Uint8Array(encrypted.byteLength + final.byteLength + tag.byteLength);

      res.set(encrypted, 0);
      res.set(final, encrypted.byteLength);
      res.set(tag, encrypted.byteLength + final.byteLength);

      return res;
    },
    toAESDecrypted(buffer: Uint8Array, iv: Uint8Array) {
      const tag = buffer.slice(buffer.byteLength - 16);
      const ciphertext = buffer.slice(0, buffer.byteLength - 16);

      const cipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
      cipher.setAuthTag(Buffer.from(tag));

      const decrypted = cipher.update(ciphertext);
      const final = cipher.final();

      const res = new Uint8Array(decrypted.byteLength + final.byteLength);

      res.set(decrypted, 0);
      res.set(final, decrypted.byteLength);

      return res;
    },

    toRSAEncrypted(buffer: Uint8Array) {
      return crypto.publicEncrypt(pubKey, buffer);
    },

    randomCipherIV() {
      return crypto.randomBytes(12);
    },

    getRSAEncryptedKey() {
      return this.toRSAEncrypted(key);
    },
  };

  return store;
}