import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { androidReferenceLocoPublicKeyPem } from '@lukim9-kakao/protocol-profiles';
import { loadLocoPublicKey } from '../bot/live-client-factory.mjs';

test('live bot uses the bundled Android LOCO public key by default', async () => {
  const resolved = await loadLocoPublicKey('unused', {});

  assert.equal(resolved, androidReferenceLocoPublicKeyPem);
  assert.equal(createPublicKey(resolved).type, 'public');
});

test('live bot still supports explicit public-key overrides', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'node-kakao-key-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'override.pem');
  await writeFile(path, androidReferenceLocoPublicKeyPem, 'utf8');

  assert.equal(
    await loadLocoPublicKey(directory, { KAKAO_LOCO_PUBLIC_KEY_PATH: 'override.pem' }),
    androidReferenceLocoPublicKeyPem,
  );
  assert.equal(
    await loadLocoPublicKey('unused', {
      KAKAO_LOCO_PUBLIC_KEY: androidReferenceLocoPublicKeyPem.replaceAll('\n', '\\n'),
    }),
    androidReferenceLocoPublicKeyPem,
  );

});
